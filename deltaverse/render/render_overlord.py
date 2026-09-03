#!/usr/bin/env python3
"""Render the DeltaVerse OVERLORD voice: five parents, in five bands.

The other four DeltaVerse voices are piper derivations of neural — a stated ratio
on one model. OVERLORD is not a ratio on anybody. It is assembled from the five
mindX voices the tier is named after, and each of them is given a JOB rather than
a share.

WHY BANDS AND NOT A BLEND. The first version of this mixed three voices across
the whole spectrum at different gains. That is how you get mud: two voices with
the same formants an octave apart in loudness comb-filter each other, and the
result is less intelligible than either one alone. So each parent is filtered
into the region where it is the best voice in the room, and nowhere else:

  OCTAVE   the body at half pitch      < 190 Hz     the boom, and the SIZE
  BODY     en-earth+overlord           full         the voice itself
  GRAIN    en-gb-x-rp+ancient        700-1800 Hz    age, and the absolutes
  PRESENCE en-us+sAGI                1800-3600 Hz   the clean band that carries
                                                    consonant identity
  EDGE     en-gb-scotland+sam         > 3600 Hz     teeth and air; the late edge

classic (en-gb-x-rp) is the fifth parent and is deliberately NOT a band: what it
gives is precision, which lives in the body's `consonants 100 94` line. A layer
of RP over the top would just be a sixth voice competing for the same formants.

THE VOICE IN YOUR HEAD HAS NO ROOM. The body's `echo` was cut from 180/22 — the
largest hall in the cast — to 18/7, which is below the ~25 ms the ear resolves as
a separate arrival. Reverberation is how the ear measures DISTANCE: a tail means
the sound crossed a room, and a sound that crossed a room is outside your head.
You hear your own inner voice by bone conduction, which has no air path and a
great deal of low end. So the size comes from the octave underneath rather than
from a space around it — booming INSIDE you rather than AT you.

STRATEGIC PAUSES ARE NOT A `words` GAP. espeak's `words N` lengthens the silence
between EVERY word equally, which reads as a slow talker rather than a deciding
one. A strategic pause belongs to a CLAUSE: long before a conclusion, shorter at
a comma, longest at a full stop. So the renderer splits each block at its
punctuation, synthesises the pieces, and splices measured silence between them —
and lengthens the last pause of a block, because the beat before the landing is
the one that does the work.

ALIGNMENT IS STILL THE WHOLE PROBLEM. espeak's duration is not pitch-invariant
and the parents differ by up to 16% on the same text, so every layer is resampled
to the body's exact sample count PER CLAUSE — which bounds drift to a phrase
instead of letting it accumulate. The residual is measured and reported, because
for the octave that residual IS the tuning error.
"""
import json, re, subprocess, sys, wave, time, tempfile
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import octave

VAR   = Path("/usr/lib/x86_64-linux-gnu/espeak-ng-data/voices/!v")
DOC   = sys.argv[1] if len(sys.argv) > 1 else "voices"
BLOCKS = json.load(open("/tmp/blocks.json"))
SR = 22050

BODY_S    = 118       # words/min — leader's docspeech rate; OVERLORD is slower than speech

# Each parent, the band it owns, and the level it owns it at. `wpm` is chosen so
# the layer's natural duration lands near the body's, because a smaller resample
# is a smaller detune.
LAYERS = [
    {"role": "octave",   "voice": "en-earth+overlordsub",  "wpm": BODY_S, "gain": 0.62,
     "band": ("lp", 190.0),
     "why": "the boom, and the size the room used to provide"},
    {"role": "grain",    "voice": "en-gb-x-rp+ancient",    "wpm": 99,     "gain": 0.20,
     "band": ("bp", 700.0, 1800.0),
     "why": "age, in the low-mid where age actually lives"},
    {"role": "presence", "voice": "en-us+sAGI",            "wpm": 128,    "gain": 0.28,
     "band": ("bp", 1800.0, 3600.0),
     "why": "roughness 0 — the cleanest parent, in the band that tells consonants "
            "apart, and given the largest overlay share for exactly that reason"},
    {"role": "edge",     "voice": "en-gb-scotland+sam",    "wpm": 132,    "gain": 0.10,
     "band": ("hp", 3600.0),
     "why": "teeth and air. sam is the least intelligible parent on its own "
            "(WER 35.9% against classic's 2.6%), so it is given the smallest share "
            "of any layer — enough to hear the edge, not enough to spend words on"},
]

