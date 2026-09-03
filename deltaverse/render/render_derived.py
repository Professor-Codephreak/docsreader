#!/usr/bin/env python3
"""Render the DeltaVerse derived voices as piper derivations of neural.

Every voice but neural is a STATED DELTA on neural (voices.js): a ratio, never an
absolute, so improving neural improves everything derived from it. neural is now
piper/en_GB-alan-medium, so the derivations must be piper too — otherwise a
"derivation" is a different engine wearing a ratio.

piper has --length-scale (duration) and NO pitch control, so pitch is derived:

    length_scale L = P / S      -> duration x L
    declare the wav at SR x P   -> pitch x P, duration / P
    net: duration x L/P = 1/S,  pitch x P          exactly the stated delta

Declaring the rate rather than interpolating samples also hands the resampling to
opusenc's filter instead of doing it with linear interpolation here.
"""
import json, subprocess, sys, wave, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mindx_voice

PIPER  = "/home/mindx/mindX/.mindx_env/bin/piper"
MODELS = "/home/mindx/mindX/data/models/piper"
MODEL  = MODELS + "/en_GB-alan-medium.onnx"          # neural, and the default base
DOC   = sys.argv[1] if len(sys.argv) > 1 else "voices"
BLOCKS = json.load(open("/tmp/blocks.json"))

# from engine/ngn/voices.js — the stated deltas, verbatim.
#
# `model` overrides the base. A RATIO CANNOT CHANGE A SINGER.
# Jaimla was x0.94 rate, x0.92 pitch on en_GB-alan-medium — a MALE model slowed
# down and pitched down, filed under a female name. Pitch is not gender: shifting
# alan down moves his formants down with him and produces a larger man, not a
# woman. mindX already resolved this for its own JAIMLA and wrote down why
# (data/config/docspeech_voices.json): en_GB-jenny_dioco-medium, "FEMALE, PROVEN
# NOT ASSERTED... every male voice here measures below 150 Hz and every female
# above 180". So DeltaVerse takes the same model rather than imitating it, and
# the delta drops to x1.00 pitch, because there is nothing left to fake — the
# voice is female in the weights. The rate keeps mindX's 168 wpm against a 175
# nominal (x0.96): softness here is unhurriedness, not slowness.
DERIV = {
    # JAIMLA IS A CLONE, so she carries no numbers of her own: `clone` means the
    # parameters are read from mindX's registry at render time. The ratio that
    # used to live here (0.96 rate) happened to equal mindX's 175/168 exactly —
    # a coincidence, and one that would have survived precisely as long as
    # nobody touched either side.
    "jaimla":      {"name": "Jaimla", "clone": "jaimla",
                    "note": "the mindX JAIMLA, rendered with mindX's own parameters"},
    # overlord is NOT here any more. It stopped being a ratio on neural the day it
    # became its own voice — leader's body and ancient's absolutes, with a measured
    # octave under it. render_overlord.py builds it; a x0.86/x0.84 alan cannot.
    "ovie":        {"name": "Ovie",        "rate": 1.08, "pitch": 1.08},
    "participant": {"name": "Participant", "rate": 1.00, "pitch": 1.00},
}

def model_for(d):
    return MODELS + "/" + d["model"] + ".onnx" if d.get("model") else MODEL

def synth(model, text, length_scale, sentence_silence):
    # --sentence-silence was never passed here, and piper's default is 0.0 — not
    # the 0.2 one might assume. Every derived voice was running its sentences
    # together while mindX's breathed between them.
    r = subprocess.run([PIPER, "--model", model, "--output-raw",
                        "--length-scale", "%.6f" % length_scale,
                        "--sentence-silence", "%.3f" % sentence_silence],
                       input=text.encode("utf-8"), capture_output=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError("piper rc=%d: %s" % (r.returncode, r.stderr.decode()[:160]))
    return r.stdout

for vid, d in DERIV.items():
    if d.get("clone"):
        # a clone states nothing; it asks
        VP = mindx_voice.params(d["clone"])
        model = MODELS + "/" + VP["model"] + ".onnx"
        SR = int(json.load(open(model + ".json"))["audio"]["sample_rate"])
        L, P, ss = VP["lengthScale"], VP["pitch"], VP["sentenceSilence"]
        S = P / L
        out_sr = int(round(SR * P))
    else:
        model = model_for(d)
        SR = int(json.load(open(model + ".json"))["audio"]["sample_rate"])
        S, P = d["rate"], d["pitch"]
        # A RATIO IS A RATIO ON THE REFERENCE AS IT IS NOW. neural's speed
        # calibration moved, so everything measured against it moves too —
        # otherwise "x1.08 of neural" quietly stops meaning that.
        L = P / (S * mindx_voice._calibration())
        out_sr = int(round(SR * P))             # the pitch shift, as a declared rate
        ss = min(1.5, 0.25 * (L ** 2))
    t0 = time.time()
    pcm, marks = bytearray(), []
    for i, b in enumerate(BLOCKS):
        marks.append({"block": i, "at": round(len(pcm) / 2 / out_sr, 3)})
        pcm += synth(model, b["text"], L, ss)
        pcm += b"\x00\x00" * int(out_sr * 0.35)
    seconds = len(pcm) / 2 / out_sr

    wav = Path("/tmp/%s-%s.wav" % (DOC, vid))
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(out_sr); w.writeframes(bytes(pcm))

    outdir = Path("/home/deltaverse/www/audio/%s/%s" % (DOC, vid)); outdir.mkdir(parents=True, exist_ok=True)
    opus = outdir / "part-01.opus"
    r = subprocess.run(["opusenc", "--quiet", "--bitrate", "24", "--downmix-mono",
                        str(wav), str(opus)], capture_output=True)
    if r.returncode != 0:
        print("  %s: opusenc FAILED %s" % (vid, r.stderr.decode()[:120])); continue

    manifest = {
        "doc": DOC, "voice": vid, "voiceName": d["name"],
        "derivedFrom": "neural x%.2f rate, x%.2f pitch" % (S, P),
        "engine": "piper %s -> opusenc 24kbps mono" % Path(model).stem,
        "engineNote": ("a derivation of the reference, not a different engine: "
                       "length-scale %.4f for rate, %d Hz declared for pitch" % (L, out_sr)),
        "model": Path(model).name,
        "modelNote": d.get("note", "the neural reference model, with a stated delta"),
        "delta": {"rate": round(S, 4), "pitch": P},
        "sentenceSilence": ss,
        "clonedFrom": d.get("clone") and "mindX docspeech_voices.json",
        "lengthScale": round(L, 6), "sampleRate": out_sr,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "blocks": len(BLOCKS), "seconds": round(seconds, 3), "bytes": opus.stat().st_size,
        "parts": [{"n": 1, "file": "part-01.opus", "url": "/audio/%s/%s/part-01.opus" % (DOC, vid),
                   "seconds": round(seconds, 3), "bytes": opus.stat().st_size,
                   "from": 0, "to": len(BLOCKS) - 1, "marks": marks}],
    }
    (outdir / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print("  %-12s %-26s x%.2f rate x%.2f pitch  L=%.4f  ss=%.3f  %d Hz  %6.1fs  %4.0f KB  (%.0fs)"
          % (vid, Path(model).stem, S, P, L, ss, out_sr, seconds,
             opus.stat().st_size / 1024, time.time() - t0))
