#!/usr/bin/env python3
"""DeltaVerse doc.player render service (:4031) — a pasted URL becomes a file.

WHY THIS EXISTS AT ALL. The browser can already read a pasted page aloud with
speechSynthesis, and doc.player does. But speechSynthesis output CANNOT BE
CAPTURED — there is no API that hands you its samples — so "read it" and
"download it" are two different features with two different engines. This is the
second one: the text is rendered on the server into a real file that can be
played, seeked, downloaded and kept.

BOTH ENGINES, AND THE PAGE SAYS WHICH. neural is the DEFAULT here as it is
everywhere else in the realm, so the reference model has to be offered: piper
en_GB-alan-medium, with JAIMLA as en_GB-jenny_dioco-medium beside it — the same
two models the DeltaVerse store is rendered from, so a pasted page is read in the
voice the realm actually has rather than an impersonation of it.

Piper is not free, but it is not as expensive as I first assumed either. I had it
at "about 1x realtime" from upstream reputation; MEASURED on this 2-vCPU host it
renders 192.7 s of speech in 77 s, which is 2.4x. A five-minute page is about two
minutes of CPU. That is slow for a button, so the cost is DECLARED per voice
(`rtf`) and shown in the picker rather than discovered by waiting.

espeak-ng stays for the tuned cast — OVERLORD, LEADER, ANCIENT, SAM, CLASSIC —
where it is not a compromise but the only engine that has those voices at all,
and where ~40-800x realtime makes a long document instant. This is the same
reasoning docspeech settled on, with the reference voice added back.

THE STORE. Renders land in /home/deltaverse/www/audio/paste/<key>/ and are served
by Apache as ordinary static files: range requests, caching and download all come
free, and only the render itself touches Python. The budget is 300 MB, pruned
least-recently-used. A cache hit touches the directory, so "recently used" means
recently PLAYED, not recently made.

TEXT ARRIVES OVER STDIN, NEVER argv. `ps` is world-readable on this host.
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile, threading, time, wave
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

HOST = os.environ.get("DOCSPLAYER_HOST", "127.0.0.1")
PORT = int(os.environ.get("DOCSPLAYER_PORT", "4031"))
STORE = Path(os.environ.get("DOCSPLAYER_STORE", "/home/deltaverse/www/audio/paste"))
URLBASE = os.environ.get("DOCSPLAYER_URLBASE", "/audio/paste")
BUDGET = int(os.environ.get("DOCSPLAYER_BUDGET_MB", "300")) * 1024 * 1024

MAX_BLOCKS = 4000
MAX_WORDS = 60000            # ~6 hours of speech; the cap that says so rather than truncating silently
MAX_CHARS = 900_000
GAP = 0.35                   # seconds of silence between blocks, as in the store's own renders
SR = 22050
RATE_WINDOW, RATE_MAX = 300.0, 12          # renders per IP per 5 minutes

PIPER = "/home/mindx/mindX/.mindx_env/bin/piper"
PIPER_MODELS = Path("/home/mindx/mindX/data/models/piper")

# `engine` picks the synthesiser; `layers` marks the voices mixed from several
# passes (see mindx_backend_service/deltaverse/render/render_overlord.py); `rtf`
# is the MEASURED realtime factor on this host, declared so the picker can warn
# instead of leaving someone watching a spinner.
VOICES = {
    # NEURAL CARRIES NO PARAMETER. NOT EVEN A NEUTRAL ONE.
    # This had "length_scale": 1.0, which is what the model declares anyway, so the
    # audio was identical. It was still wrong to write down: the reference is not
    # adjusted, only derived from, and a scaling knob sitting on the reference's
    # record is an invitation to nudge it — 1.0 today, 0.98 the day someone thinks
    # the reference reads a little fast. render_neural.py invokes piper with NO
    # scaling flag at all, and this now does the same, so the two cannot drift.
    "neural":   {"name": "NEURAL", "engine": "piper", "model": "en_GB-alan-medium",
                 "rtf": 2.4, "default": True, "reference": True,
                 "note": "the reference voice of the realm — invoked exactly as the store renders it"},
    "jaimla":   {"name": "JAIMLA", "engine": "piper", "model": "en_GB-jenny_dioco-medium",
                 "length_scale": 1.0417, "rtf": 2.5,
                 "note": "the female voice — female in the weights, not by a pitch multiplier"},
    "overlord": {"name": "OVERLORD", "voice": "en-earth+overlord", "wpm": 118, "layers": True,
                 "rtf": 24,
                 "note": "leader's mass and ancient's absolutes, with an octave under it"},
    "leader":   {"name": "LEADER",   "voice": "en-earth+leaderofearth", "wpm": 118, "rtf": 90,
                 "note": "one accent assembled from eight world Englishes"},
    "ancient":  {"name": "ANCIENT",  "voice": "en-gb-x-rp+ancient", "wpm": 150, "rtf": 90,
                 "note": "authority from absolute — nothing in it ever rises"},
    "jaimla_formant": {"name": "JAIMLA (formant)", "voice": "en-gb-x-rp+jaimla", "wpm": 168,
                 "rtf": 90,
                 "note": "the espeak Jaimla — a perfect fifth wide, breath in the tone; kept "
                         "because it is fast, but the neural JAIMLA above is the voice"},
    "zen":      {"name": "ZEN", "voice": "en-zen+zen", "wpm": 150, "rtf": 90,
                 "note": "one English assembled from the Englishes of East Asia — "
                         "syllable-timed, unhurried, breath in the tone"},
    "hal":      {"name": "H.A.L", "voice": "en-us+hal", "wpm": 150, "rtf": 90,
                 "note": "the calm machine of 2001: warm, unhurried, and it never "
                         "emphasises anything"},
    "kitt":     {"name": "K.I.T.T", "voice": "en-us+kitt", "wpm": 165, "rtf": 90,
                 "note": "bright, quick, precise and faintly superior — hal's opposite"},
    "t800":     {"name": "T1000", "voice": "en-t800+t800", "wpm": 140, "rtf": 90,
                 "note": "deep and flat, and not persuading you"},
    "sam":      {"name": "SAM",      "voice": "en-gb-scotland+sam", "wpm": 170, "rtf": 90,
                 "note": "the neutral one — a perfect fourth, neither major nor minor"},
    "classic":  {"name": "CLASSIC",  "voice": "en-gb-x-rp", "wpm": 175, "rtf": 90,
                 "note": "unmarked RP, the base every variant is measured against"},
}
DEFAULT_VOICE = "neural"      # as everywhere else in the realm

app = FastAPI(title="DeltaVerse doc.player render", docs_url=None, redoc_url=None)
_render_lock = threading.Semaphore(1)        # one render at a time: this box has 2 vCPU
_hits: dict = {}
_hits_lock = threading.Lock()


class Block(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


class RenderReq(BaseModel):
    url: str = Field(default="", max_length=2048)
    title: str = Field(default="", max_length=300)
    voice: str = Field(default=DEFAULT_VOICE, max_length=32)
    blocks: list[Block]


# ── the store ────────────────────────────────────────────────────────────────
def store_bytes() -> int:
    return sum(f.stat().st_size for f in STORE.rglob("*") if f.is_file())


def prune(keep: str | None = None) -> list[str]:
    """Least-recently-USED, where used means played. Returns what was dropped.

    A cache hit touches the directory (see render), so mtime tracks the last time
    someone asked for this audio, not the last time it was made. Pruning by age of
    creation would throw away the page everyone keeps coming back to.
    """
    if not STORE.exists():
        return []
    dirs = [d for d in STORE.iterdir() if d.is_dir() and d.name != keep]
    total = store_bytes()
    dropped = []
    for d in sorted(dirs, key=lambda p: p.stat().st_mtime):
        if total <= BUDGET:
            break
        sz = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
        shutil.rmtree(d, ignore_errors=True)
        total -= sz
        dropped.append(d.name)
    return dropped


def key_for(voice: str, blocks: list[str]) -> str:
    h = hashlib.sha256()
    h.update(voice.encode())
    for b in blocks:
        h.update(b"\x1f")
        h.update(b.encode("utf-8"))
    return h.hexdigest()[:24]


# ── synthesis ────────────────────────────────────────────────────────────────
def espeak(voice: str, text: str, wpm: int) -> bytes:
    """One block to raw PCM, via the shared helper (stdin, never argv)."""
    return _octave.espeak_pcm(voice, text, wpm)


def piper(model: str, text: str, length_scale: float | None) -> bytes:
    """One block to raw PCM through piper. Text over stdin, never argv."""
    cmd = [PIPER, "--model", str(PIPER_MODELS / (model + ".onnx")), "--output-raw"]
    # None means "say nothing about it" — the reference passes no flag, exactly as
    # render_neural.py does. Passing 1.0 would sound the same and mean something else.
    if length_scale is not None:
        cmd += ["--length-scale", "%.6f" % length_scale]
    r = subprocess.run(cmd, input=text.encode("utf-8"), capture_output=True, timeout=900)
    if r.returncode != 0:
        raise RuntimeError("piper rc=%d %s" % (r.returncode, r.stderr.decode()[:160]))
    return r.stdout


def render_piper(spec: dict, texts: list[str]):
    """The reference engine. Slower than espeak by a factor of about thirty, and
    the only one that can speak in the voices the DeltaVerse store is made of.

    A voice with no `length_scale` is rendered with no scaling flag — that is how
    the reference stays the reference rather than a setting that happens to be 1.
    """
    sr = int(json.loads((PIPER_MODELS / (spec["model"] + ".onnx.json")).read_text())
             ["audio"]["sample_rate"])
    pcm, marks = bytearray(), []
    for i, t in enumerate(texts):
        marks.append({"block": i, "at": round(len(pcm) / 2 / sr, 3)})
        pcm += piper(spec["model"], t, spec.get("length_scale"))
        pcm += b"\x00\x00" * int(sr * GAP)
    return bytes(pcm), marks, sr


def render_plain(spec: dict, texts: list[str]):
    pcm, marks = bytearray(), []
    for i, t in enumerate(texts):
        marks.append({"block": i, "at": round(len(pcm) / 2 / SR, 3)})
        pcm += espeak(spec["voice"], t, spec["wpm"])
        pcm += b"\x00\x00" * int(SR * GAP)
    return bytes(pcm), marks, SR


def render_layered(spec: dict, texts: list[str]):
    """OVERLORD: body + an octave derived from it + ancient as texture.

    Identical in intent to render_overlord.py; kept here rather than imported
    because that script writes into the voices.html store and this one must not.
    """
    import numpy as np

    # A one-pole IIR, without scipy.
    #
    # y[i] = (1-a)x[i] + a*y[i-1] is a convolution with an exponential kernel, and
    # that kernel is SHORT: at 190 Hz it is under 1e-7 by 350 samples, at 900 Hz by
    # 75. So the recurrence is replaced by an FFT convolution against a truncated
    # kernel — numerically identical to within the truncation, and it does not put
    # a Python loop over a million samples in the request path. (The closed-form
    # cumsum trick for this recurrence divides by a**i and overflows on any signal
    # longer than a second; do not reach for it.)
    def onepole(x, fc, high=False):
        a = float(np.exp(-2.0 * np.pi * fc / SR))
        n = min(len(x), int(np.ceil(np.log(1e-7) / np.log(a))) + 1)
        k = (1 - a) * a ** np.arange(n, dtype=np.float64)
        m = 1 << int(np.ceil(np.log2(len(x) + n)))
        y = np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(k, m), m)[:len(x)].astype(np.float32)
        return (x - y).astype(np.float32) if high else y

    def fit(x, n):
        if len(x) == n or len(x) < 2:
            return np.resize(x, n).astype(np.float32)
        return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)

    def pcm2f(b):
        return np.frombuffer(b, dtype=np.int16).astype(np.float32) / 32768.0

    G_OCT, G_ANC, LP, HP = 0.55, 0.30, 190.0, 900.0
    out, marks, n_done = [], [], 0
    for i, t in enumerate(texts):
        body = pcm2f(espeak("en-earth+overlord", t, spec["wpm"]))
        n = len(body)
        marks.append({"block": i, "at": round(n_done / SR, 3)})
        oct_ = fit(pcm2f(espeak("en-earth+overlordsub", t, spec["wpm"])), n)
        anc = fit(pcm2f(espeak("en-gb-x-rp+ancient", t, 99)), n)
        mix = body + G_OCT * onepole(oct_, LP) + G_ANC * onepole(anc, HP, high=True)
        mix = np.tanh(mix * 0.85) / np.tanh(0.85)
        gap = np.zeros(int(SR * GAP), dtype=np.float32)
        out.append(mix.astype(np.float32)); out.append(gap)
        n_done += n + len(gap)
    audio = np.concatenate(out)
    peak = float(np.abs(audio).max()) or 1.0
    return (audio / peak * 0.89 * 32767).astype(np.int16).tobytes(), marks, SR


# The octave calibration is SHARED with the store renderer
# (mindx_backend_service/deltaverse/render/octave.py). It lived in both files
# separately for exactly one afternoon, which was long enough for one of them to
# keep the wrong arithmetic after the other was fixed.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]
                       / "mindx_backend_service" / "deltaverse" / "render"))
import octave as _octave

_OCTAVE: dict = {}


def calibrate_octave(force: bool = False) -> dict:
    if _OCTAVE and not force:
        return _OCTAVE
    c = _octave.calibrate(VOICES["overlord"]["wpm"])
    if c.get("ok"):
        _OCTAVE.update(c)
    return c


# ── routes ───────────────────────────────────────────────────────────────────
@app.get("/docsplayer/voices")
def voices():
    return {"default": DEFAULT_VOICE,
            "voices": [{"id": k, "name": v["name"], "note": v["note"],
                        "engine": v.get("engine", "espeak-ng"),
                        "rtf": v.get("rtf")} for k, v in VOICES.items()]}


@app.get("/docsplayer/store")
def store_status():
    used = store_bytes() if STORE.exists() else 0
    n = len([d for d in STORE.iterdir() if d.is_dir()]) if STORE.exists() else 0
    return {"budgetBytes": BUDGET, "usedBytes": used, "renders": n,
            "usedPct": round(used / BUDGET * 100, 1) if BUDGET else 0}


def _rate_ok(ip: str) -> bool:
    now = time.time()
    with _hits_lock:
        q = [t for t in _hits.get(ip, []) if now - t < RATE_WINDOW]
        if len(q) >= RATE_MAX:
            _hits[ip] = q
            return False
        q.append(now)
        _hits[ip] = q
    return True


@app.post("/docsplayer/render")
def render(req: RenderReq, request: Request):
    spec = VOICES.get(req.voice)
    if not spec:
        raise HTTPException(400, "unknown voice %r" % req.voice[:32])
    # The reference is not adjusted, only derived from. If someone ever puts a
    # tuning parameter on neural's record, this refuses rather than quietly
    # rendering a reference that is no longer the reference.
    if spec.get("reference") and any(k in spec for k in ("length_scale", "wpm", "layers")):
        raise HTTPException(500, "the reference voice has acquired a tuning parameter; "
                                 "neural is derived from, never adjusted")

    texts = [re.sub(r"\s+", " ", b.text).strip() for b in req.blocks]
    texts = [t for t in texts if t]
    if not texts:
        raise HTTPException(400, "no text")
    if len(texts) > MAX_BLOCKS:
        raise HTTPException(413, "%d blocks; the cap is %d" % (len(texts), MAX_BLOCKS))
    words = sum(t.count(" ") + 1 for t in texts)
    chars = sum(len(t) for t in texts)
    if words > MAX_WORDS or chars > MAX_CHARS:
        raise HTTPException(413, "%d words / %d characters; the caps are %d and %d"
                            % (words, chars, MAX_WORDS, MAX_CHARS))

    key = key_for(req.voice, texts)
    outdir = STORE / key
    man = outdir / "manifest.json"
    if man.exists():
        # a hit is a USE: touch so the LRU sees it, and never re-render
        now = time.time()
        os.utime(outdir, (now, now))
        m = json.loads(man.read_text())
        m["cached"] = True
        return JSONResponse(m)

    ip = (request.client.host if request.client else "?")
    if not _rate_ok(ip):
        raise HTTPException(429, "too many renders from this address; try again in a few minutes")

    if spec.get("engine") == "piper" and not (PIPER_MODELS / (spec["model"] + ".onnx")).exists():
        raise HTTPException(503, "the %s model is not installed on this host" % spec["model"])
    if spec.get("layers") and not calibrate_octave().get("ok"):
        raise HTTPException(503, "the OVERLORD octave variant is not installed on this host")

    if not _render_lock.acquire(timeout=180):
        raise HTTPException(503, "the renderer is busy; try again in a moment")
    try:
        t0 = time.time()
        if spec.get("engine") == "piper":
            pcm, marks, sr = render_piper(spec, texts)
        elif spec.get("layers"):
            pcm, marks, sr = render_layered(spec, texts)
        else:
            pcm, marks, sr = render_plain(spec, texts)
        seconds = len(pcm) / 2 / sr
        outdir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tw:
            wav = tw.name
        with wave.open(wav, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm)
        opus = outdir / "part-01.opus"
        r = subprocess.run(["opusenc", "--quiet", "--bitrate", "24", "--downmix-mono", wav, str(opus)],
                           capture_output=True, timeout=600)
        os.unlink(wav)
        if r.returncode != 0:
            shutil.rmtree(outdir, ignore_errors=True)
            raise HTTPException(500, "encode failed: " + r.stderr.decode()[:160])

        took = time.time() - t0
        manifest = {
            "key": key, "voice": req.voice, "voiceName": spec["name"],
            "source": req.url[:2048], "title": req.title[:300],
            "engine": ("piper %s -> opusenc 24kbps mono" % spec["model"]
                       if spec.get("engine") == "piper"
                       else "espeak-ng %s -> opusenc 24kbps mono" % spec["voice"]),
            "engineNote": spec["note"],
            "layered": bool(spec.get("layers")),
            "octave": (calibrate_octave() if spec.get("layers") else None),
            "wpm": spec.get("wpm"), "sampleRate": sr,
            "generated": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "renderSeconds": round(took, 2),
            "realtimeFactor": round(seconds / took, 1) if took else None,
            "blocks": len(texts), "words": words,
            "seconds": round(seconds, 3), "bytes": opus.stat().st_size,
            "download": "%s/%s/part-01.opus" % (URLBASE, key),
            "parts": [{"n": 1, "file": "part-01.opus",
                       "url": "%s/%s/part-01.opus" % (URLBASE, key),
                       "seconds": round(seconds, 3), "bytes": opus.stat().st_size,
                       "from": 0, "to": len(texts) - 1, "marks": marks}],
        }
        man.write_text(json.dumps(manifest, indent=1) + "\n")
        dropped = prune(keep=key)
        if dropped:
            manifest["pruned"] = len(dropped)
            print("pruned %d render(s) to stay under %d MB" % (len(dropped), BUDGET // 1048576),
                  flush=True)
        manifest["cached"] = False
        manifest["store"] = store_status()
        return JSONResponse(manifest)
    finally:
        _render_lock.release()


@app.get("/docsplayer/health")
def health():
    return {"ok": True, "store": store_status(), "voices": len(VOICES),
            "octave": calibrate_octave()}


if __name__ == "__main__":
    import uvicorn
    STORE.mkdir(parents=True, exist_ok=True)
    c = calibrate_octave()
    print('octave calibration:', c, flush=True)
    print("doc.player render on %s:%d  store=%s budget=%d MB"
          % (HOST, PORT, STORE, BUDGET // 1048576), flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
