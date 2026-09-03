"""ogg.py — PCM → .ogg without installing anything.

The production host has no ffmpeg, no oggenc, no opusenc and no `soundfile`
wheel — but it has had **libsndfile 1.2.2** on disk all along (a dependency of
something else), and libsndfile writes Ogg/Vorbis (since 1.0.18) and Ogg/Opus
(since 1.0.29). Forty lines of ctypes turn the library that is already there
into the encoder. Cascade, best-available first:

    1. system libsndfile via ctypes      (zero installs — the production path)
    2. the `soundfile` wheel             (bundles its own libsndfile; pip-only)
    3. ffmpeg                            (dev boxes)

Opus is the default codec: it was designed for speech, ~24 kbps mono sounds
transparent for a formant voice, and it plays in every current browser inside
an .ogg container. Vorbis is the fallback for a libsndfile too old for Opus.
"""
from __future__ import annotations

import ctypes
import ctypes.util
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

import numpy as np

SF_FORMAT_OGG = 0x200000
SF_FORMAT_VORBIS = 0x0060
SF_FORMAT_OPUS = 0x0064
SFM_WRITE = 0x20
SFC_SET_COMPRESSION_LEVEL = 0x1301
OPUS_RATES = (8000, 12000, 16000, 24000, 48000)
CODECS = {"opus": SF_FORMAT_OGG | SF_FORMAT_OPUS, "vorbis": SF_FORMAT_OGG | SF_FORMAT_VORBIS}
# libsndfile's compression level maps to BITRATE for Opus (measured on the 2-vCPU host,
# 18.5 min of espeak-ng: 0.5→129 kbps · 0.75→68 · 0.9→31 · 0.93→24 · 0.96→17 · 1.0→7) and to
# Vorbis quality (0.9→36 kbps · 1.0→30). A formant voice is narrow-band; 24 kbps Opus is
# transparent for it. Opus encodes at ~54x realtime here, Vorbis at ~280x — Vorbis is the
# choice when encode time matters more than the last 20% of size.
DEFAULT_LEVEL = {"opus": 0.93, "vorbis": 1.0}


def effective_level(codec: str, level: Optional[float] = None) -> float:
    if level is not None:
        return float(level)
    env = os.environ.get("MINDX_DOCSPEECH_OGG_LEVEL")
    return float(env) if env else DEFAULT_LEVEL.get(codec, 0.9)


# ── loudness ────────────────────────────────────────────────────────────────
# LOUDNESS_VERSION is part of every cache key: change the curve, bump it, and only
# the renderings that used the old one expire.
LOUDNESS_VERSION = "1"
# -14, not the -16 broadcast speech usually targets. The brief was "maximum volume
# should be a louder voice", and -16 would have turned the LOUDEST voice DOWN by 2.2 dB
# to level the set — technically correct, and the opposite of what was asked. -14 sits
# just above LEADER's measured -13.8, so the top of the set is untouched and every other
# voice comes UP to meet it. Levelling by raising, not by trimming.
TARGET_DBFS = -14.0        # RMS target, in dBFS
CEILING = 0.97             # leave the last 3% for the encoder
MAX_GAIN_DB = 24.0         # a hard stop, so near-silence is not amplified into noise


def loudness_settings() -> tuple[bool, float]:
    on = os.environ.get("MINDX_DOCSPEECH_NORMALIZE", "1") not in ("0", "false", "no")
    try:
        target = float(os.environ.get("MINDX_DOCSPEECH_TARGET_DBFS", TARGET_DBFS))
    except ValueError:
        target = TARGET_DBFS
    return on, target


