#!/usr/bin/env python3
"""RAGEweb — a web page, ingested the way the reader already reads it.

WHY THIS BELONGS NEXT TO A READER. Retrieval and reading-aloud want exactly the
same thing from a page: the prose, without the furniture. The reader already
solves that — `collect()` takes the leaf text nodes, skips navigation, footers,
share widgets and anything marked `data-noread`, and drops duplicates that a
theme repeats in two places. A retrieval index built from `<body>.textContent`
gets the cookie banner, the menu and the related-posts list embedded alongside
the article; one built from the reader's blocks does not.

So RAGEweb is not a second extractor. It is `blocks.py` — the same extraction the
audio store is rendered from, checksum and all — packed into the chunk shape
mindX's own ingestion uses, so a page and a document arrive in the index looking
alike.

EXTRAPOLATED FROM mindX's INGESTION, and matched to it deliberately:

  chunk size    512 words when the embedding window is >= 2048 tokens, else 200
                (agents/memory_pgvector.py: DEFAULT_CHUNK_WORDS). This is not a
                style preference — mxbai-embed-large has a 512-TOKEN window, and
                a 500-WORD chunk overflows it, because words are not tokens. The
                conservative figure is the one that cannot overflow.
  doc_name      a stable key. mindX uses the docs-relative path with the
                extension stripped; a page uses host + path, which is the same
                idea: the thing you would cite.
  0 chunks      is not always failure. Below MIN_CHUNKABLE_CHARS a page is
                legitimately too short to chunk, and mindX's ingest distinguishes
                that from an embedding that DEFERRED under CPU load and must be
                retried. RAGEweb reports which, and never records a short page as
                a failure.

WHAT IT DOES NOT DO. It does not fetch a page the host refuses to serve, and it
does not pretend to. rage.pythai.net answers 403 to any non-browser client and
sends no CORS header — measured from two networks — so a page there is ingested
from the SERVER SIDE by whatever already has access, or by the reader running on
the site itself. There is deliberately no general-purpose URL fetcher here for
the same reason there is none behind doc.player: a service that will retrieve any
URL handed to it is an open relay into everything it can reach.

    python3 rageweb.py https://deltaverse.pythai.net/voices.html
    python3 rageweb.py --blocks /tmp/blocks.json --name deltaverse/voices
"""
import argparse, hashlib, json, re, sys, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deltaverse" / "render"))

DEFAULT_CHUNK_WORDS = 512      # mirror of memory_pgvector.DEFAULT_CHUNK_WORDS
CONSERVATIVE_WORDS = 200       # what to use when the embed window is small
MIN_CHUNKABLE_CHARS = 300      # mirror of ingest_reference_docs.MIN_CHUNKABLE_CHARS

UA = "RAGEweb/1.0 (+https://github.com/Professor-Codephreak/docsreader)"


def doc_name_for(url: str) -> str:
    """The key a chunk is filed under — what you would cite, not a hash."""
    m = re.match(r"https?://([^/]+)(/.*)?$", url)
    if not m:
        return re.sub(r"[^a-zA-Z0-9._/-]+", "-", url)[:120]
    host, path = m.group(1), (m.group(2) or "/")
    path = re.sub(r"\.html?$", "", path).strip("/") or "index"
    return "%s/%s" % (host, path)


def blocks_from_url(url: str) -> list[dict]:
    # blocks.py does its work at IMPORT time (it is a script first and a module
    # second), so importing it both runs a fetch of its own and prints a report.
    # Neither is wanted here, and the report would land in the middle of the JSON
    # on stdout. Contain it rather than editing a file the audio store depends on.
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()):
        import blocks as B                   # the reader's own extractor
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        html = r.read().decode("utf-8", "replace")
    c = B.C()
    c.feed(html)
    return [b for b in c.out if b.get("text")]


def chunk(texts: list[str], words: int) -> list[str]:
    """Chunk on WORD boundaries across the whole document, as mindX does.

    Not per block: a chunk that stops at a paragraph boundary wastes most of the
    window on short paragraphs, and the retrieval unit should be a passage rather
    than a sentence. Blocks are joined first, then split.
    """
    all_words = " ".join(texts).split()
    return [" ".join(all_words[i:i + words]) for i in range(0, len(all_words), words)]


def build(url: str | None, blocks: list[dict], name: str | None, words: int) -> dict:
    texts = [b["text"] for b in blocks]
    joined = " ".join(texts)
    sha = hashlib.sha256(joined.encode("utf-8")).hexdigest()
    chunks = chunk(texts, words) if len(joined) >= MIN_CHUNKABLE_CHARS else []
    return {
        "doc_name": name or doc_name_for(url or "unknown"),
        "source": url,
        "sha256": sha,
        "blocks": len(blocks),
        "words": len(joined.split()),
        "chars": len(joined),
        "chunkWords": words,
        "chunks": chunks,
        # 0 chunks is only a problem when there WAS enough text to chunk
        "tooShortToChunk": len(joined) < MIN_CHUNKABLE_CHARS,
        "extractor": "docsreader blocks.py (the same extraction the audio store renders from)",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("url", nargs="?", help="page to ingest")
    ap.add_argument("--blocks", help="read blocks from a blocks.py JSON file instead of fetching")
    ap.add_argument("--name", help="override doc_name")
    ap.add_argument("--words", type=int, default=DEFAULT_CHUNK_WORDS,
                    help="chunk size in words (use %d for a 512-token window)" % CONSERVATIVE_WORDS)
    ap.add_argument("--conservative", action="store_true",
                    help="chunk at %d words — the size that cannot overflow a 512-token "
                         "embedding window, because words are not tokens" % CONSERVATIVE_WORDS)
    ap.add_argument("--out", help="write JSON here instead of stdout")
    a = ap.parse_args()
    if not a.url and not a.blocks:
        ap.error("give a URL, or --blocks from blocks.py")

    words = CONSERVATIVE_WORDS if a.conservative else a.words
    if a.blocks:
        blocks = json.load(open(a.blocks))
    else:
        try:
            blocks = blocks_from_url(a.url)
        except Exception as e:
            # Say which wall was hit. A 403 from a WAF and a network error are
            # different problems with different answers.
            print("could not read %s: %s" % (a.url, e), file=sys.stderr)
            print("  If this is a WAF (403 to non-browser clients), ingest from a host that "
                  "already has access, or run the reader on the site itself.", file=sys.stderr)
            return 2

    out = build(a.url, blocks, a.name, words)
    text = json.dumps(out, indent=1) + "\n"
    if a.out:
        Path(a.out).write_text(text)
        print("%s: %d blocks -> %d chunks of <=%d words (sha %s)"
              % (out["doc_name"], out["blocks"], len(out["chunks"]), words, out["sha256"][:12]))
    else:
        sys.stdout.write(text)
    if not out["chunks"] and not out["tooShortToChunk"]:
        print("0 chunks from a page that had enough text — check the extractor", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
