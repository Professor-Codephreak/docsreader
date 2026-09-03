#!/usr/bin/env python3
"""Capture the mindX document reader verbatim from the page that serves it.

THE READER IS NOT IN A FILE ON THAT SERVER. It is assembled as Python strings in
mindx_backend_service/main_service.py and emitted inline, so there is no
doc-player.js to copy — /static/doc-player.js is a 404. An "extraction" kept by
hand therefore drifts the moment the generator changes, silently, and the copy in
this repo HAD drifted: 29,725 bytes against the 24,345 actually being served.

So the copy is taken from the served page and can be re-checked against it:

    python3 capture.py --verify     # does the repo match production right now?
    python3 capture.py --update     # take a new copy and report what moved

A copy you cannot verify is a rumour about the code.

WHAT IS CAPTURED, AND WHAT THAT MEANS. The page carries three inline blocks: an
ld+json card (skipped — it is metadata, not the reader), the player, and the page
chrome (font size, living-doc links). The player block is PARAMETERISED PER
DOCUMENT — it opens with `base='/listen/MANIFESTO.md'` and carries the voice
roster inline — so what is stored here is the MANIFESTO instance, which is the
one that was asked for. Another document's page differs in those literals and in
nothing else.
"""
import argparse, hashlib, re, sys, urllib.request
from pathlib import Path

URL = "https://mindx.pythai.net/doc/MANIFESTO"
HERE = Path(__file__).resolve().parent
UA = "docsreader-capture/1.0 (+https://github.com/Professor-Codephreak/docsreader)"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read().decode("utf-8", "replace")


def split(html: str) -> dict[str, str]:
    """The inline blocks, identified by what is in them rather than by position.

    Ordering would be a fragile key: a new inline block anywhere above the player
    would silently reassign every file. The player is the block that carries the
    transport globals; the chrome is the other one.
    """
    out: dict[str, str] = {}
    scripts = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S)
    for s in scripts:
        if s.lstrip().startswith("{"):
            continue                                   # ld+json metadata, not code
        if "listenState" in s or "listen-play" in s:
            out["doc-player.js"] = s
        else:
            out["page-chrome.js"] = s
    styles = re.findall(r"<style[^>]*>(.*?)</style>", html, re.S)
    if styles:
        out["doc-player.css"] = max(styles, key=len)   # the player sheet is the big one
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true", help="compare the repo copy with production")
    ap.add_argument("--update", action="store_true", help="overwrite the repo copy from production")
    ap.add_argument("--url", default=URL)
    a = ap.parse_args()
    if not (a.verify or a.update):
        ap.error("choose --verify or --update")

    blocks = split(fetch(a.url))
    if "doc-player.js" not in blocks:
        print("no player block found at %s — the page shape changed" % a.url, file=sys.stderr)
        return 2

    drift = 0
    for name, body in sorted(blocks.items()):
        f = HERE / name
        live = hashlib.sha256(body.encode()).hexdigest()
        have = hashlib.sha256(f.read_bytes()).hexdigest() if f.exists() else None
        same = (have == live)
        if a.update and not same:
            f.write_text(body)
        mark = "same" if same else ("updated" if a.update else "DRIFTED")
        if not same:
            drift += 1
        print("%-16s %6d B  live %s  %s" % (name, len(body), live[:12], mark))
        if not same and have:
            print("%-16s %6d B  repo %s" % ("", f.stat().st_size, have[:12]))

    if drift and a.verify:
        print("\n%d file(s) differ from production. Run --update." % drift, file=sys.stderr)
        return 1
    print("\nin step with %s" % a.url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
