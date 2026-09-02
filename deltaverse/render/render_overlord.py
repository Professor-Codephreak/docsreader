#!/usr/bin/env python3
"""Render the DeltaVerse OVERLORD voice: ancient and leader, layered.

The other four DeltaVerse voices are piper derivations of neural — a stated ratio
on one model (render_derived.py). OVERLORD deliberately is not, and this file is
the reason it is allowed not to be: it is not a ratio on somebody else's voice,
it is its OWN voice, assembled from the two mindX voices the tier is named after.

  BODY     en-earth+overlord     the combination itself, in the variant file:
                                 leader's mass and curve, ancient's refusal to
                                 modulate. f0 ~79 Hz, below both parents.
  OCTAVE   en-earth+overlordsub  written at render time by octave.calibrate(),
                                 which MEASURES the body and binary-searches the
                                 sub's pitch parameter until it lands an octave
                                 under it. Halving the pitch NUMBER does not do
                                 this — see octave.py for the arithmetic that
                                 was wrong and how far off it was. ~40 Hz: felt,
                                 not heard. Low-passed and mixed under.
  OVERLAY  en-gb-x-rp+ancient    the parent that contributes texture rather than
                                 tone — rasp, age, the absolutes. High-passed so
                                 it adds grain in the presence band instead of a
                                 second voice in the mud.

ALIGNMENT IS THE WHOLE PROBLEM. espeak's duration is not pitch-invariant (~1-2%
across the range) and ancient's stressLength makes it ~16% shorter than overlord
on the same text. Layers that are not co-terminous do not sound deep, they sound
doubled. So: ancient is coarse-matched with -s, then EVERY layer is resampled to
the body's exact sample count PER BLOCK, which bounds the drift to one sentence
instead of letting it accumulate over the document. The residual resample ratio
is measured and printed; it is also what the octave error is, so it is reported
in the manifest rather than being claimed to be zero.
"""
import json, subprocess, sys, wave, time, tempfile
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import octave

VAR   = Path("/usr/lib/x86_64-linux-gnu/espeak-ng-data/voices/!v")
DOC   = sys.argv[1] if len(sys.argv) > 1 else "voices"
BLOCKS = json.load(open("/tmp/blocks.json"))
SR = 22050

