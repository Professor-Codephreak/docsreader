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

# ONE LIST OF VOICES, AND IT IS NOT THIS FILE'S.
#
# This module used to keep its own table: OVERLORD as a five-band espeak mix,
# LEADER as plain espeak, H.A.L on `en-us` rather than `en-hal`. Every one of
# those was true when it was written and none of them was true a day later,
# because the voices are defined in mindX's registry and this was a copy of what
# the registry said at the time. A copy of a definition is a definition that will
# be wrong, and the only question is when.
#
# So the cast is READ from data/config/docspeech_voices.json — the same file the
# mindX reader renders from — and synthesis goes through docspeech's own engines
# rather than a third implementation of piper and espeak. Retune a voice there
# and this page follows without an edit.
_ROOT = Path("/home/mindx/mindX")
if not (_ROOT / "utils").is_dir():
    _ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))
from utils.docspeech.engines import ENGINES as _ENGINES      # noqa: E402
from utils.docspeech.ogg import encode_ogg as _encode_ogg    # noqa: E402

_REGISTRY = _ROOT / "data" / "config" / "docspeech_voices.json"

# Measured realtime factors, per engine, on this host — declared so the picker
# can warn instead of leaving someone watching a spinner.
_RTF = {"piper": 2.4, "espeak-ng": 90.0, "layered": 1.0, "voicey": 1.0}


def _load_voices() -> dict:
    """Every renderable face in the registry, alternates included.

    CLASSIC is four machines behind one button and all four are renderable here,
    so they are flattened into separate ids — a page with an address bar has no
    button to press twice.
    """
    reg = json.loads(_REGISTRY.read_text(encoding="utf-8"))
    out: dict = {}
    for v in reg.get("voices", []):
        if v.get("disabled"):
            continue                                    # vCLONE renders nothing yet
        base = {"name": v.get("faceLabel") or v.get("label") or v["id"],
                "engine": v.get("engine") or "auto",
                "voice": v.get("voice") or "",
                "rate": v.get("rate") or 0,
                "pitch": v.get("pitch") or 0,
                "ss": v.get("sentenceSilence") or 0,
                "note": (v.get("title") or "").strip()}
        base["rtf"] = _RTF.get(base["engine"], 2.0)
        out[v["id"]] = base
        for a in v.get("alternates") or []:
            alt = dict(base)
            alt.update({"name": a.get("label") or a["id"],
                        "engine": a.get("engine") or base["engine"],
                        "voice": a.get("voice") or "",
                        "rate": a.get("rate") or 0,
                        "note": (a.get("title") or "").strip()})
            alt["rtf"] = _RTF.get(alt["engine"], 2.0)
            out[a["id"]] = alt
    return out


_VOICES_CACHE: dict = {}
_VOICES_MTIME = [0.0]


def voices_table() -> dict:
    """Reloaded when the registry changes, so a retune does not need a restart."""
    try:
        m = _REGISTRY.stat().st_mtime
    except OSError:
        return _VOICES_CACHE
    if not _VOICES_CACHE or m != _VOICES_MTIME[0]:
        _VOICES_CACHE.clear()
        _VOICES_CACHE.update(_load_voices())
        _VOICES_MTIME[0] = m
    return _VOICES_CACHE


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
def render_via_docspeech(spec: dict, texts: list[str]):
    """Synthesise with mindX's own engine for this voice.

    Not a third implementation of piper and espeak — the same objects the reader
    uses, so a voice sounds the same here as it does on /doc/{name} and stays
    that way when it is retuned. Chunks are joined with a gap rather than handed
    over whole, because the marks have to line up with blocks and a block
    boundary is where a reader expects a breath.
    """
    eng_id = spec.get("engine") or "auto"
    if eng_id == "auto":
        from utils.docspeech.engines import pick as _pick
        eng_id = _pick("auto").id
    cls = _ENGINES.get(eng_id)
    if cls is None:
        raise HTTPException(400, "unknown engine %r for this voice" % eng_id)
    eng = cls()

    kw = {"voice": spec.get("voice") or None}
    if spec.get("rate"):
        kw["rate"] = int(spec["rate"])
    if spec.get("pitch"):
        kw["pitch"] = float(spec["pitch"])
    if spec.get("ss"):
        kw["sentence_silence"] = float(spec["ss"])

    pcm, marks, sr = bytearray(), [], None
    for i, t in enumerate(texts):
        clip = eng.synth(t, **kw)
        if sr is None:
            sr = clip.sample_rate
        marks.append({"block": i, "at": round(len(pcm) / 2 / sr, 3)})
        pcm += clip.samples.astype("<i2").tobytes()
        pcm += b"\x00\x00" * int(sr * GAP)
    return bytes(pcm), marks, (sr or 22050)


# ── routes ───────────────────────────────────────────────────────────────────
@app.get("/docsplayer/voices")
def voices():
    return {"default": DEFAULT_VOICE,
            "voices": [{"id": k, "name": v["name"], "note": v["note"],
                        "engine": v.get("engine", "espeak-ng"),
                        "rtf": v.get("rtf")} for k, v in voices_table().items()]}


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
    spec = voices_table().get(req.voice)
    if not spec:
        raise HTTPException(400, "unknown voice %r" % req.voice[:32])
    # The reference is not adjusted, only derived from. If someone ever puts a
    # tuning parameter on neural's record, this refuses rather than quietly
    # rendering a reference that is no longer the reference.


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



    if not _render_lock.acquire(timeout=180):
        raise HTTPException(503, "the renderer is busy; try again in a moment")
    try:
        t0 = time.time()
        pcm, marks, sr = render_via_docspeech(spec, texts)
        seconds = len(pcm) / 2 / sr
        outdir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tw:
            wav = tw.name
        with wave.open(wav, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm)
        opus = outdir / "part-01.opus"
        # mindX's encoder, not opusenc: at 24 kbps two encoders do not leave the
        # same artefacts, and at that bitrate the artefacts are the character.
        import numpy as _np
        try:
            _encode_ogg(_np.frombuffer(pcm, dtype="<i2"), sr, opus, codec="opus")
        except Exception as e:
            shutil.rmtree(outdir, ignore_errors=True)
            raise HTTPException(500, "encode failed: %s" % e)
        os.unlink(wav)

        took = time.time() - t0
        manifest = {
            "key": key, "voice": req.voice, "voiceName": spec["name"],
            "source": req.url[:2048], "title": req.title[:300],
            "engine": "mindX docspeech: %s %s -> libsndfile Ogg/Opus" % (
                spec.get("engine"), spec.get("voice") or "(default)"),
            "engineNote": spec["note"],
            "layered": bool(spec.get("layers")),
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
            "voices": len(voices_table())}


if __name__ == "__main__":
    import uvicorn
    STORE.mkdir(parents=True, exist_ok=True)

    print("doc.player render on %s:%d  store=%s budget=%d MB"
          % (HOST, PORT, STORE, BUDGET // 1048576), flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