def normalize_loudness(pcm: np.ndarray, target_dbfs: Optional[float] = None) -> tuple[np.ndarray, dict]:
    """Bring a clip to a consistent RMS, with a soft limiter instead of clipping.

    WHY RMS AND NOT PEAK. Measured across the seven picker voices on the production
    host, peaks were ALREADY at full scale for five of them — peak normalisation had
    nothing left to give. What differed was RMS, and it differed enormously:

        LEADER  -13.8 dBFS      NEURAL  -14.9      JAIMLA  -14.1      SAM  -14.3
        sAGI    -18.4           CLASSIC -21.5      ANCIENT -32.0

    Eighteen decibels between the loudest and the quietest voice. That is not a
    subtle imbalance: at the same slider position ANCIENT is a sixth of LEADER's
    perceived loudness, and a listener at maximum volume on a laptop simply cannot
    hear it. A voice picker whose entries are not level is a picker whose quiet
    entries look broken.

    A whisper is exactly the case peak normalisation cannot fix. ANCIENT's crest
    factor is 22 dB — a soft body with hard consonant spikes — so the 16 dB of gain
    it needs would put those spikes 6 dB over full scale. Hence the limiter.

    THE LIMITER IS SOFT, AND ONLY WHERE IT HAS TO BE. Everything below the knee
    (60% of the ceiling) passes through with the gain applied and nothing else done
    to it, so the body of the speech is linear and undistorted. Only the peaks above
    the knee are compressed, smoothly, onto the ceiling. A tanh applied to the whole
    signal would have been three lines shorter and would have added harmonic
    distortion to every sample of every voice.

    Returns (pcm, report) — the report goes into the manifest, because a rendering
    that was gained by 15 dB should say so rather than leave the listener guessing.
    """
    on, default_target = loudness_settings()
    target = default_target if target_dbfs is None else float(target_dbfs)
    x = np.asarray(pcm, dtype=np.float32) / 32768.0
    rms = float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) if x.size else 0.0
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    report = {"normalized": False, "rms_dbfs_in": _db(rms), "peak_dbfs_in": _db(peak),
              "target_dbfs": target, "gain_db": 0.0, "limited": False}
    if not on or rms <= 0.0:
        return np.asarray(pcm, dtype=np.int16), report

    gain = min(10.0 ** (target / 20.0) / rms, 10.0 ** (MAX_GAIN_DB / 20.0))
    x = x * gain
    report.update(normalized=True, gain_db=round(20.0 * float(np.log10(gain)), 2))

    pk = float(np.max(np.abs(x)))
    if pk > CEILING:
        knee = 0.6 * CEILING
        a = np.abs(x)
        over = a > knee
        if over.any():
            # [knee, inf) -> [knee, CEILING): smooth, monotone, continuous at the knee.
            span = CEILING - knee
            x[over] = np.sign(x[over]) * (knee + span * np.tanh((a[over] - knee) / span))
        report["limited"] = True
    np.clip(x, -1.0, 1.0, out=x)
    out = (x * 32767.0).astype(np.int16)
    report["rms_dbfs_out"] = _db(float(np.sqrt(np.mean((out.astype(np.float64) / 32768.0) ** 2))))
    report["peak_dbfs_out"] = _db(float(np.max(np.abs(out)) / 32768.0) if out.size else 0.0)
    return out, report


def _db(x: float) -> float:
    return -99.0 if x <= 0 else round(20.0 * float(np.log10(x)), 1)


class EncoderUnavailable(RuntimeError):
    pass


class _SF_INFO(ctypes.Structure):
    _fields_ = [("frames", ctypes.c_int64), ("samplerate", ctypes.c_int), ("channels", ctypes.c_int),
                ("format", ctypes.c_int), ("sections", ctypes.c_int), ("seekable", ctypes.c_int)]


_lib = None
_lib_tried = False


