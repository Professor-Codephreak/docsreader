# Usage

Three ways to run the reader, in order of how little you have to do.

## 1. On a page you control

Three scripts and one line. The reader finds the document's own `h1`, puts a
**LISTEN** button in it, and reads what is on the page.

```html
<script src="/engine/ngn/voices.js"></script>
<script src="/engine/ngn/doc-audio.js"></script>
<script src="/engine/ngn/doc-reader.js"></script>
<script>
  DVVoices.ready().then(function () { DVDocReader.mount(); });
</script>
```

`mount()` takes options, all optional:

| option | meaning |
|---|---|
| `root` | the element to read. Default: the whole body. |
| `doc` | the key the audio store is filed under. Default: the page's filename. |
| `label` | what the panel calls this document. |
| `onUnavailable` | called with the button when nothing can be spoken. |

**Excluding things.** `data-noread` on any element keeps it out. `data-read`
includes something the default selector would miss — the reader looks for
`h1,h2,h3,h4,p,blockquote,li,cite,figcaption,dd,dt,td` and takes only leaves, so
a row built out of `<span>`s inside an `<a>` is invisible to it without the
opt-in.

## 2. Read a URL — doc.player

`docsplayer.html` is the reader with an address bar. Paste a URL; it fetches the
page, takes the text out of it and reads it, and can render the result to a file
you keep.

```
/docsplayer.html?url=https://example.com/article
```

**It can only read hosts that permit it.** A browser may not read another origin
unless that origin says so with a CORS header, and most do not. Same-site URLs
always work. When a fetch is refused the page says *why* — "example.com does not
allow other sites to read it (no CORS header)" — rather than failing vaguely.

There is deliberately no proxy behind the box. A server that will fetch any URL
handed to it is an open relay into everything it can reach, including whatever is
on its own private network.

## 3. On WordPress — wordpress.reader

For a site you publish to but do not want to fetch from — which, as it turns out,
is most WordPress sites. Add **one** custom-HTML widget in a footer region:

```html
<script src="https://deltaverse.pythai.net/engine/ngn/voices.js"></script>
<script src="https://deltaverse.pythai.net/engine/ngn/doc-reader.js"></script>
<script src="https://deltaverse.pythai.net/engine/ngn/wordpress-reader.js"></script>
```

Every article gets a LISTEN button. Nothing else to install.

**A footer widget, not post content.** WordPress runs `wpautop` over post bodies
and it mangles `<script>`. The widget region is the only reliable sitewide route.

It is inert on anything that is not a single article, so archives, the home page
and search results are left alone.

## Rendering audio ahead

A page that is rendered ahead plays instantly, seeks, and can be downloaded —
and it works on a machine with no installed speech voices at all, which is every
headless Linux and a fair number of desktops.

```bash
python3 render/blocks.py https://host/page.html    # extract blocks, checksummed
python3 render/render_neural.py voices             # the reference: piper, no flags
python3 render/render_derived.py voices            # the ratios on it
python3 render/render_overlord.py voices           # the layered voice
```

Each writes `/audio/<doc>/<voice>/part-01.opus` plus a `manifest.json` carrying
the second each block begins, so the highlight is measured rather than estimated.

**Re-render whenever the page text changes.** Blocks are aligned by index; edit
the prose and the old marks point at the wrong lines. `blocks.py` prints a
checksum for exactly this reason.

## Pre-rendering, and why the order matters

    python3 scripts/warm_docspeech.py MANIFESTO.md
    python3 scripts/warm_docspeech.py MANIFESTO.md --only classic,zen

Renders every face — alternates included, since CLASSIC is four machines behind one
button — **slowest first**. One document builds at a time (deliberately: two vCPUs), so
everything queues behind whatever is running. Warming the quick ones first just means the
quick ones finish and then you wait anyway.

It doubles as the diagnostic: it asks for every face in turn and prints what came back,
which is how half the cast was found returning HTTP 500 while looking merely slow.

## The voices

| voice | what it is | f0 |
|---|---|---|
| `neural` | the reference. Default everywhere, never edited, carries no rate or pitch. | ~95–101 Hz |
| `jaimla` | the female voice — female in the weights, not by a multiplier. | 184 Hz |
| `leader` | the reference, deepened and slowed, **shaped by EQ** rather than mixed with another voice. | 89 Hz |
| `overlord` | neural and jaimla **in unison** — two voices, aligned per sentence. | — |
| `classic` | four machines on one button: H.A.L · K.I.T.T · T1000 · FAIRYDUST. | 114 / 151 / 90 Hz |
| `ancient` | a whisper at speaking volume: folds closed, breath wide on top. | 89 Hz |
| `voicebox` | a 1990s speaking machine with a world accent. | 128 Hz |
| `zen` | one English from the Englishes of East Asia, syllable-timed. | 118 Hz |
| `sam`, `sagi` | the Scottish fourth, and the northern neural voice. | — |
| `ovie`, `participant` | stated ratios on neural. | — |

The espeak voices under `voices/espeak-ng/` need installing before the tuned cast
will speak; `voices/install_voices.sh` does it and then **proves** it worked by
synthesising and requiring a difference. An espeak variant that cannot be found
is not an error and is not silence — it renders the base voice and says nothing.
