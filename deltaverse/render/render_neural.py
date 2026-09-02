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
from pathlib import Path

DOC   = sys.argv[1] if len(sys.argv) > 1 else "voices"
VOICE = sys.argv[2] if len(sys.argv) > 2 else "neural"
BLOCKS = json.load(open("/tmp/blocks.json"))
PIPER = "/home/mindx/mindX/.mindx_env/bin/piper"
MODEL = "/home/mindx/mindX/data/models/piper/en_GB-alan-medium.onnx"
OUT   = Path(f"/home/deltaverse/www/audio/{DOC}/{VOICE}")

def synth(text):
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
r = subprocess.run(["opusenc", "--quiet", "--bitrate", "24", "--downmix-mono",
                    str(wav), str(opus)], capture_output=True)
if r.returncode != 0:
    raise SystemExit("opusenc failed: " + r.stderr.decode()[:200])

manifest = {
    "doc": DOC, "voice": VOICE, "voiceName": "Neural",
    "derivedFrom": "the reference",
    "engine": "piper en_GB-alan-medium → opusenc 24kbps mono",
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