def _libsndfile():
    global _lib, _lib_tried
    if _lib_tried:
        return _lib
    _lib_tried = True
    candidates = [os.environ.get("MINDX_LIBSNDFILE"), ctypes.util.find_library("sndfile"), "libsndfile.so.1"]
    for c in [c for c in candidates if c]:
        try:
            lib = ctypes.CDLL(c)
        except OSError:
            continue
        lib.sf_open.restype = ctypes.c_void_p
        lib.sf_open.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.POINTER(_SF_INFO)]
        lib.sf_writef_short.restype = ctypes.c_int64
        lib.sf_writef_short.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int64]
        lib.sf_close.argtypes = [ctypes.c_void_p]
        lib.sf_command.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
        lib.sf_strerror.restype = ctypes.c_char_p
        lib.sf_strerror.argtypes = [ctypes.c_void_p]
        lib.sf_version_string.restype = ctypes.c_char_p
        lib.sf_format_check.argtypes = [ctypes.POINTER(_SF_INFO)]
        _lib = lib
        break
    return _lib


def _sf_supports(codec: str, sr: int, channels: int = 1) -> bool:
    lib = _libsndfile()
    if not lib:
        return False
    info = _SF_INFO(0, sr, int(channels or 1), CODECS[codec], 0, 0)
    return bool(lib.sf_format_check(ctypes.byref(info)))


def _resample(pcm: np.ndarray, sr: int, target: int) -> np.ndarray:
    if sr == target:
        return pcm
    n = int(round(len(pcm) * target / sr))
    x_old = np.linspace(0.0, 1.0, num=len(pcm), endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n, endpoint=False)
    return np.interp(x_new, x_old, pcm.astype(np.float32)).astype(np.int16)


def encoder_info() -> dict:
    lib = _libsndfile()
    return {
        "libsndfile": lib.sf_version_string().decode() if lib else None,
        "libsndfile_opus": _sf_supports("opus", 24000),
        "libsndfile_vorbis": _sf_supports("vorbis", 22050),
        "soundfile": _has_soundfile(),
        "ffmpeg": shutil.which("ffmpeg") is not None,
    }


def _has_soundfile() -> bool:
    try:
        import soundfile  # noqa: F401
        return True
    except Exception:
        return False


def _via_libsndfile(pcm: np.ndarray, sr: int, path: Path, codec: str, level: float,
                    channels: int = 1) -> str:
    lib = _libsndfile()
    if codec == "opus" and sr not in OPUS_RATES:
        # RESAMPLE PER CHANNEL. _resample treats its input as one stream, and an
        # interleaved buffer is not one stream — resampling it whole would blend
        # neighbouring channels into each other and arrive as a smear.
        ch = int(channels or 1)
        if ch > 1:
            frames = pcm.reshape(-1, ch)
            cols = [_resample(frames[:, i], sr, 24000) for i in range(ch)]
            n = min(len(c) for c in cols)
            pcm = np.stack([c[:n] for c in cols], axis=1).reshape(-1)
        else:
            pcm = _resample(pcm, sr, 24000)
        sr = 24000
    info = _SF_INFO(0, sr, int(channels or 1), CODECS[codec], 0, 0)
    h = lib.sf_open(str(path).encode(), SFM_WRITE, ctypes.byref(info))
    if not h:
        raise EncoderUnavailable(f"libsndfile: {lib.sf_strerror(None).decode(errors='replace')}")
    try:
        lvl = ctypes.c_double(float(level))
        lib.sf_command(h, SFC_SET_COMPRESSION_LEVEL, ctypes.byref(lvl), ctypes.sizeof(lvl))
        pcm = np.ascontiguousarray(pcm, dtype=np.int16)
        # sf_writeF_short COUNTS FRAMES, NOT ITEMS, and the difference is invisible
        # at one channel — which is why this stood for as long as it did. At six
        # channels, passing the item count told libsndfile to read six times past
        # the end of the buffer: a segfault, not an error. The block size is also
        # snapped to a whole number of frames, because half a frame is not a
        # position any writer can be left at.
        ch = max(1, int(channels or 1))
        step = (1 << 16) - ((1 << 16) % ch)
        for i in range(0, len(pcm), step):
            block = pcm[i:i + step]
            frames = len(block) // ch
            if frames <= 0:
                continue
            wrote = lib.sf_writef_short(h, block.ctypes.data, frames)
            if wrote != frames:
                raise EncoderUnavailable(f"libsndfile short write {wrote}/{frames} frames")
    finally:
        lib.sf_close(h)
    return f"libsndfile:{codec}"