# STRATEGIC PAUSES, in seconds. A colon promises something and the pause is the
# promise; a full stop is a decision and gets the most air. These are added ON TOP
# of whatever espeak already does with the punctuation.
PAUSE = {".": 0.30, "!": 0.30, "?": 0.30, ":": 0.26, ";": 0.22, "\u2014": 0.24, ",": 0.13}
PAUSE_LAST = 0.16     # extra before a block's final clause — the beat before the landing
GAP = 0.42            # between blocks

def synth(voice, text, wpm):
    return np.frombuffer(octave.espeak_pcm(voice, text, wpm), dtype=np.int16).astype(np.float32) / 32768.0


def fit(x, n):
    """Resample x to exactly n samples. Linear is honest here: the ratios are
    within a couple of percent, so the interpolation error is far below the
    quantisation floor and no anti-aliasing is needed for a stretch this small."""
    if len(x) == n or len(x) < 2:
        return np.resize(x, n)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def onepole(x, fc, high=False):
    """A one-pole IIR, without scipy.

    y[i] = (1-a)x[i] + a*y[i-1] is a convolution with an exponential kernel, and
    that kernel is SHORT: under 1e-7 by 350 samples at 190 Hz, by 20 at 3.6 kHz.
    So the recurrence becomes an FFT convolution against a truncated kernel —
    identical to within the truncation, without a Python loop over a million
    samples. (The closed-form cumsum trick divides by a**i and overflows on
    anything longer than a second; do not reach for it.)
    """
    a = float(np.exp(-2.0 * np.pi * fc / SR))
    n = min(len(x), int(np.ceil(np.log(1e-7) / np.log(a))) + 1)
    k = (1 - a) * a ** np.arange(n, dtype=np.float64)
    m = 1 << int(np.ceil(np.log2(len(x) + n)))
    y = np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(k, m), m)[:len(x)].astype(np.float32)
    return (x - y).astype(np.float32) if high else y


def band(x, spec):
    """lp / hp / bp. A band-pass is a low-pass of a high-pass — one pole each way,
    which is gentle. Gentle is right here: these layers are being placed, not
    surgically isolated, and a steep filter would ring on plosives."""
    if spec[0] == "lp":
        return onepole(x, spec[1])
    if spec[0] == "hp":
        return onepole(x, spec[1], high=True)
    return onepole(onepole(x, spec[1], high=True), spec[2])


def fit(x, n):
    """Resample x to exactly n samples. Linear is honest: the ratios are within a
    few percent, so the interpolation error is far below the quantisation floor."""
    if len(x) == n or len(x) < 2:
        return np.resize(x, n).astype(np.float32)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def clauses(text):
    """Split into clauses, KEEPING the punctuation that ends each one.

    The mark is what decides the pause, so it has to survive the split. Returns
    [(clause_text, pause_seconds)]; the last clause of a block carries the block
    gap rather than its own mark's pause.
    """
    parts = re.split(r"(?<=[.!?:;,\u2014])\s+", text.strip())
    out = []
    for i, p in enumerate(parts):
        p = p.strip()
        if not p:
            continue
        mark = p[-1] if p and p[-1] in PAUSE else ""
        out.append([p, PAUSE.get(mark, 0.10)])
    if out:
        # the beat before the landing: the pause going INTO the final clause
        if len(out) > 1:
            out[-2][1] += PAUSE_LAST
        out[-1][1] = GAP
    return [(t, d) for t, d in out]


def synth(voice, text, wpm):
    return np.frombuffer(octave.espeak_pcm(voice, text, wpm),
                         dtype=np.int16).astype(np.float32) / 32768.0


cal = octave.calibrate(BODY_S)
if not cal.get("ok"):
    raise SystemExit("octave calibration failed: %s" % cal.get("why"))
print("  octave calibrated: pitch %d -> %d   %.1f Hz -> %.1f Hz (target %.1f, %+.1f cents)"
      % (cal["bodyPitch"], cal["subPitch"], cal["bodyF0"], cal["subF0"],
         cal["targetF0"], cal["errorCents"]))