BODY_S    = 118       # words/min — leader's docspeech rate; this voice is slower than speech
ANCIENT_S = 99        # coarse match for ancient's shorter stressLength (measured below)
G_OCT     = 0.55      # the octave, under the body
G_ANC     = 0.30      # the overlay, behind it
LP_OCT    = 190.0     # the octave is a sub: everything above this is the body's job
HP_ANC    = 900.0     # the overlay is texture: everything below this is mud


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
    that kernel is SHORT: at 190 Hz it is under 1e-7 by 350 samples, at 900 Hz by
    75. So the recurrence becomes an FFT convolution against a truncated kernel,
    identical to within the truncation and without a Python loop over a million
    samples. (The closed-form cumsum trick for this recurrence divides by a**i
    and overflows on any signal longer than a second; do not reach for it.)
    """
    a = float(np.exp(-2.0 * np.pi * fc / SR))
    n = min(len(x), int(np.ceil(np.log(1e-7) / np.log(a))) + 1)
    k = (1 - a) * a ** np.arange(n, dtype=np.float64)
    m = 1 << int(np.ceil(np.log2(len(x) + n)))
    y = np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(k, m), m)[:len(x)].astype(np.float32)
    return (x - y).astype(np.float32) if high else y


filt = onepole


cal = octave.calibrate(BODY_S)
if not cal.get("ok"):
    raise SystemExit("octave calibration failed: %s" % cal.get("why"))
print("  octave calibrated: pitch %d -> %d   %.1f Hz -> %.1f Hz (target %.1f, %+.1f cents)"
      % (cal["bodyPitch"], cal["subPitch"], cal["bodyF0"], cal["subF0"],
         cal["targetF0"], cal["errorCents"]))
base, sbase = cal["bodyPitch"], cal["subPitch"]

t0 = time.time()
pcm, marks, ratios = [], [], []
for i, b in enumerate(BLOCKS):
    body = synth("en-earth+overlord", b["text"], BODY_S)
    n = len(body)
    marks.append({"block": i, "at": round(sum(len(p) for p in pcm) / SR, 3)})

    oct_ = synth("en-earth+overlordsub", b["text"], BODY_S)
    anc  = synth("en-gb-x-rp+ancient",   b["text"], ANCIENT_S)
    ratios.append((len(oct_) / n, len(anc) / n))

    mix = body + G_OCT * filt(fit(oct_, n), LP_OCT) + G_ANC * filt(fit(anc, n), HP_ANC, high=True)

    # headroom, then a soft knee — the three layers sum past 1.0 on stressed
    # syllables and hard clipping on a voice this low is audible as a rattle
    mix = np.tanh(mix * 0.85) / np.tanh(0.85)
    pcm.append(mix.astype(np.float32))
    pcm.append(np.zeros(int(SR * 0.35), dtype=np.float32))

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

ro = [a for a, _ in ratios]; ra = [b for _, b in ratios]
manifest = {
    "doc": DOC, "voice": "overlord", "voiceName": "OVERLORD",
    "derivedFrom": "not a derivation — ancient and leader, combined and layered",
    "engine": "espeak-ng 3-layer mix -> opusenc 24kbps mono",
    "engineNote": ("BODY en-earth+overlord (the combination, in the variant file) + "
                   "OCTAVE the same variant calibrated an octave under it (%+.0f cents), low-passed %.0f Hz at %.2f + "
                   "OVERLAY en-gb-x-rp+ancient, high-passed %.0f Hz at %.2f. "
                   "Every layer is resampled to the body's exact length per block."
                   % (cal["errorCents"], LP_OCT, G_OCT, HP_ANC, G_ANC)),
    "parents": {"body": "en-earth+leaderofearth", "texture": "en-gb-x-rp+ancient"},
    "layers": [
        {"role": "body",    "voice": "en-earth+overlord",    "pitch": base,  "gain": 1.0,
         "f0Hz": cal["bodyF0"]},
        {"role": "octave",  "voice": "en-earth+overlordsub", "pitch": sbase, "gain": G_OCT,
         "lowpassHz": LP_OCT, "f0Hz": cal["subF0"], "errorCents": cal["errorCents"],
         "note": "searched against the measured body, not halved — see render/octave.py"},
        {"role": "overlay", "voice": "en-gb-x-rp+ancient",   "wpm": ANCIENT_S,       "gain": G_ANC,
         "highpassHz": HP_ANC},
    ],
    "octave": cal,
    "alignment": {"octaveStretchMedian": round(float(np.median(ro)), 4),
                  "octaveStretchMax": round(float(np.max(np.abs(np.array(ro) - 1))), 4),
                  "ancientStretchMedian": round(float(np.median(ra)), 4),
                  "note": ("per-block time alignment. This stretch DETUNES the octave on "
                           "top of its calibration error: a median of %.2f%% is a further "
                           "%.0f cents" % (abs(np.median(ro) - 1) * 100,
                                           abs(np.log2(np.median(ro))) * 1200))},
    "wpm": BODY_S, "sampleRate": SR,
    "generated": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
    "blocks": len(BLOCKS), "seconds": round(seconds, 3), "bytes": opus.stat().st_size,
    "parts": [{"n": 1, "file": "part-01.opus", "url": "/audio/%s/overlord/part-01.opus" % DOC,
               "seconds": round(seconds, 3), "bytes": opus.stat().st_size,
               "from": 0, "to": len(BLOCKS) - 1, "marks": marks}],
}
(outdir / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
print("  overlord  3 layers  %6.1fs  %4.0f KB  octave %+.0f cents, alignment %+.0f more  (%.0fs)"
      % (seconds, opus.stat().st_size / 1024, cal["errorCents"],
         abs(np.log2(np.median(ro))) * 1200, time.time() - t0))