def _via_soundfile(pcm: np.ndarray, sr: int, path: Path, codec: str, level: float,
                   channels: int = 1) -> str:
    import soundfile as sf
    if codec == "opus" and sr not in OPUS_RATES:
        pcm, sr = _resample(pcm, sr, 24000), 24000
    sf.write(str(path), pcm, sr, format="OGG", subtype=codec.upper(), compression_level=level)
    return f"soundfile:{codec}"


def _via_ffmpeg(pcm: np.ndarray, sr: int, path: Path, codec: str, level: float,
                channels: int = 1) -> str:
    enc = ["-c:a", "libopus", "-b:a", "24k"] if codec == "opus" else ["-c:a", "libvorbis", "-q:a", "1"]
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(sr), "-ac", "1", "-i", "-",
           *enc, "-f", "ogg", str(path)]
    r = subprocess.run(cmd, input=np.ascontiguousarray(pcm, dtype=np.int16).tobytes(), capture_output=True)
    if r.returncode != 0:
        raise EncoderUnavailable(f"ffmpeg: {r.stderr.decode(errors='replace')[:200]}")
    return f"ffmpeg:{codec}"


def encode_ogg(pcm: np.ndarray, sample_rate: int, path: Path | str, *, codec: str = "opus",
               level: Optional[float] = None, channels: int = 1) -> dict:
    """Write int16 PCM as .ogg. Returns {encoder, codec, bytes, seconds, sample_rate, channels}.

    `pcm` is INTERLEAVED when channels > 1 — frame 0 channel 0, frame 0 channel 1, …
    which is what libsndfile expects and what numpy's reshape(-1) produces from an
    (n, ch) array.

    THE CHANNEL COUNT WAS HARDCODED TO 1, and that is worth recording because the
    failure was silent in the worst way: handing six channels of samples to a mono
    writer does not error, it writes a file six times as LONG. The bytes go up, the
    call succeeds, and only `opusinfo` says Channels: 1. Anything that had claimed
    surround output on the strength of "it encoded" would have been wrong.

    `level` is libsndfile's compression level, 0.0 (largest) → 1.0 (smallest);
    see DEFAULT_LEVEL for what it measured as. Falls back opus → vorbis when a
    library cannot do Opus."""
    path = Path(path)
    if codec not in CODECS:
        raise ValueError(f"codec must be one of {', '.join(CODECS)}")
    level = effective_level(codec, level)
    tmp = path.with_suffix(path.suffix + ".part")
    errors = []
    order = [codec] + [c for c in CODECS if c != codec]
    for c in order:
        for fn, ok in ((_via_libsndfile, lambda: _sf_supports(c, 24000 if c == "opus" else sample_rate, channels)),
                       (_via_soundfile, _has_soundfile),
                       (_via_ffmpeg, lambda: shutil.which("ffmpeg") is not None)):
            if not ok():
                continue
            try:
                encoder = fn(pcm, sample_rate, tmp, c, level, channels)
                os.replace(tmp, path)
                return {"encoder": encoder, "codec": c, "bytes": path.stat().st_size,
                        # frames, not samples: a six-channel file is not six times as long
                        "seconds": round(len(pcm) / float(sample_rate * max(1, channels)), 2),
                        "sample_rate": sample_rate, "channels": int(channels or 1)}
            except Exception as e:                       # try the next encoder, remember why
                errors.append(f"{fn.__name__}/{c}: {e}")
                try:
                    tmp.unlink()
                except OSError:
                    pass
    raise EncoderUnavailable("no ogg encoder: " + ("; ".join(errors) or "libsndfile/soundfile/ffmpeg all absent"))