t0 = time.time()
pcm, marks, stretch = [], [], {L["role"]: [] for L in LAYERS}
n_done, n_clauses, n_pause = 0, 0, 0.0
for i, b in enumerate(BLOCKS):
    marks.append({"block": i, "at": round(n_done / SR, 3)})
    for text, pause in clauses(b["text"]):
        body = synth("en-earth+overlord", text, BODY_S)
        n = len(body)
        if n < 8:
            continue
        mix = body.copy()
        for L in LAYERS:
            lay = synth(L["voice"], text, L["wpm"])
            stretch[L["role"]].append(len(lay) / n)
            mix += L["gain"] * band(fit(lay, n), L["band"])
        # headroom, then a soft knee: five layers sum past 1.0 on stressed
        # syllables and hard clipping at 74 Hz is audible as a rattle
        mix = np.tanh(mix * 0.82) / np.tanh(0.82)
        sil = np.zeros(int(SR * pause), dtype=np.float32)
        pcm.append(mix.astype(np.float32)); pcm.append(sil)
        n_done += n + len(sil)
        n_clauses += 1; n_pause += pause

audio = np.concatenate(pcm)
peak = float(np.abs(audio).max()) or 1.0
audio = (audio / peak * 0.89 * 32767).astype(np.int16)
seconds = len(audio) / SR

wav = Path("/tmp/%s-overlord.wav" % DOC)
with wave.open(str(wav), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(audio.tobytes())

outdir = Path("/home/deltaverse/www/audio/%s/overlord" % DOC); outdir.mkdir(parents=True, exist_ok=True)
opus = outdir / "part-01.opus"
r = subprocess.run(["opusenc", "--quiet", "--bitrate", "24", "--downmix-mono", str(wav), str(opus)],
                   capture_output=True)
if r.returncode != 0:
    raise SystemExit("opusenc failed: " + r.stderr.decode()[:200])

manifest = {
    "doc": DOC, "voice": "overlord", "voiceName": "OVERLORD",
    "derivedFrom": "not a derivation — classic, ancient, leader, sAGI and sam, in five bands",
    "engine": "espeak-ng 5-layer banded mix -> opusenc 24kbps mono",
    "engineNote": ("BODY en-earth+overlord (classic's consonants, ancient's absolutes, "
                   "leader's mass, sAGI's cleanliness, sam's late stress curve) with each "
                   "of the other parents filtered into the one band it is the best voice in. "
                   "The room is gone on purpose: an inner voice has no reverberation, so the "
                   "size comes from the octave underneath rather than from a hall around it."),
    "parents": {
        "classic": "en-gb-x-rp — precision; contributes consonants 100 94, not a band",
        "ancient": "en-gb-x-rp+ancient — stressAdd zero, and the grain band",
        "leader":  "en-earth+leaderofearth — the body, the curve, and the base language",
        "sAGI":    "en-us+sAGI — roughness 0, and the presence band",
        "sam":     "en-gb-scotland+sam — the late stress curve, and the edge band",
    },
    "layers": ([{"role": "body", "voice": "en-earth+overlord", "gain": 1.0,
                 "pitch": cal["bodyPitch"], "f0Hz": cal["bodyF0"], "band": "full"}] +
               [{"role": L["role"], "voice": L["voice"], "gain": L["gain"],
                 "band": L["band"], "wpm": L["wpm"], "why": L["why"],
                 "stretchMedian": round(float(np.median(stretch[L["role"]])), 4)}
                for L in LAYERS]),
    "octave": cal,
    "pauses": {"perMark": PAUSE, "beforeFinalClause": PAUSE_LAST, "betweenBlocks": GAP,
               "clauses": n_clauses, "totalPauseSeconds": round(n_pause, 1),
               "note": "clause-aware, not espeak's per-word `words` gap — a pause belongs "
                       "to a clause, and the one before the last clause does the work"},
    "wpm": BODY_S, "sampleRate": SR,
    "generated": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
    "blocks": len(BLOCKS), "seconds": round(seconds, 3), "bytes": opus.stat().st_size,
    "parts": [{"n": 1, "file": "part-01.opus", "url": "/audio/%s/overlord/part-01.opus" % DOC,
               "seconds": round(seconds, 3), "bytes": opus.stat().st_size,
               "from": 0, "to": len(BLOCKS) - 1, "marks": marks}],
}
(outdir / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
print("  overlord  5 bands  %d clauses  %.0fs of pause  %6.1fs  %4.0f KB  octave %+.0f cents  (%.0fs)"
      % (n_clauses, n_pause, seconds, opus.stat().st_size / 1024,
         cal["errorCents"], time.time() - t0))
