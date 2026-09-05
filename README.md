# docsreader

Readers that speak a document aloud and light each word as they say it.

[![LISTEN](https://img.shields.io/badge/▶_LISTEN-to_this_README-e3b341?style=for-the-badge)](https://deltaverse.pythai.net/docsreader)

GitHub strips `<script>` from a README, so the button above opens the same page
with the reader running on it.

## Live

Four surfaces, all running, all reading. Open any of them and press **LISTEN**.

| | | |
|---|---|---|
| **[docsreader](https://deltaverse.pythai.net/docsreader)** | the page that reads itself | Autoplays *this README* from a copy stored beside it. The first visitor's play renders the audio once and keeps it; every visit after that starts from the stored file — about a quarter of a second to sound, with no synthesiser touched. |
| **[docsplayer](https://deltaverse.pythai.net/docsplayer)** | it reads itself, and it reads any URL | The address bar. Paste a URL, watch each word light as it is spoken, download the audio when it finishes. Switch voice mid-sentence and it continues from where you were. |
| **[playdocs](https://deltaverse.pythai.net/playdocs)** | an instrument you open a document inside | The same reader behind a rack of controls — waveform, oscilloscope, per-voice knobs. |
| **[voices](https://deltaverse.pythai.net/voices)** | the cast | Every voice in one place: `neural`, `jaimla`, `overlord`, LEADER, ANCIENT, ZEN, and the classic faces that cycle on repeat presses. |

Two more, in context rather than on a page of their own:

- **[mindx.pythai.net/doc/MANIFESTO](https://mindx.pythai.net/doc/MANIFESTO)** — the reader as it ships inside a document view, with the XMMS-era transport and the instrument deck docked at the bottom. [THESIS](https://mindx.pythai.net/doc/THESIS) too.
- **[wordpress-reader.js](https://deltaverse.pythai.net/engine/ngn/wordpress-reader.js)** — `wordpress.reader`, served and CORS-open for any WordPress that wants it.

The reading is done by the store behind these pages, which you can look at directly:
[`/docsplayer/voices`](https://deltaverse.pythai.net/docsplayer/voices) is the registry the
three surfaces share, and [`/docsplayer/store`](https://deltaverse.pythai.net/docsplayer/store)
reports how much of its 300 MB is spent and what gets pruned next.

```
deltaverse/   the DeltaVerse reader — voice registry, panel, audio store, renderers
mindx/        the same reader with an XMMS-era transport and an instrument deck
wordpress/    wordpress.reader — the reader running INSIDE WordPress
rageweb/      a page, ingested for retrieval the way the reader already reads it
docs/         technical.md · explanation.md · usage.md
```

## What it does

Give a page a **LISTEN** button that opens a panel and starts reading in the same
gesture — an open panel with a silent play button asks you to press a second
button to do the thing you already asked for.

It reads from one of two places and always says which. **live** is the browser's
own synthesiser, on-device, nothing downloaded. **file** is audio rendered ahead
into a store, which starts instantly, seeks, and can be downloaded — and which
works on a machine with no installed speech voices at all.

## The voices

`neural` is the reference and the default, on every page and after every refresh.
It is never edited, only derived from — and it carries no tuning parameter at
all, not even one set to 1.0, because a field that exists will eventually be set.
It is written down in [`deltaverse/voices/neural.json`](deltaverse/voices/neural.json).

`jaimla` is the female voice, and she is **saved in her own right rather than
derived**. She used to be neural with a ratio applied — a shade slower, a shade
lower — which is a male voice pitched down under a woman's name. Pitch is not
gender: lowering a male voice drags its formants down and produces a larger man.
What carries gender is which voice is *chosen*, so she selects a female voice
rather than multiplying a male one. Measured, 183.8 Hz against neural's 94.6; the
old ratio version came out at about 87, lower than the voice it differed from.

`overlord` is its own voice too — one accent assembled from eight world Englishes
carrying LEADER's mass, with ANCIENT's refusal to ever raise a syllable, and a
calibrated octave underneath at 40 Hz.

## Three ways to run it

**On a page you control** — three scripts and `DVDocReader.mount()`.

**On any URL** — [doc.player](https://deltaverse.pythai.net/docsplayer) has
an address bar. Paste a URL, hear it read, render it to a file you keep. No
markup from the fetched page ever enters the reader's: the response is parsed in
an inert document and only *text* comes out.

**On WordPress** — `wordpress.reader`, one custom-HTML widget in a footer region,
and every article gets a LISTEN button.

## Why wordpress.reader exists, and why it is not a fetcher

doc.player can already read a pasted URL. A typical WordPress install cannot be
read that way, and [rage.pythai.net](https://rage.pythai.net) is the case that
proved it:

```
$ curl -H 'Origin: https://deltaverse.pythai.net' https://rage.pythai.net/
HTTP/2 403                     ← the host's WAF refuses non-browser clients
(no access-control-allow-origin header at all)
```

Two independent walls, either fatal alone — measured from two networks, so it is
the host and not a rule about one address. You cannot fix that from outside, and
the "fix" would be a server that fetches any URL handed to it, which is an open
relay into everything it can reach.

So the reader moves onto the site and reads the article it is already inside.
Same origin: nothing to fetch, no CORS, no WAF, and the text is in the DOM, which
is where a reader should have been looking.

## Ingestion — RAGEweb

Retrieval and reading-aloud want the same thing from a page: the prose without
the furniture. The reader already solves that, so `rageweb/` packs the *same*
extraction into the chunk shape [mindX](https://mindx.pythai.net)'s own ingestion
uses, and a page arrives in the index looking like a document.

```bash
python3 rageweb/rageweb.py https://deltaverse.pythai.net/voices
python3 rageweb/rageweb.py --blocks /tmp/blocks.json --name deltaverse/voices
```

Chunking mirrors mindX deliberately: 512 words where the embedding window allows
it, 200 (`--conservative`) where it does not, because **words are not tokens** and
a 500-word chunk overflows a 512-token window. A page too short to chunk is
reported as such rather than as a failure.

## Documentation

- **[docs/usage.md](docs/usage.md)** — how to run it, all three ways
- **[docs/technical.md](docs/technical.md)** — the interfaces, formats and browser facts
- **[docs/explanation.md](docs/explanation.md)** — why it is shaped this way; every
  section is a decision that went the other way first

## Related

- [rage.pythai.net](https://rage.pythai.net) — where the writing this reads is published
- [mindx.pythai.net](https://mindx.pythai.net) — the mind that does the writing
- [deltaverse.pythai.net](https://deltaverse.pythai.net) — the reader, running

---

*A fluid dynamic between participants and augmented intelligence.*
