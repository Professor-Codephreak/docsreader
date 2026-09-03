"""The mindX voice parameters, read rather than copied.

WHY THIS EXISTS. neural and jaimla are supposed to be the SAME VOICES on both
sites — the DeltaVerse store is meant to be a clone of what mindX renders, not
an impression of it. They were maintained as two independent sets of numbers,
and two independent sets of numbers is a promise to diverge.

They had already diverged, in a way nobody would have caught by reading either
file. mindX's docspeech passes `--sentence-silence` (0.250 for neural, 0.271 for
jaimla, derived from the speaking rate). The DeltaVerse renderers passed nothing
— and piper's default is **0.0**, not the 0.2 one might assume. So the store's
neural ran every sentence into the next with no gap at all, while mindX's
breathed between them. Same model, same length-scale, completely different
voice to listen to.

The length-scales, meanwhile, matched exactly (1.0417 on both sides) — by
coincidence: 175/168 on one side and 1/0.96 on the other happen to be the same
number. A coincidence is not a guarantee, and it would have survived exactly as
long as nobody touched either.

So the parameters are now READ from data/config/docspeech_voices.json, which is
mindX's own registry and the thing an operator actually edits. Retune JAIMLA
there and the DeltaVerse store follows on the next render. There is no second
place to keep in step.

The DeltaVerse-only voices (ovie, participant, overlord) have no mindX
counterpart and keep their own definitions; this module is only for the two that
are supposed to be clones.
"""
import json
from pathlib import Path

# The registry lives with mindX, wherever this happens to be checked out or
# deployed. Both known layouts are tried before giving up, and giving up is
# LOUD: silently falling back to defaults is how the two drift again.
def _candidates() -> list:
    """Built lazily and defensively: `parents[3]` raises IndexError when this file
    is run from a shallow path (it was, from /root during a deploy), and a module
    that cannot be imported outside its own tree is a module that will be copied
    rather than imported."""
    out = [Path("/home/mindx/mindX/data/config/docspeech_voices.json")]
    here = Path(__file__).resolve()
    for up in (3, 2, 4):
        try:
            out.append(here.parents[up] / "data" / "config" / "docspeech_voices.json")
        except IndexError:
            pass
    out.append(Path.home() / "mindX" / "data" / "config" / "docspeech_voices.json")
    return out

DEFAULT_MODEL = "en_GB-alan-medium"       # what engine=auto resolves to on this host
NOMINAL_WPM = 175.0                       # docspeech's rate -> length_scale anchor


def _calibration() -> float:
    """docspeech's own speed calibration — imported, never copied.

    This is the number that decides what "speed 1" means, and it is the reason
    the two sides can diverge without either file looking wrong. Import it from
    the engine that defines it; fall back to the same default and say so.
    """
    try:
        import sys
        root = Path("/home/mindx/mindX")
        if not (root / "utils").is_dir():
            root = Path(__file__).resolve().parents[3]
        sys.path.insert(0, str(root))
        from utils.docspeech.engines import SPEED_CALIBRATION      # type: ignore
        return float(SPEED_CALIBRATION)
    except Exception:
        import os
        return float(os.environ.get("MINDX_SPEECH_CALIBRATION", "1.1"))


def _registry() -> dict:
    for p in _candidates():
        try:
            if p.is_file():
                return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
    raise SystemExit(
        "cannot find mindX's docspeech_voices.json — looked in:\n  "
        + "\n  ".join(str(p) for p in _candidates())
        + "\nThe DeltaVerse neural and jaimla renders are defined BY that file. "
          "Refusing to render them from guessed defaults, which is how they "
          "diverged in the first place.")


def params(voice_id: str) -> dict:
    """Exactly what mindX's docspeech would hand piper for this voice.

    Mirrors utils/docspeech/engines.py:Piper.synth — and the mirroring is the
    fragile part, so it is kept to three lines and each one names its source.
    """
    reg = _registry()
    entry = next((v for v in reg.get("voices", []) if v.get("id") == voice_id), None)
    if entry is None:
        raise SystemExit("mindX has no voice %r; the store cannot clone it" % voice_id)

    # engine=auto with no voice means "whatever this host resolves to", which on
    # this host is piper/en_GB-alan-medium. An explicit voice overrides it.
    model = entry.get("voice") or DEFAULT_MODEL

    # engines.py: speed = rate/175, P = pitch or 1, length = P/speed
    rate = entry.get("rate") or 0
    speed = (float(rate) / NOMINAL_WPM) if rate else 1.0
    pitch = float(entry.get("pitch") or 1.0)
    # the calibration is part of what the voice IS, so the clone carries it
    length = pitch / (speed * _calibration())

    # engines.py: an explicit sentenceSilence wins, else 0.25 * length^2 capped
    # at 1.5. THIS is the line the DeltaVerse renderers were missing entirely.
    ss = entry.get("sentenceSilence")
    ss = min(2.5, float(ss)) if ss else min(1.5, 0.25 * (length ** 2))

    return {
        "id": voice_id,
        "model": model,
        "lengthScale": round(length, 6),
        "pitch": pitch,
        "sentenceSilence": round(ss, 3),
        "rate": rate or None,
        "calibration": _calibration(),
        "source": "mindX docspeech_voices.json + docspeech SPEED_CALIBRATION",
    }


def piper_args(binary: str, models_dir, voice_id: str) -> tuple[list, dict]:
    """The argv, and the parameters it came from, so a manifest can state both."""
    p = params(voice_id)
    args = [binary, "--model", str(Path(models_dir) / (p["model"] + ".onnx")),
            "--output-raw",
            "--length-scale", "%.6f" % p["lengthScale"],
            "--sentence-silence", "%.3f" % p["sentenceSilence"]]
    return args, p


if __name__ == "__main__":
    import sys
    for vid in (sys.argv[1:] or ["neural", "jaimla"]):
        p = params(vid)
        print("%-8s model=%-28s length=%.4f pitch=%.2f sentence_silence=%.3f"
              % (p["id"], p["model"], p["lengthScale"], p["pitch"], p["sentenceSilence"]))
