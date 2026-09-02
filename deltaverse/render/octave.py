"""The OVERLORD octave — measured into existence, in exactly one place.

THE OBVIOUS VERSION OF THIS IS WRONG, AND IT IS WRONG IN THE DIRECTION THAT
LOOKS RIGHT. The first draft derived the sub layer by halving the body voice's
espeak `pitch` parameter — 82 -> 41 — on the strength of a sweep showing that
parameter maps to f0 at about 0.97x. That sweep was run at espeak's default
speed. At OVERLORD's 118 wpm the map bends at the bottom: pitch 82 measures
80.8 Hz, but pitch 41 measures 34.3 Hz, which is 1.24 octaves down, not one.
A fifth of an octave flat, shipped under the word "exactly".

So the interval is measured rather than assumed: render a probe, halve its f0,
and binary-search the sub's pitch parameter until it lands there. It reports the
error it actually achieved, in cents, because that is the only number worth
printing. Retune the body and the octave follows.

This module exists because the same calibration is needed by both the store
renderer (render_overlord.py) and the live render service
(services/docsplayer/server.py), and the first version of it lived in each of
them separately — which is how one of them kept the wrong arithmetic for an
afternoon after the other was fixed.
"""
import re
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 22050
VARIANT_DIR = Path("/usr/lib/x86_64-linux-gnu/espeak-ng-data/voices/!v")
PROBE = ("The overlord speaks once, and the matter is settled forever. "
         "Beneath the voice there is a weight you feel rather than hear.")


def espeak_pcm(voice: str, text: str, wpm: int) -> bytes:
    """One utterance to raw PCM. Text goes over STDIN, never argv: `ps` is
    world-readable on the production host."""
    with tempfile.NamedTemporaryFile(suffix=".wav") as t:
        r = subprocess.run(["espeak-ng", "-v", voice, "-s", str(wpm), "-w", t.name],
                           input=text.encode("utf-8"), capture_output=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError("espeak rc=%d %s" % (r.returncode, r.stderr.decode()[:160]))
        with wave.open(t.name) as w:
            if w.getframerate() != SR:
                raise RuntimeError("unexpected rate %d" % w.getframerate())
            return w.readframes(w.getnframes())


def f0(pcm: bytes, lo: float = 28.0, hi: float = 320.0) -> float:
    """Median f0 over voiced frames, by autocorrelation.

    Used to CHECK a voice, never to make one — a claim about pitch that is not
    measured is decoration. `lo` must be dropped for the sub layer: the default
    floor would octave-jump on a 40 Hz fundamental and report 80.
    """
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float64) / 32768.0
    n = int(0.06 * SR)
    h = n // 2
    klo, khi = int(SR / hi), int(SR / lo)
    out = []
    for i in range(0, len(x) - n, h):
        f = x[i:i + n]
        if np.sqrt((f * f).mean()) < 0.02:
            continue
        f = f - f.mean()
        a = np.correlate(f, f, "full")[n - 1:]
        if khi >= len(a):
            continue
        k = klo + int(np.argmax(a[klo:khi]))
        if a[k] > 0.3 * a[0]:
            out.append(SR / k)
    return float(np.median(out)) if out else float("nan")


def calibrate(wpm: int, variant_dir: Path = VARIANT_DIR) -> dict:
    """Write `overlordsub` at the pitch that lands an octave under `overlord`.

    Returns what it achieved: the two pitch parameters, the two measured f0s and
    the error in cents. A residual of a few tens of cents is the granularity
    limit of an INTEGER pitch parameter, not a bug — but it is reported rather
    than rounded away.
    """
    src = variant_dir / "overlord"
    if not src.exists():
        return {"ok": False, "why": "en-earth+overlord is not installed"}
    txt = src.read_text()
    m = re.search(r"^pitch\s+(\d+)\s+(\d+)\s*$", txt, re.M)
    if not m:
        return {"ok": False, "why": "overlord has no 'pitch <base> <range>' line"}
    pbase, prange = int(m.group(1)), int(m.group(2))

    def write_sub(p: int):
        body = (txt[:m.start()] + "pitch %d %d" % (p, max(1, round(prange * p / pbase)))
                + txt[m.end():])
        (variant_dir / "overlordsub").write_text(
            body.replace("name overlord", "name overlordsub", 1))

    try:
        body_f0 = f0(espeak_pcm("en-earth+overlord", PROBE, wpm))
        target = body_f0 / 2.0
        lo, hi, best = 24, pbase, None
        for _ in range(9):                       # 9 halvings resolve a range this wide exactly
            mid = (lo + hi) // 2
            write_sub(mid)
            got = f0(espeak_pcm("en-earth+overlordsub", PROBE, wpm), lo=20.0, hi=200.0)
            if got != got:                       # nan: nothing voiced was found
                lo = mid + 1
                continue
            if best is None or abs(got - target) < abs(best[1] - target):
                best = (mid, got)
            if got < target:
                lo = mid + 1
            else:
                hi = mid - 1
            if lo > hi:
                break
        if best is None:
            return {"ok": False, "why": "could not measure the sub's pitch"}
        write_sub(best[0])
        cents = 1200.0 * float(np.log2(best[1] / target)) if target else 0.0
        return {"ok": True, "bodyPitch": pbase, "subPitch": best[0],
                "bodyF0": round(body_f0, 1), "subF0": round(best[1], 1),
                "targetF0": round(target, 1), "errorCents": round(cents, 1),
                "note": ("the sub pitch is SEARCHED, not halved: espeak's pitch parameter "
                         "is not linear in Hz at the bottom of the range")}
    except PermissionError:
        return {"ok": (variant_dir / "overlordsub").exists(),
                "why": "cannot write the variant (needs write on overlordsub)"}
    except Exception as e:                       # calibration must never take a caller down
        return {"ok": (variant_dir / "overlordsub").exists(),
                "why": "%s: %s" % (type(e).__name__, e)}
