#!/usr/bin/env python3
"""Pre-render every voice for a document, so switching never has to wait.

WHY. docspeech builds ONE document at a time, on purpose: this host has two
vCPUs and a second concurrent render would take them both and starve everything
else. That is the right call and it has a consequence nobody sees until a slow
voice is asked for — LEADER is layered and runs at about 1.08x realtime, so an
eighteen-minute document is a seventeen-minute build, and every other voice
requested during it queues behind it. A two-second espeak render then appears to
hang, because it is waiting, not working.

The player already survives this: switching keeps the current voice reading until
the new one is ready, so the wait is never silence. But the best wait is the one
that already happened. This warms the cache ahead of time, slowest voice FIRST,
so the long pole is out of the way before anyone asks for it.

    python3 scripts/warm_docspeech.py MANIFESTO.md
    python3 scripts/warm_docspeech.py MANIFESTO.md --only classic,leaderofearth

Idempotent: a voice already rendered returns ready and costs one request.
"""
import argparse, json, sys, time, urllib.parse, urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000"
CFG = Path(__file__).resolve().parents[1] / "data" / "config" / "docspeech_voices.json"
NOMINAL = 175.0


def faces(reg: dict):
    """Every renderable face, including a voice's alternates — CLASSIC is four
    machines behind one button and all four need warming, not just the first."""
    out = []
    for v in reg.get("voices", []):
        if v.get("disabled"):
            continue                                    # vCLONE renders nothing
        out.append((v["id"], v))
        for a in v.get("alternates", []) or []:
            merged = dict(v)
            merged.update({k: a[k] for k in ("engine", "voice", "rate", "pitch") if k in a})
            out.append((v["id"] + "/" + a.get("id", "alt"), merged))
    return out


def qs(v: dict) -> str:
    q = {"engine": v.get("engine") or "auto", "format": "json"}
    if v.get("voice"):
        q["voice"] = v["voice"]
    if v.get("rate"):
        q["rate"] = v["rate"]
    if v.get("pitch"):
        q["pitch"] = v["pitch"]
    if v.get("sentenceSilence"):
        q["sentence_silence"] = v["sentenceSilence"]
    return urllib.parse.urlencode(q)


def ask(doc: str, v: dict, timeout: float = 30.0):
    url = "%s/listen/%s?%s" % (BASE, urllib.parse.quote(doc), qs(v))
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode()), r.status
    except Exception as e:
        return {"state": "error", "job": {"error": str(e)}}, 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("doc")
    ap.add_argument("--only", help="comma-separated voice ids")
    ap.add_argument("--wait", type=int, default=2400, help="seconds to wait per voice")
    a = ap.parse_args()

    reg = json.loads(CFG.read_text(encoding="utf-8"))
    want = set(x.strip() for x in a.only.split(",")) if a.only else None
    todo = [(k, v) for k, v in faces(reg) if not want or k.split("/")[0] in want]

    # SLOWEST FIRST. The layered voices are the long pole and everything else
    # queues behind whatever is running, so starting with the quick ones just
    # means the quick ones finish and then you wait anyway.
    todo.sort(key=lambda kv: 0 if kv[1].get("engine") == "layered"
              else (1 if kv[1].get("engine") == "piper" else 2))

    print("warming %d face(s) for %s" % (len(todo), a.doc), flush=True)
    for key, v in todo:
        t0 = time.time()
        j, st = ask(a.doc, v)
        while j.get("state") == "building" and time.time() - t0 < a.wait:
            time.sleep(5)
            j, st = ask(a.doc, v)
        m = j.get("manifest") or {}
        state = j.get("state")
        if state == "ready" or (m.get("parts")):
            print("  %-22s ready  %5.0fs  %s parts  %s" %
                  (key, time.time() - t0, len(m.get("parts") or []),
                   (m.get("parts") or [{}])[0].get("backend", "")), flush=True)
        else:
            print("  %-22s %s  %s" % (key, state, (j.get("job") or {}).get("error", "")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
