#!/usr/bin/env python3
"""Render a DeltaVerse audio-store voice with the ACTUAL neural engine.

The store's `neural` was espeak-ng wearing the name. mindX's neural is piper /
en_GB-alan-medium (data/config/docspeech_voices.json -> templates.neural), and
this renders the same voice into the same store layout the reader already reads:

    /audio/<doc>/<voice>/part-01.opus  +  manifest.json with per-block marks

Alignment is by block INDEX, not by text, so the source-case text rendered here
lines up with the CSS-uppercased text the reader highlights.
"""
import json, subprocess, sys, wave, struct, os, time, hashlib
import numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mindx_voice

# THE VOICE IS MOVED, NOT COPIED.
#
# Matching mindX's parameters was not enough and could not have been, because
# two things were still different and neither is a parameter:
#
#   THE SYNTHESISER CALL. This file shelled out to piper itself. Same binary,
#   same flags — but a second implementation of the same call, and the two had
#   already drifted once over exactly this.
#
#   THE ENCODER, which is the one you can hear. mindX encodes through the system
#   libsndfile via ctypes; this used `opusenc --bitrate 24`. Two different
#   encoders at a low bitrate do not produce the same artefacts, and 24 kbps is
#   low enough that the artefacts are the character. No amount of matching
#   length-scale and sentence-silence closes that gap.
#
# So the store is now produced BY mindX's pipeline rather than by something that
# agrees with it: docspeech's Piper engine synthesises and docspeech's encode_ogg
# writes the file. There is one implementation of the neural voice, and this is a
# caller of it.
_ROOT = Path("/home/mindx/mindX")
if not (_ROOT / "utils").is_dir():
    _ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_ROOT))
from utils.docspeech.engines import Piper as _MindXPiper       # noqa: E402
from utils.docspeech.ogg import encode_ogg as _mindx_encode    # noqa: E402


DOC   = sys.argv[1] if len(sys.argv) > 1 else "voices"
VOICE = sys.argv[2] if len(sys.argv) > 2 else "neural"
BLOCKS = json.load(open("/tmp/blocks.json"))
PIPER = "/home/mindx/mindX/.mindx_env/bin/piper"
MODEL = "/home/mindx/mindX/data/models/piper/en_GB-alan-medium.onnx"
OUT   = Path(f"/home/deltaverse/www/audio/{DOC}/{VOICE}")

# THE SAME VOICEPRINT, WHICH MEANS THE SAME PARAMETERS.
#
# This went back and forth twice, so the reasoning is written down.
#
# The instinct was that neural is defined by being invoked with NO flags, and
# that adding any — even a neutral-looking one — was adjusting the reference. But
# invoking it bare does not preserve the reference; it preserves PIPER'S
# defaults, which are a different thing and are not what mindX's neural sounds
# like. mindX's docspeech has always passed a length-scale and a sentence-silence,
# so a bare invocation here produced a DIFFERENT voice wearing the same name: no
# gap between sentences at all, because piper's own default is 0.0.
#
# neural's DEFINITION is its entry in docspeech_voices.json — engine auto, no
# rate, no pitch — and that entry is untouched and must stay untouched. What
# those words MEAN in piper arguments is computed by docspeech, calibration and
# all, and this reads that computation rather than re-deriving it. So there is
# one definition, one place that interprets it, and the store renders exactly
# what the reader would. Retune neural in the registry and both follow.
VP = mindx_voice.params("neural")
MODEL = str(Path(MODEL).parent / (VP["model"] + ".onnx"))
_ENGINE = _MindXPiper()


def synth(text):
    """mindX's own engine, called the way mindX calls it.

    neural sends no rate and no pitch — its entry carries neither — so nothing is
    passed here either. Whatever the engine decides those absences mean, the
    store gets the same answer the reader gets.
    """
    clip = _ENGINE.synth(text, voice=VP["model"])
    return clip.samples.tobytes()


def _unused_direct_piper(text):
    r = subprocess.run([PIPER, "--model", MODEL, "--output-raw"],
                       input=text.encode("utf-8"), capture_output=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError(f"piper rc={r.returncode}: {r.stderr.decode()[:160]}")
    return r.stdout                      # 16-bit mono PCM

def rate_of():
    cfg = json.load(open(MODEL + ".json"))
    return int(cfg.get("audio", {}).get("sample_rate") or 22050)

SR = rate_of()
pcm = bytearray()
marks = []
t0 = time.time()
for i, b in enumerate(BLOCKS):
    marks.append({"block": i, "at": round(len(pcm) / 2 / SR, 3)})
    pcm += synth(b["text"])
    pcm += b"\x00\x00" * int(SR * 0.35)          # a breath between blocks
seconds = len(pcm) / 2 / SR

wav = Path(f"/tmp/{DOC}-{VOICE}.wav")
with wave.open(str(wav), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(bytes(pcm))

OUT.mkdir(parents=True, exist_ok=True)
opus = OUT / "part-01.opus"
# mindX's own encoder. This was `opusenc --bitrate 24`; mindX writes through the
# system libsndfile via ctypes, and at 24 kbps two encoders do not leave the same
# artefacts — which at that bitrate IS the character of the sound. Same encoder
# now, so the store and the reader differ in nothing.
_enc = _mindx_encode(np.frombuffer(pcm, dtype="<i2"), SR, opus, codec="opus")

manifest = {
    "doc": DOC, "voice": VOICE, "voiceName": "Neural",
    "derivedFrom": "the reference",
    "engine": "mindX docspeech: piper %s -> libsndfile Ogg/Opus" % VP["model"],
    "encoder": _enc,
    # THE PARAMETERS, IN THE ARTIFACT. "the same voiceprint as mindX's neural"
    # should be checkable by anyone holding the file, not only by someone who can
    # read both renderers. These are what was actually passed to piper.
    "lengthScale": VP["lengthScale"],
    "sentenceSilence": VP["sentenceSilence"],
    "speedCalibration": VP["calibration"],
    "clonedFrom": VP["source"],
    "engineNote": ("the ACTUAL neural voice mindX uses for /doc/MANIFESTO — "
                   "data/config/docspeech_voices.json templates.neural"),
    "model": "en_GB-alan-medium.onnx",
    "sampleRate": SR,
    "generated": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
    "blocks": len(BLOCKS),
    "seconds": round(seconds, 3),
    "bytes": opus.stat().st_size,
    "parts": [{"n": 1, "file": "part-01.opus", "url": f"/audio/{DOC}/{VOICE}/part-01.opus",
               "seconds": round(seconds, 3), "bytes": opus.stat().st_size,
               "from": 0, "to": len(BLOCKS) - 1, "marks": marks}],
}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
print(f"  {DOC}/{VOICE}: {len(BLOCKS)} blocks, {seconds:.1f}s, "
      f"{opus.stat().st_size/1024:.0f} KB, {SR} Hz, rendered in {time.time()-t0:.0f}s")
print(f"  engine: piper en_GB-alan-medium (was espeak-ng)")
