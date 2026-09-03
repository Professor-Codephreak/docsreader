#!/usr/bin/env python3
"""OVERLORD — the two neural voices, speaking at once.

A TEST, AND AN INTERESTING ONE. OVERLORD was a five-band espeak build: leader's
mass, ancient's absolutes, sam's edge, sAGI's presence, with a calibrated octave
underneath. It is a good voice and it is unmistakably a formant synthesiser. This
is the other idea — take the two NEURAL voices the realm already has, the male
reference and the female one, and have them say the same words at the same time.

Two people speaking in unison is a sound with no single owner. It is what a choir
does to a solo line, and what a crowd does to a chant: the pitch stops belonging
to a person and starts belonging to the statement. That is a better argument for
"OVERLORD" than any amount of reverb on one voice.

THE HARD PART IS THAT THEY DO NOT AGREE ON TIMING. Same model family, same
sentence, different durations — alan and jenny distribute their time differently,
and the difference is not constant. Aligning once per block puts them in unison
at the start and a syllable apart by the end, which is the exact failure the
LEADER overtone had (measured there: 1.53x to 1.81x sentence to sentence on a
1.67x average, so no single stretch factor is right twice).

So they are aligned PER SENTENCE, each sentence resampled to the reference's own
length for that sentence. Within one sentence a uniform stretch is a fair
approximation; across a document it is not, and the difference is audible as one
voice sliding behind the other.

The reference is NEVER stretched. jenny is fitted to alan, because alan is
neural, and neural is the voice that does not move.
"""
import json, re, subprocess, sys, wave, time, tempfile
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mindx_voice

PIPER = "/home/mindx/mindX/.mindx_env/bin/piper"
MODELS = "/home/mindx/mindX/data/models/piper"
DOC = sys.argv[1] if len(sys.argv) > 1 else "voices"
BLOCKS = json.load(open("/tmp/blocks.json"))

# The two voices, exactly as the realm defines them — read, not restated, so
# retuning either in mindX's registry retunes this.
BODY = mindx_voice.params("neural")     # the reference. Never stretched.
OVER = mindx_voice.params("jaimla")     # fitted to it.
OVER_GAIN = 0.62                        # she is under him, not beside him
GAP = 0.42                              # between blocks
SENT = re.compile(r"(?<=[.!?])\s+")


def piper(p, text):
    r = subprocess.run([PIPER, "--model", "%s/%s.onnx" % (MODELS, p["model"]), "--output-raw",
                        "--length-scale", "%.6f" % p["lengthScale"],
                        "--sentence-silence", "%.3f" % p["sentenceSilence"]],
                       input=text.encode("utf-8"), capture_output=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError("piper rc=%d %s" % (r.returncode, r.stderr.decode()[:160]))
    return np.frombuffer(r.stdout[:len(r.stdout) - (len(r.stdout) % 2)], dtype="<i2").astype(np.float64) / 32768.0


SR = int(json.load(open("%s/%s.onnx.json" % (MODELS, BODY["model"])))["audio"]["sample_rate"])

t0 = time.time()
out, marks, stretches, n_done = [], [], [], 0
for i, b in enumerate(BLOCKS):
    marks.append({"block": i, "at": round(n_done / SR, 3)})
    for sent in ([t for t in SENT.split(b["text"].strip()) if t.strip()] or [b["text"]]):
        a = piper(BODY, sent)
        if len(a) < 8:
            continue
        j = piper(OVER, sent)
        if len(j) >= 2:
            stretches.append(len(j) / len(a))
            # SHE IS FITTED TO HIM, per sentence. He is the reference and does not move.
            j = np.interp(np.linspace(0, len(j) - 1, len(a)), np.arange(len(j)), j)
            mix = a + OVER_GAIN * j
        else:
            mix = a
        # two voices sum past 1.0 on shared stresses; a soft knee rather than a clip
        mix = np.tanh(mix * 0.85) / np.tanh(0.85)
        out.append(mix)
        n_done += len(mix)
    gap = np.zeros(int(SR * GAP))
    out.append(gap)
    n_done += len(gap)

audio = np.concatenate(out)
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

st = np.array(stretches) if stretches else np.array([1.0])
manifest = {
    "doc": DOC, "voice": "overlord", "voiceName": "OVERLORD",
    "derivedFrom": "neural and jaimla, speaking at once",
    "engine": "piper %s + piper %s -> opusenc 24kbps mono" % (BODY["model"], OVER["model"]),
    "engineNote": ("The two neural voices of the realm in unison. Two people speaking together "
                   "is a sound with no single owner — the pitch stops belonging to a person and "
                   "starts belonging to the statement. Aligned PER SENTENCE: they do not agree on "
                   "timing, and one stretch factor for a whole block leaves them in unison at the "
                   "start and a syllable apart by the end."),
    "layers": [
        {"role": "reference", "model": BODY["model"], "gain": 1.0,
         "lengthScale": BODY["lengthScale"], "sentenceSilence": BODY["sentenceSilence"],
         "note": "neural, never stretched — it is the voice that does not move"},
        {"role": "unison", "model": OVER["model"], "gain": OVER_GAIN,
         "lengthScale": OVER["lengthScale"],
         "note": "jaimla, fitted to the reference sentence by sentence"},
    ],
    "alignment": {"sentences": len(stretches),
                  "stretchMedian": round(float(np.median(st)), 4),
                  "stretchMin": round(float(st.min()), 4),
                  "stretchMax": round(float(st.max()), 4),
                  "note": "how far jaimla had to be moved to land on neural, per sentence"},
    "clonedFrom": "mindX docspeech_voices.json",
    "sampleRate": SR,
    "generated": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
    "blocks": len(BLOCKS), "seconds": round(seconds, 3), "bytes": opus.stat().st_size,
    "parts": [{"n": 1, "file": "part-01.opus", "url": "/audio/%s/overlord/part-01.opus" % DOC,
               "seconds": round(seconds, 3), "bytes": opus.stat().st_size,
               "from": 0, "to": len(BLOCKS) - 1, "marks": marks}],
}
(outdir / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
print("  overlord  neural+jaimla in unison  %d sentences  stretch %.3f (%.3f-%.3f)  %6.1fs  %4.0f KB  (%.0fs)"
      % (len(stretches), np.median(st), st.min(), st.max(), seconds,
         opus.stat().st_size / 1024, time.time() - t0))
