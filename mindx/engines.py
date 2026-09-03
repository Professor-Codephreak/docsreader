"""engines.py — text → PCM, ordered by cost.

    espeak-ng   the 90s tier. Formant synthesis; ~780x realtime measured on the
                2-vCPU host (THESIS.md: 29 min of audio in 2.2 s, 7.5 MB RSS).
                Reads stdin, so there is no argv cap and the text is never
                visible in `ps`. This is THE document reader.
    pyttsx3     the same espeak library wrapped in Python, plus SAPI5 (Windows)
                and NSSpeechSynthesizer (macOS). Present for hosts where that is
                what exists; on Linux it is strictly worse than the CLI — it goes
                through a temp file, its event loop is not re-entrant in a
                long-lived async service (the well-known runAndWait hang), and
                it wants the legacy libespeak.so.1 which espeak-ng hosts may not
                ship. Never the first choice here.
    voicey      the neural actor (audiocpp via voaice `/voicey`). ~1.06x realtime,
                240 chars a call, one call at a time host-wide. A pre-render
                tier for short pieces, never an interactive reader.

Every engine returns the same Clip, so the encoder and the reader do not care
which one spoke.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import struct
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Optional

import numpy as np

# WHAT "SPEED 1" MEANS: piper's own 1.0, and nothing added on top.
#
# This was briefly 1.1 — an attempt to make the default reading a shade quicker
# by moving the ruler rather than by giving neural a rate. The mechanism was
# right (a calibration leaves neural's entry empty and moves every voice
# together) and the value was not what was wanted: speed 1 should be speed 1.
# The hook stays at 1.0 so the ruler CAN be moved from the environment on a host
# that wants a different pace, without editing a voice.
SPEED_CALIBRATION = float(os.environ.get("MINDX_SPEECH_CALIBRATION", "1.0"))

import hashlib

from .chunk import sentences

DEFAULT_RATE = 175          # words per minute (espeak-ng -s)
DEFAULT_VOICE = "en-us"


@dataclass
class Clip:
    samples: np.ndarray       # int16 mono
    sample_rate: int
    engine: str               # what actually produced it — the label follows the truth
    degraded: bool = False    # a lower tier answered than the one asked for

    @property
    def seconds(self) -> float:
        return round(len(self.samples) / float(self.sample_rate), 2)


def _parse_wav(buf: bytes) -> Clip:
    """RIFF/WAVE → Clip. Ignores declared chunk sizes for `data`: espeak-ng
    --stdout writes a header with placeholder lengths because it cannot know
    them while streaming, and `wave` believes the placeholder."""
    if len(buf) < 12 or buf[:4] != b"RIFF" or buf[8:12] != b"WAVE":
        raise ValueError("not a RIFF/WAVE stream")
    pos, sr, ch, bits = 12, 22050, 1, 16
    while pos + 8 <= len(buf):
        cid, size = buf[pos:pos + 4], struct.unpack("<I", buf[pos + 4:pos + 8])[0]
        body = pos + 8
        if cid == b"fmt ":
            ch, sr = struct.unpack("<HI", buf[body + 2:body + 8])
            bits = struct.unpack("<H", buf[body + 14:body + 16])[0]
            pos = body + size + (size & 1)
            continue
        if cid == b"data":
            raw = buf[body:]                               # to EOF, not to `size`
            if bits != 16:
                raise ValueError(f"unsupported bit depth {bits}")
            pcm = np.frombuffer(raw[: len(raw) - (len(raw) % (2 * ch))], dtype="<i2")
            if ch > 1:
                pcm = pcm.reshape(-1, ch).mean(axis=1).astype(np.int16)
            return Clip(samples=pcm.astype(np.int16, copy=False), sample_rate=int(sr), engine="")
        pos = body + size + (size & 1)
    raise ValueError("no data chunk")


def _nice():
    try:
        os.nice(int(os.environ.get("MINDX_DOCSPEECH_NICE", "10")))
    except Exception:
        pass


class EspeakNG:
    id = "espeak-ng"

    def __init__(self, binary: Optional[str] = None):
        self.binary = binary or os.environ.get("MINDX_ESPEAK_BIN") or (
            "espeak-ng" if shutil.which("espeak-ng") else "espeak")

    def available(self) -> bool:
        return shutil.which(self.binary) is not None

    def voices(self, lang_prefix: str = "en") -> list[str]:
        try:
            r = subprocess.run([self.binary, f"--voices={lang_prefix}"], capture_output=True, text=True, timeout=10)
        except Exception:
            return [DEFAULT_VOICE]
        out = []
        for line in r.stdout.splitlines()[1:]:
            cols = line.split()
            if len(cols) >= 4:
                out.append(cols[3])
        return out or [DEFAULT_VOICE]

    def _require_variant(self, voice: Optional[str]) -> None:
        """Refuse a "+variant" espeak-ng would silently ignore."""
        if not voice or "+" not in voice:
            return
        variant = voice.split("+", 1)[1]
        data = _espeak_data_dir(self.binary)
        if not data:
            return                                    # cannot prove absence; do not invent a failure
        if not os.path.isfile(os.path.join(data, "voices", "!v", variant)):
            raise RuntimeError(
                f"espeak-ng: voice variant '{variant}' is not installed at {data}/voices/!v/ "
                f"(run mindx_backend_service/voices/install_voices.sh as root)")

    def synth(self, text: str, *, voice: Optional[str] = None, rate: Optional[int] = None,
              pitch=None, sentence_silence: Optional[float] = None,
              timeout: float = 600.0, **_) -> Clip:
        """
        THIS SIGNATURE BROKE EVERY ESPEAK VOICE ONCE, AND THE WAY IT BROKE IS THE
        LESSON. `pitch` and `sentence_silence` were added to the reader's Spec for
        piper and passed to whatever engine was selected. piper grew the
        parameters; this did not — so every espeak voice answered HTTP 500 with
        `unexpected keyword argument`, and the picker looked like it had lost half
        its cast. A shared call signature is a contract, and one implementer
        quietly not honouring it is indistinguishable from the feature being
        broken.

        `**_` absorbs anything a future engine grows, and the two parameters that
        exist are given meanings that make sense HERE rather than being ignored:

          pitch  piper has no pitch control, so there it is a RATIO (0.92 = a
                 shade deeper) applied through the declared sample rate. espeak
                 has a real pitch knob on a 0-99 scale with 50 as normal, so a
                 ratio is mapped onto it. A value above 2 is taken as an espeak
                 number already, which keeps every existing caller working.

          sentence_silence  espeak has no such flag. It is accepted and NOT
                 applied, because the alternative — silently substituting a
                 different mechanism — would make two voices differ in a way no
                 configuration explains.
        """
        if pitch is None:
            pitch = 50
        else:
            pitch = float(pitch)
            pitch = int(round(50.0 * pitch)) if pitch <= 2.0 else int(round(pitch))
        pitch = max(0, min(99, pitch))
        # espeak-ng does not fail on an unknown "+variant" — it speaks the BASE
        # voice, exit code 0, no message. Asking for en-029+leaderofearth on a
        # host without that variant yields plain Caribbean English filed under
        # the name of a voice it is not. Check for the file and refuse; being
        # told the variant is missing is the whole difference between a bug you
        # can fix and a picker that mysteriously does nothing.
        self._require_variant(voice)
        args = [self.binary, "-v", voice or DEFAULT_VOICE, "-s", str(int(rate or DEFAULT_RATE)),
                "-p", str(int(pitch)), "--stdout"]
        # Text on STDIN. Not argv: argv is capped at 128 KiB per argument on Linux
        # and readable by every user on the host through `ps` — and this is a
        # gated document. stdin has neither problem, and the benchmark that
        # produced 29 minutes of audio in 2.2 s was fed exactly this way.
        r = subprocess.run(args, input=text.encode("utf-8"), capture_output=True,
                           timeout=timeout, preexec_fn=_nice)
        if r.returncode != 0 or len(r.stdout) < 44:
            err = r.stderr.decode(errors="replace")[:200]
            # A missing BASE voice, unlike a missing variant, does fail loudly —
            # but the message does not say what to do about it. Ours live in the
            # repo until install_voices.sh copies them into espeak's data dir.
            if "does not exist" in err:
                err += (" — if this is a mindX voice (en-earth), run "
                        "mindx_backend_service/voices/install_voices.sh as root")
            raise RuntimeError(f"{self.binary} rc={r.returncode}: {err}")
        clip = _parse_wav(r.stdout)
        clip.engine = self.id
        return clip


class Piper:
    """piper — neural TTS on CPU (ONNX, VITS), reads text on stdin. Measured on the
    2-vCPU host with en_US-lessac-medium: ~10x realtime on two cores (363 MB RSS),
    a fraction of that on one. The QUALITY tier for a document: still cached once,
    still parts, but a listener no longer hears 1995. Models live in
    MINDX_PIPER_VOICES (default data/models/piper/), `<voice>.onnx` + `.onnx.json`;
    the default voice is the first one found unless MINDX_PIPER_VOICE names it."""
    id = "piper"

    def __init__(self, binary: Optional[str] = None, voices_dir: Optional[str] = None):
        from pathlib import Path
        root = Path(__file__).resolve().parents[2]
        venv_bin = Path(sys.executable).parent / "piper"
        self.binary = binary or os.environ.get("MINDX_PIPER_BIN") or (str(venv_bin) if venv_bin.exists() else "piper")
        self.voices_dir = Path(voices_dir or os.environ.get("MINDX_PIPER_VOICES") or root / "data" / "models" / "piper")

    def voices(self) -> list[str]:
        if not self.voices_dir.is_dir():
            return []
        return sorted(p.stem for p in self.voices_dir.glob("*.onnx") if p.with_suffix(".onnx.json").exists())

    def default_voice(self) -> Optional[str]:
        want = os.environ.get("MINDX_PIPER_VOICE")
        vs = self.voices()
        if want and want in vs:
            return want
        return vs[0] if vs else None

    def available(self) -> bool:
        return shutil.which(self.binary) is not None and self.default_voice() is not None

    def synth(self, text: str, *, voice: Optional[str] = None, rate: Optional[int] = None,
              pitch: Optional[float] = None, sentence_silence: Optional[float] = None,
              timeout: float = 1800.0, **_) -> Clip:
        # A NAMED voice that is not installed is an ERROR, not an invitation to
        # substitute. Falling back to the default model here renders one voice
        # under another voice's name, the caller is told nothing, and the result
        # is cached — which is precisely how a picker comes to look broken.
        # An EMPTY voice still means "whatever this host has", which is what
        # engine=auto relies on.
        if voice and voice not in self.voices():
            raise RuntimeError(f"piper: voice '{voice}' is not installed "
                               f"(have: {', '.join(self.voices()) or 'none'})")
        v = voice or self.default_voice()
        if not v:
            raise RuntimeError("piper: no voice model installed")
        # PITCH, WHICH PIPER DOES NOT HAVE.
        #
        # piper exposes --length-scale and nothing else: there is no pitch knob.
        # But pitch and duration are the same axis when you control the sample
        # rate a stream is DECLARED at, so a deeper voice is reachable without
        # resampling anything:
        #
        #     length_scale L = P / S     -> duration x L
        #     declare the wav at SR x P  -> pitch x P, duration / P
        #     net: duration x 1/S, pitch x P        exactly the stated pair
        #
        # S is the speed ratio (rate/175) and P the pitch ratio. Declaring the
        # rate also hands the resampling to the encoder's own filter instead of
        # doing it here with linear interpolation. This is the same arithmetic
        # the DeltaVerse store renders its derived voices with, so a voice
        # described as "neural at 0.86 speed, a shade deeper" means the same
        # thing in both places.
        speed = (float(rate) / 175.0) if rate else 1.0
        P = float(pitch) if pitch else 1.0
        # THE SCALE WAS RECALIBRATED, NOT THE VOICE.
        #
        # The reading was a shade slow at "speed 1", and the fix that suggests
        # itself — give neural a rate — is the wrong one twice over: neural is
        # defined by carrying NO rate, and setting one moves the reference every
        # other voice is a ratio on, so the cast would keep its shape only by
        # accident. What was actually wanted is for what used to be 1.1x to BE
        # 1.0: the ruler moves, and every voice measured against it moves with it,
        # which is exactly how the derived voices are supposed to behave.
        #
        # So the calibration lives here, once, and neural's entry stays empty.
        length = f"{P / (speed * SPEED_CALIBRATION):.3f}"
        model = self.voices_dir / f"{v}.onnx"
        try:
            sr = int(json.loads(model.with_suffix(".onnx.json").read_text()).get("audio", {}).get("sample_rate", 22050))
        except Exception:
            sr = 22050
        # --output-raw: s16le mono on stdout, no WAV header to distrust.
        # Sentence silence SCALES with length. A voice told to speak deliberately
        # (rate below 175 -> length_scale above 1.0) should also leave longer gaps
        # between sentences: pace and pause are the same gesture, and a slow voice
        # with clipped pauses sounds sedated rather than considered. This is the
        # "space between conclusions" knob, and it was previously hardcoded at 0.25.
        # An explicit value overrides the curve. The curve is a good default —
        # pace and pause are the same gesture — but a voice whose whole character
        # is the beat AFTER the sentence needs to state that beat rather than
        # inherit it from how fast it happens to be speaking.
        _ss_base = float(os.environ.get("MINDX_PIPER_SENTENCE_SILENCE", "0.25"))
        _ss = (min(2.5, float(sentence_silence)) if sentence_silence
               else min(1.5, _ss_base * (float(length) ** 2)))
        args = [self.binary, "--model", str(model), "--output-raw",
                "--length-scale", length, "--sentence-silence", f"{_ss:.3f}"]
        # stdin, as always: never argv (128 KiB cap, `ps` exposure of gated text).
        r = subprocess.run(args, input=text.encode("utf-8"), capture_output=True, timeout=timeout,
                           preexec_fn=self._preexec)
        if r.returncode != 0 or len(r.stdout) < 2:
            raise RuntimeError(f"piper rc={r.returncode}: {r.stderr.decode(errors='replace')[-300:]}")
        pcm = np.frombuffer(r.stdout[: len(r.stdout) - (len(r.stdout) % 2)], dtype="<i2")
        # the declared rate IS the pitch shift; see the note above
        return Clip(pcm.astype(np.int16, copy=False), int(round(sr * P)), f"piper:{v}")

    def _preexec(self):
        """nice, and PINNED to MINDX_DOCSPEECH_CPUS cores (default 1). onnxruntime ignores
        OMP_NUM_THREADS here — measured 181% CPU with it set — so the affinity mask is the
        one lever that actually leaves a core to Ollama and the ascent."""
        _nice()
        try:
            n = max(1, int(os.environ.get("MINDX_DOCSPEECH_CPUS", "1")))
            cpus = sorted(os.sched_getaffinity(0))
            os.sched_setaffinity(0, set(cpus[-n:]))      # the highest-numbered cores
        except Exception:
            pass


class Pyttsx3Engine:
    id = "pyttsx3"

    def available(self) -> bool:
        try:
            import pyttsx3  # noqa: F401
            return True
        except Exception:
            return False

    def synth(self, text: str, *, voice: Optional[str] = None, rate: Optional[int] = None, **_) -> Clip:
        import pyttsx3
        eng = pyttsx3.init()                       # a fresh engine per call — the loop is not re-entrant
        if rate:
            eng.setProperty("rate", int(rate))
        if voice:
            for v in eng.getProperty("voices"):
                if voice in (v.id, getattr(v, "name", "")):
                    eng.setProperty("voice", v.id)
                    break
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            path = tmp.name
        try:
            eng.save_to_file(text, path)
            eng.runAndWait()
            with open(path, "rb") as fh:
                clip = _parse_wav(fh.read())
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        clip.engine = self.id
        return clip


class VoiceyNeural:
    """The actor's neural voice, one sentence at a time through voaice `/voicey`.
    Honours its budget (240 chars, 20/min, single slot) by design: sentences are
    sent sequentially and a 429 is slept through, never retried in a burst."""
    id = "voicey"

    def __init__(self, base_url: Optional[str] = None, persona: Optional[str] = None):
        self.base_url = (base_url or os.environ.get("MINDX_VOICEY_URL") or "http://127.0.0.1:7350").rstrip("/")
        self.persona = persona or os.environ.get("MINDX_DOCSPEECH_PERSONA", "savante")
        self.max_chars = int(os.environ.get("VOAICE_VOICEY_FREETEXT_MAX", "240"))

    def available(self) -> bool:
        try:
            with urllib.request.urlopen(f"{self.base_url}/voicey/health", timeout=3) as r:
                return r.status == 200
        except Exception:
            return False

    def _one(self, line: str, voice: Optional[str]) -> tuple[Clip, str]:
        q = {"persona": self.persona, "text": line}
        if voice:
            q["voice"] = voice
        url = f"{self.base_url}/voicey?{urllib.parse.urlencode(q)}"
        for attempt in range(6):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    backend = r.headers.get("X-Voaice-Backend", "?")
                    return _parse_wav(r.read()), backend
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(float(e.headers.get("Retry-After", "3")))
                    continue
                raise
        raise RuntimeError("voicey: rate limited for too long")

    def synth(self, text: str, *, voice: Optional[str] = None, rate: Optional[int] = None, **_) -> Clip:
        chunks: list[np.ndarray] = []
        sr, degraded, backend = 24000, False, self.id
        for line in sentences(text, self.max_chars):
            clip, b = self._one(line, voice)
            sr = clip.sample_rate
            if b in ("formant", "busy") or b.startswith("formant"):
                degraded = True
            backend = b
            chunks.append(clip.samples)
            chunks.append(np.zeros(int(sr * 0.25), dtype=np.int16))   # a breath between sentences
        if not chunks:
            return Clip(np.zeros(0, dtype=np.int16), sr, backend)
        return Clip(np.concatenate(chunks), sr, backend, degraded=degraded)



class Layered:
    """A voice made of other voices, mixed.

    WHY A VOICE WOULD WANT THIS. LEADER is "a slowed neural with leader overtones
    on it" — which is not a setting on neural and cannot be reached by adjusting
    one. It is two renderings of the same text with one placed on top of the
    other, and every engine here produces exactly one.

    EACH LAYER OWNS A BAND, rather than every layer being mixed across the whole
    spectrum at a different gain. Two voices with the same formants at different
    levels comb-filter each other and the result is less intelligible than either
    alone — measured, on the OVERLORD build, before the bands were introduced. So
    the body keeps the full range and each overtone layer is filtered into the
    region where it is contributing something the body has not got.

    ALIGNMENT IS THE HARD PART, as always. The layers are different engines at
    different rates, so they do not agree on duration; each is resampled to the
    BODY's exact length per chunk, which bounds the drift to one chunk instead of
    letting it accumulate over a document. Nothing else here is subtle.
    """
    id = "layered"

    def __init__(self):
        self._recipes: dict = {}

    def _recipe(self, name: str) -> dict:
        if not self._recipes:
            try:
                from pathlib import Path as _P        # not a module-level import here
                cfg = _P(__file__).resolve().parents[2] / "data" / "config" / "docspeech_voices.json"
                for v in json.loads(cfg.read_text(encoding="utf-8")).get("voices", []):
                    if v.get("layers"):
                        self._recipes[v.get("voice") or v.get("id")] = v
            except Exception as e:
                raise RuntimeError(f"layered: cannot read the voice registry: {e}")
        r = self._recipes.get(name)
        if not r:
            raise RuntimeError(f"layered: no recipe named {name!r} "
                               f"(have: {', '.join(self._recipes) or 'none'})")
        return r

    def voices(self) -> list[str]:
        try:
            self._recipe("__probe__")      # populates the cache; the miss is expected
        except RuntimeError:
            pass
        return sorted(self._recipes)

    def available(self) -> bool:
        # it is available when the engines its recipes need are
        return Piper().available()

    @staticmethod
    def _eq(x, bands, sr):
        """Shape one voice. Not add another.

        piper gives you a length-scale and nothing else — no formants, no tone
        curve — so a derived voice can only be faster, slower, higher or lower
        than the reference. That is enough to make a voice DIFFERENT and not
        enough to make it AUTHORITATIVE, which is why the first attempt at LEADER
        reached for a second voice to supply the character. A second voice is not
        character, it is company.

        This is what a broadcast desk does to a real presenter instead: cut where
        the voice is muddy, lift where the words are, and leave everything else
        alone. One speaker, shaped. Applied in the frequency domain because this
        is an offline render and there is no reason to approximate.

        `bands` is [[lo_hz, hi_hz, gain_db], ...]; edges are raised-cosine over a
        third of the band so nothing rings.
        """
        n = len(x)
        if n < 64 or not bands:
            return x
        m = 1 << int(np.ceil(np.log2(n)))
        X = np.fft.rfft(x, m)
        f = np.fft.rfftfreq(m, 1.0 / sr)
        g = np.ones_like(f)
        for b in bands:
            lo, hi, db = float(b[0]), float(b[1]), float(b[2])
            if hi <= lo:
                continue
            amp = 10.0 ** (db / 20.0)
            edge = max(1.0, (hi - lo) / 3.0)
            w = np.zeros_like(f)
            core = (f >= lo + edge) & (f <= hi - edge)
            w[core] = 1.0
            up = (f >= lo) & (f < lo + edge)
            w[up] = 0.5 - 0.5 * np.cos(np.pi * (f[up] - lo) / edge)
            dn = (f > hi - edge) & (f <= hi)
            w[dn] = 0.5 - 0.5 * np.cos(np.pi * (hi - f[dn]) / edge)
            g = g * (1.0 + (amp - 1.0) * w)
        return np.fft.irfft(X * g, m)[:n]

    @staticmethod
    def _band(x, lo, hi, sr):
        """One pole each way. Gentle on purpose: these layers are being PLACED,
        not surgically isolated, and a steep filter rings on plosives."""
        def pole(sig, fc, high=False):
            a = float(np.exp(-2.0 * np.pi * fc / sr))
            n = min(len(sig), int(np.ceil(np.log(1e-7) / np.log(a))) + 1)
            k = (1 - a) * a ** np.arange(n, dtype=np.float64)
            m = 1 << int(np.ceil(np.log2(len(sig) + n)))
            y = np.fft.irfft(np.fft.rfft(sig, m) * np.fft.rfft(k, m), m)[:len(sig)]
            return (sig - y) if high else y
        out = x.astype(np.float64)
        if lo:
            out = pole(out, float(lo), high=True)
        if hi:
            out = pole(out, float(hi))
        return out

    # A SENTENCE IS THE ALIGNMENT UNIT. NOT A CHUNK.
    #
    # The first version resampled each layer to the body's length once per CHUNK,
    # and a chunk here is up to 2,500 words. Measured on four sentences of the
    # same text, the espeak overtone runs 1.67x longer than the piper body ON
    # AVERAGE and between 1.53x and 1.81x sentence to sentence — the two engines
    # simply distribute time differently, and no single stretch factor is right
    # for more than one sentence at a time. So a chunk-wide resample put the
    # overtone ahead of the body in some sentences and behind it in others,
    # drifting by seconds across a chunk. That is the delay: not a constant
    # offset that could be nudged out, a wander.
    #
    # Aligning per sentence bounds the error to one sentence, where a uniform
    # stretch is a good approximation because there is no room to accumulate.
    _SENT = None

    # ── TRACKS ──────────────────────────────────────────────────────────
    #
    # An overlay that is a few percent long or short does not sound like a
    # timing error, it sounds like a SECOND PERSON a beat behind — the parrot.
    # Fitting a layer to the body's total length per sentence bounds the error
    # but does not remove it: two engines distribute time differently WITHIN a
    # sentence too, so the middle drifts even when the ends agree.
    #
    # `anchor` is what closes that. The layer is fitted to the body at every
    # ANCHOR POINT rather than only at the sentence's edges — the boundaries
    # between the phrases the body's own punctuation already marks — so the two
    # voices meet again at every comma instead of only at every full stop. It is
    # piecewise-linear time-warping, and it is the difference between two voices
    # in unison and one voice with a shadow.
    #
    # Where a layer must be perfectly locked, use the SAME engine for both: two
    # piper voices agree far more closely than piper and espeak do (measured
    # 0.75-1.04 against 1.53-1.81), and that is why OVERLORD is neural+jaimla.
    #
    # `pan` places a layer in the field, -1 left to +1 right. `channels` on the
    # recipe asks for a wider output; the body stays centred and the overlays are
    # placed around it, which is the whole reason to have more than one channel:
    # depth comes from separation, not from level.
    _LAYOUTS = {
        1: ["C"],
        2: ["L", "R"],
        4: ["L", "R", "Ls", "Rs"],                       # quad
        6: ["L", "R", "C", "LFE", "Ls", "Rs"],           # 5.1
        8: ["L", "R", "C", "LFE", "Ls", "Rs", "Lb", "Rb"],   # 7.1
    }

    @staticmethod
    def _phrases(text: str) -> list:
        """Anchor points: the phrase boundaries the punctuation already marks."""
        import re as _re
        parts = [p for p in _re.split(r"(?<=[,;:—])\s+", text.strip()) if p.strip()]
        return parts or [text]

    @classmethod
    def _place(cls, tracks, chans):
        """Put each track where its `pan` says, in the requested layout.

        Constant-power panning (cos/sin), because a linear pan dips ~3 dB in the
        middle and a voice that quietens as it crosses the centre is worse than
        no panning at all. The LFE channel is left empty: it is a band, not a
        position, and a voice does not belong in it.
        """
        n = max(len(t) for t, _ in tracks)
        buf = np.zeros((n, chans))
        names = cls._LAYOUTS[chans]
        li = names.index("L") if "L" in names else 0
        ri = names.index("R") if "R" in names else min(1, chans - 1)
        ci = names.index("C") if "C" in names else None
        for t, pan in tracks:
            if len(t) < n:
                t = np.pad(t, (0, n - len(t)))
            p = max(-1.0, min(1.0, pan))
            if ci is not None and abs(p) < 1e-6:
                buf[:, ci] += t                      # dead centre gets the centre channel
                continue
            ang = (p + 1.0) * (np.pi / 4.0)          # -1 -> 0, +1 -> pi/2
            buf[:, li] += t * float(np.cos(ang))
            buf[:, ri] += t * float(np.sin(ang))
        return buf

    @classmethod
    def _fit(cls, y, n):
        """Resample y to exactly n samples."""
        if len(y) == n:
            return y
        if len(y) < 2:
            return np.resize(y, n).astype(np.float64)
        return np.interp(np.linspace(0, len(y) - 1, n), np.arange(len(y)), y)

    @classmethod
    def _sentences(cls, text: str) -> list:
        import re as _re
        if cls._SENT is None:
            cls._SENT = _re.compile(r"(?<=[.!?])\s+")
        return [t for t in cls._SENT.split(text.strip()) if t.strip()]

    def synth(self, text: str, *, voice: Optional[str] = None, rate: Optional[int] = None,
              pitch: Optional[float] = None, sentence_silence: Optional[float] = None,
              timeout: float = 1800.0, **_) -> Clip:
        rec = self._recipe(voice or "")
        layers = rec.get("layers") or []
        if not layers:
            raise RuntimeError(f"layered: recipe {voice!r} has no layers")
        ss = float(sentence_silence if sentence_silence else (rec.get("sentenceSilence") or 0))

        body_spec = layers[0]
        rest = layers[1:]
        eng_of = {}
        for L in layers:
            e = ENGINES.get(L.get("engine"))
            if e is None:
                raise RuntimeError(f"layered: unknown engine {L.get('engine')!r}")
            eng_of[id(L)] = e()

        def one(L, t):
            kw = {"voice": L.get("voice") or None, "timeout": timeout}
            if L.get("engine") == "piper":
                sp = float(L.get("speed") or 1.0)
                kw["rate"] = int(round(175.0 * sp)) if sp != 1.0 else None
                # a layer may be deepened as well as slowed; piper reaches pitch
                # through the declared sample rate, which the engine handles
                if L.get("pitch"):
                    kw["pitch"] = float(L["pitch"])
            else:
                kw["rate"] = L.get("rate") or None
            return eng_of[id(L)].synth(t, **kw)

        # RATE CALIBRATION, ONCE, FROM THE REAL TEXT. Resampling an overtone by
        # 1.67x does not only move it — it drags its formants down with it, so the
        # layer arrives both late and wrong. Correcting the overtone's own rate
        # first means the per-sentence resample is a nudge rather than a haul.
        sents = self._sentences(text) or [text]
        probe = " ".join(sents[:2])[:400]
        adj = {}
        try:
            bp = one(body_spec, probe)
            bd = len(bp.samples) / bp.sample_rate
            for L in rest:
                if L.get("engine") == "piper" or not L.get("rate"):
                    continue
                op = one(L, probe)
                od = len(op.samples) / op.sample_rate
                if bd > 0.2 and od > 0.2:
                    adj[id(L)] = max(80, min(450, int(round(float(L["rate"]) * (od / bd)))))
        except Exception:
            adj = {}

        def one_adj(L, t):
            if id(L) in adj:
                return eng_of[id(L)].synth(t, voice=L.get("voice") or None,
                                           rate=adj[id(L)], timeout=timeout)
            return one(L, t)

        # ONE LAYER HAS NOTHING TO ALIGN. The per-sentence split exists so two
        # engines that disagree about timing can be brought back together at every
        # sentence boundary; with a single layer there is no second timeline, and
        # splitting only costs a subprocess per sentence. LEADER is a single
        # shaped layer, and this is the difference between ~1x realtime and the
        # engine's own ~2.4x — about fifteen minutes on a document this size.
        if not rest:
            # the pause after every conclusion is the engine's own on this path,
            # so it is passed through rather than spliced between sentences
            kwb = {"voice": body_spec.get("voice") or None, "timeout": timeout}
            sp = float(body_spec.get("speed") or 1.0)
            if sp != 1.0:
                kwb["rate"] = int(round(175.0 * sp))
            if body_spec.get("pitch"):
                kwb["pitch"] = float(body_spec["pitch"])
            if ss:
                kwb["sentence_silence"] = float(ss)
            clip = eng_of[id(body_spec)].synth(text, **kwb)
            sr = clip.sample_rate
            mix = (clip.samples.astype(np.float64) / 32768.0) * float(body_spec.get("gain", 1.0))
            eq = rec.get("eq")
            if eq:
                mix = self._eq(mix, eq, sr)
            mix = np.tanh(mix * 0.9) / np.tanh(0.9)
            peak = float(np.abs(mix).max()) or 1.0
            out16 = (mix / peak * 0.89 * 32767.0).astype(np.int16)
            names = "+".join(str(L.get("voice") or L.get("engine")) for L in layers)
            return Clip(out16, sr, f"layered:{names}")

        chans = int(rec.get("channels") or 1)
        if chans not in self._LAYOUTS:
            raise RuntimeError("layered: channels must be one of %s"
                               % ", ".join(str(k) for k in sorted(self._LAYOUTS)))
        frames = []
        out = []
        sr = 22050
        for si, sent in enumerate(sents):
            body = one_adj(body_spec, sent)
            sr = body.sample_rate
            x0 = body.samples.astype(np.float64) / 32768.0
            if len(x0) < 8:
                continue
            tracks = [(x0 * float(body_spec.get("gain", 1.0)), float(body_spec.get("pan", 0.0)))]
            # ANCHORED FITTING. Where a layer asks for it, the sentence is cut at
            # its own punctuation and each piece is fitted separately, so the two
            # voices meet again at every comma rather than only at the full stop.
            # Fitting whole sentences leaves the middle free to drift, and a
            # drifting overlay is heard as a second speaker a beat behind.
            phr = self._phrases(sent) if any(L.get("anchor") for L in rest) else None
            body_pieces = None
            if phr and len(phr) > 1:
                bp = [one_adj(body_spec, p) for p in phr]
                if all(len(c.samples) > 4 for c in bp):
                    body_pieces = [c.samples.astype(np.float64) / 32768.0 for c in bp]
                    x0 = np.concatenate(body_pieces)
                    tracks[0] = (x0 * float(body_spec.get("gain", 1.0)),
                                 float(body_spec.get("pan", 0.0)))
            for L in rest:
                if L.get("anchor") and body_pieces:
                    segs = []
                    for pi_, ptxt in enumerate(phr):
                        c = one_adj(L, ptxt)
                        yy = c.samples.astype(np.float64) / 32768.0
                        segs.append(self._fit(yy, len(body_pieces[pi_])))
                    y = np.concatenate(segs)
                else:
                    c = one_adj(L, sent)
                    y = c.samples.astype(np.float64) / 32768.0
                    if len(y) < 2:
                        continue
                    y = self._fit(y, len(x0))
                b = L.get("band") or []
                if b:
                    y = self._band(y, b[0] if len(b) > 0 else 0, b[1] if len(b) > 1 else 0, sr)
                tracks.append((y * float(L.get("gain", 1.0)), float(L.get("pan", 0.0))))
            mix = tracks[0][0].copy()
            for t, _ in tracks[1:]:
                mix = mix + t
            if chans > 1:
                frames.append(self._place(tracks, chans))
            out.append(mix)
            if ss > 0 and si < len(sents) - 1:
                out.append(np.zeros(int(sr * ss)))
                if chans > 1:
                    frames.append(np.zeros((int(sr * ss), chans)))

        if not out:
            raise RuntimeError("layered: nothing synthesised")
        if chans > 1 and frames:
            multi = np.concatenate(frames, axis=0)
            eq = rec.get("eq")
            if eq:
                for ch in range(multi.shape[1]):
                    multi[:, ch] = self._eq(multi[:, ch], eq, sr)
            multi = np.tanh(multi * 0.9) / np.tanh(0.9)
            peak = float(np.abs(multi).max()) or 1.0
            flat = (multi / peak * 0.89 * 32767.0).astype(np.int16).reshape(-1)
            names = "+".join(str(L.get("voice") or L.get("engine")) for L in layers)
            return Clip(flat, sr, "layered:%s:%dch" % (names, chans))

        mix = np.concatenate(out)
        eq = rec.get("eq")
        if eq:
            mix = self._eq(mix, eq, sr)
        # headroom then a soft knee: the layers sum past 1.0 on stressed syllables
        mix = np.tanh(mix * 0.9) / np.tanh(0.9)
        peak = float(np.abs(mix).max()) or 1.0
        out16 = (mix / peak * 0.89 * 32767.0).astype(np.int16)
        names = "+".join(str(L.get("voice") or L.get("engine")) for L in layers)
        return Clip(out16, sr, f"layered:{names}")


ENGINES = {"piper": Piper, "espeak-ng": EspeakNG, "pyttsx3": Pyttsx3Engine,
           "voicey": VoiceyNeural, "layered": Layered}


# ── voice fingerprints ───────────────────────────────────────────────────────
# A voice NAME is not a voice. espeak-ng resolves "en-gb-x-rp+jaimla" by reading
# <data>/voices/!v/jaimla, and if that file is absent it does not fail — it
# speaks the BASE voice and says nothing. piper likewise falls back to its first
# installed model when the named one is missing. So a rendering cached while a
# variant was missing (or made before a variant was retuned) is audio from a
# DIFFERENT voice filed under the name it was asked for, and a key built from the
# name alone declares it valid forever.
#
# That is not hypothetical: the variants were installed at 12:23 on 2026-09-01
# and every espeak rendering before it had silently been the base voice. The
# picker looked broken — LEADER, SAM, ANCIENT and JAIMLA were one RP voice at
# four speeds — because the cache was answering with pre-install audio.
#
# The fix is to key on the voice DEFINITION. Cheap: the variant file is ~2.5 KB,
# and a piper model is identified by its (small) .onnx.json plus the .onnx size
# and mtime — hashing 63 MB on every request would cost more than it protects.
_FP_CACHE: dict = {}


def _espeak_data_dir(binary: str) -> Optional[str]:
    """Ask espeak-ng where its data lives; never guess a distro path."""
    key = ("espeak_data", binary)
    if key in _FP_CACHE:
        return _FP_CACHE[key]
    d = None
    try:
        r = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=10)
        m = (r.stdout or "") + (r.stderr or "")
        if "Data at:" in m:
            d = m.split("Data at:", 1)[1].strip().split("\n")[0].strip()
    except Exception:
        d = None
    if not d:
        for c in ("/usr/lib/x86_64-linux-gnu/espeak-ng-data", "/usr/share/espeak-ng-data",
                  "/usr/local/share/espeak-ng-data", os.environ.get("ESPEAK_DATA_PATH") or ""):
            if c and os.path.isdir(os.path.join(c, "voices")):
                d = c
                break
    _FP_CACHE[key] = d
    return d


def _espeak_voice_file(data: str, name: str) -> Optional[str]:
    """The file that DEFINES this base voice, under <data>/voices/ or <data>/lang/.

    espeak-ng finds a voice by scanning both trees for a file whose `language`
    line matches; the filename is conventionally the code, so match on that.
    Returns None when nothing matches — a base we do not own (or a bad name),
    which the caller treats as "nothing host-local to fingerprint".
    """
    key = ("voicefile", data, name)
    if key in _FP_CACHE:
        return _FP_CACHE[key]
    hit = None
    want = name.strip().lower()
    for root in (os.path.join(data, "voices"), os.path.join(data, "lang")):
        for dirpath, _dirs, files in os.walk(root):
            if os.path.basename(dirpath) == "!v":       # variants, not bases
                continue
            for fn in files:
                if fn.lower() == want:
                    hit = os.path.join(dirpath, fn)
                    break
            if hit:
                break
        if hit:
            break
    _FP_CACHE[key] = hit
    return hit


def _stamp(path) -> str:
    try:
        st = os.stat(path)
        return f"{st.st_size}:{int(st.st_mtime)}"
    except OSError:
        return "-"


def voice_fingerprint(engine_id: str, voice: str = "") -> str:
    """What the named voice ACTUALLY is right now, as a short digest.

    Part of the cache key, so retuning a variant or installing a missing one
    invalidates exactly the renderings that used it and nothing else. Returns
    "" when there is nothing host-local to fingerprint (voicey is remote,
    pyttsx3 is the system's own), which keeps those keys unchanged.
    """
    try:
        if engine_id == "layered":
            # A LAYERED VOICE IS ITS RECIPE, and the recipe is not in the Spec.
            #
            # LEADER's overtone band moved from 700-3200 Hz to 150-620 Hz — the
            # difference between a second person talking and a timbre — and the
            # cache served the old audio, because engine, voice, rate, pitch and
            # sentence_silence were all unchanged. Nothing in the key had moved,
            # so nothing was rebuilt.
            #
            # The fingerprint is the recipe itself PLUS the fingerprint of every
            # voice it is built from, recursively: retuning the espeak variant
            # that LEADER wears as an overtone has to invalidate LEADER too, and
            # that variant's own fingerprint is what notices.
            rec = Layered()._recipe(voice or "")
            parts = [json.dumps(rec.get("layers"), sort_keys=True),
                     str(rec.get("sentenceSilence") or "")]
            for L in rec.get("layers") or []:
                parts.append(voice_fingerprint(L.get("engine") or "", L.get("voice") or ""))
            return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:16]
        if engine_id == "espeak-ng":
            eng = EspeakNG()
            base, _, variant = (voice or DEFAULT_VOICE).partition("+")
            data = _espeak_data_dir(eng.binary)
            if not data:
                return "nodata"
            bits = [_stamp(os.path.join(data, "voices"))]
            # The BASE is a file too, and since en-earth it is a file WE edit.
            # Stamping only the voices/ directory is not enough: editing
            # voices/mindx/en-earth does not change voices/'s own mtime, so a
            # retuned accent would keep serving the cached audio of the old one
            # — the exact bug that made the picker look dead. Hash the base.
            bp = _espeak_voice_file(data, base)
            if bp:
                try:
                    with open(bp, "rb") as fh:
                        bits.append(hashlib.sha256(fh.read()).hexdigest()[:16])
                except OSError:
                    bits.append("BASEUNREADABLE")
            if variant:
                vp = os.path.join(data, "voices", "!v", variant)
                try:
                    with open(vp, "rb") as fh:                 # the definition itself: ~2.5 KB
                        bits.append(hashlib.sha256(fh.read()).hexdigest()[:16])
                except OSError:
                    bits.append("MISSING")                     # a missing variant is its own key
            return "|".join([base] + bits)
        if engine_id == "piper":
            p = Piper()
            v = voice if voice and voice in p.voices() else (p.default_voice() or "")
            if not v:
                return "novoice"
            onnx = p.voices_dir / f"{v}.onnx"
            try:
                cfg = hashlib.sha256((onnx.parent / f"{v}.onnx.json").read_bytes()).hexdigest()[:16]
            except OSError:
                cfg = "-"
            return f"{v}|{_stamp(onnx)}|{cfg}"
    except Exception:
        return "err"
    return ""
# What "auto" means for a DOCUMENT: the best reader that is CHEAP ENOUGH. piper (neural,
# ~10x realtime measured) when its model is installed; the 90s tier (~800x) otherwise.
READER_ORDER = ("piper", "espeak-ng", "pyttsx3")


def pick(name: str = "auto"):
    """The engine to use. `auto` never picks the neural tier for a document —
    that is a choice a caller makes on purpose (and pays for)."""
    if name in ("auto", "", None):
        for n in READER_ORDER:
            e = ENGINES[n]()
            if e.available():
                return e
        raise RuntimeError("no document reader available: install espeak-ng (apt install espeak-ng) or piper (pip install piper-tts + a voice in data/models/piper/)")
    if name not in ENGINES:
        raise ValueError(f"unknown engine '{name}' (choose from {', '.join(ENGINES)})")
    e = ENGINES[name]()
    if not e.available():
        raise RuntimeError(f"engine '{name}' is not available on this host")
    return e


def capability() -> dict:
    """What this host can actually do, proven not assumed."""
    out = {}
    for n, cls in ENGINES.items():
        try:
            out[n] = bool(cls().available())
        except Exception:
            out[n] = False
    out["reader"] = next((n for n in READER_ORDER if out.get(n)), None)
    try:
        out["piper_voices"] = Piper().voices()
    except Exception:
        out["piper_voices"] = []
    return out
