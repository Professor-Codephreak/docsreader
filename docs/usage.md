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

For a site you publish to but cannot fetch from — which, as it turns out, is most
WordPress sites.

### The plugin

[wordpress-reader.zip](https://deltaverse.pythai.net/wordpress-reader.zip)
(`sha256 7287feb61952255b40f065d532bc585e5230cbef2f87d20a137caa3021ed1124`,
[verify](https://deltaverse.pythai.net/wordpress-reader.zip.sha256)), v1.2.0,
source in `wordpress/plugin/`.

**Install:** Plugins → Add New Plugin → Upload Plugin → choose the zip → Install
Now → Activate. With the defaults every post now has LISTEN beside its headline;
Settings → Reader is optional.

**Adding LISTEN to an article** — three ways, and they compose:

| you want | do this |
|---|---|
| every article | nothing: *Every article* is the default under *Where it appears* |
| only some articles | Settings → Reader → *Only articles I switch on*; then the **LISTEN** box (Default / On / Off) in the editor sidebar of each article |
| the button at an exact spot | type `[listen]` in the text; `[listen share="yes"]` brings SHARE. The shortcode switches the reader on for that article by itself |
| one article excluded | its LISTEN box → *Off*. Off wins over everything |
| try it on one article first | put its post ID in *Only these posts*; clear the field to go site-wide |

Settings → Reader:

| setting | what it does |
|---|---|
| Where it appears | every article of the chosen types, or only articles switched on |
| Post types | which single post types get a button. Archives and search are never read |
| Only these posts | post IDs. Empty means no restriction |
| Button position | beside the headline (default), a row above the text, or a row below it. `[listen]` overrides it per article |
| Share button | on by default. SHARE beside LISTEN and in the corner of the featured image; shares the page's own Open Graph card |
| Rendered audio store | optional. A store that holds a recording plays the file instead. The store only answers hosts it has been told about |
| Store prefix | names this site inside a shared store; defaults to your domain |
| Theme selectors | only needed if your theme names its article something unusual |
| Script source | where the reader files load from; leave alone unless you host them |

The plugin's decisions are covered by `wordpress/plugin/tests/plugin_test.php`
(32 checks; run with `docker run --rm -v "$PWD:/w:ro" -w /w php:8.3-cli php
tests/plugin_test.php` from `wordpress/plugin/`).

**Why a plugin rather than script tags.** The widget below works and needs
nothing installed, but it cannot know anything: it infers the post from a body
class and finds the article by trying selectors themes tend to use. On the first
real install that inference reached past the article, and the reader read the
site footer aloud. WordPress knows all of it; the plugin passes it down.

### The widget, for a site where you cannot install a plugin

Add **one** custom-HTML widget in a footer region. This is the widget exactly
as it runs on rage.pythai.net, rendered-audio lane included:

```html
<script>
  window.WPReader = { only: [1469, 1428, 1476], chooser: true, autorender: true, anticipate: true, gloss: true,
                      renderHost: "https://deltaverse.pythai.net", content: ".entry-content", title: "h1.entry-title",
                      audioRoot: "https://deltaverse.pythai.net/audio", share: true };
  window.DV_AUDIO_ROOT = "https://deltaverse.pythai.net/audio";
</script>
<script src="https://deltaverse.pythai.net/engine/ngn/voices.js"></script>
<script src="https://deltaverse.pythai.net/engine/ngn/doc-reader.js"></script>
<script src="https://deltaverse.pythai.net/engine/ngn/doc-audio.js"></script>
<script src="https://deltaverse.pythai.net/engine/ngn/listen-diag.js"></script>
<script src="https://deltaverse.pythai.net/engine/ngn/wordpress-reader.js"></script>
```

Every field of `WPReader` is optional; with none of it the script falls back to
inspection. An absent or empty `only` means no restriction, so forgetting the
allowlist cannot silently disable the reader. `place: "top" | "bottom"` moves
the button off the headline; a `<span class="wp-reader-listen"></span>` in the
article (what the plugin's `[listen]` prints) wins over `place`.

### Sharing, from the image

`share` (default `true`) adds SHARE beside LISTEN and the same control in the
corner of the featured image. Both share what a share actually shows: the page's
own `og:title`, `og:description` and `og:image`, read from the `<head>` the site
already emits, so the preview a reader is handed is the preview the network will
render. Where the Web Share API can take files the image travels with the link;
everywhere else a small menu offers X, Facebook, LinkedIn, Reddit, Pinterest
(the one network that pins the image itself), Telegram, WhatsApp, email, copy
link and save image, with the card previewed above them. `share: 'title'` or
`'image'` keeps one control; `share: false` removes both; `shareImage: url`
overrides the card. The script sends nothing: every route is a link the visitor
opens, or the browser's own sheet. Live: the SHARE on
[chainmarketcap-two-stores](https://rage.pythai.net/chainmarketcap-two-stores/).

**A footer widget, not post content.** WordPress runs `wpautop` over post bodies
and it mangles `<script>`. The widget region is the only reliable sitewide route.

It is inert on anything that is not a single article, so archives, the home page
and search results are left alone.

Live example: [rage.pythai.net/three-readers-one-voice](https://rage.pythai.net/three-readers-one-voice/).

### Playing a rendered file instead of synthesising

Add `doc-audio.js` and point it at a store. The reader asks the store whether it
holds a recording of this post, plays the file when it does — which seeks, scrubs
and downloads — and falls back to live synthesis when it does not.

```html
<script>
window.WPReader  = { only: [1469], doc: "rage-1469",
                     audioRoot: "https://deltaverse.pythai.net/audio" };
window.DV_AUDIO_ROOT = "https://deltaverse.pythai.net/audio";
</script>
<!-- ...voices.js, doc-reader.js... -->
<script src="https://deltaverse.pythai.net/engine/ngn/doc-audio.js"></script>
<script src="https://deltaverse.pythai.net/engine/ngn/listen-diag.js"></script>
<!-- ...wordpress-reader.js -->
```

The store root must be absolute. `doc-audio.js` defaults to a same-origin
`/audio`, which is right on every DeltaVerse page and wrong on the one reader
that does not run there — the publisher's own `/audio` is empty, and the reader
would settle into live synthesis without ever saying why. Cross-origin reads work
because the store answers with an `Access-Control-Allow-Origin` for named hosts;
an unnamed host gets no manifest and falls back, which is the same thing that
happens for a post nobody has rendered.

Render a post the way any other document is rendered, with the block list the
reader itself produces so the marks line up by index:

```bash
python3 deltaverse/render/render_neural.py rage-1469 neural   # reads /tmp/blocks.json
```

### Four things the first real install cost us

**Mount on the article, not on an ancestor of it.** Putting the button inside the
document's own `<h1>` meant mounting on the nearest element containing both the
headline and the body — which on a normal theme contains the site footer too.
Mount on the content and *move* the button afterwards; moving a node does not
disturb its listeners.

**Furniture lives inside the content as well as around it.** A signed author
identity block was the last child of `.entry-content`, so it looked exactly like
prose, and the reader read a wallet address out loud. Selector lists that only
name things *around* an article will not catch it.

**Not every registered footer region renders.** `footer-1` through `footer-4` all
reported `status: active` over REST; only `footer-1` was ever emitted by the
theme. A widget placed in `footer-2` verified perfectly and appeared nowhere.
Check a rendered page, not the sidebar's own status.

**Read widgets with `?context=edit` or they all look empty**, and placing a
widget blanks it — create, place, then write the content again, three calls that
all answer `200`. There is an installer that does the dance and verifies the
result in mindX at `agents/wordpress_agent/scripts/footer_widget.py`.

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
checksum for exactly this reason, and since 2.1.0 the manifest carries a
fingerprint per block: the player fingerprints the page it is on, lines the
recording up with it, and shows *rendered · page changed* on the badge rather
than lighting the wrong paragraph. This happened on the first real install — a
figure caption left the article after the render and every highlight after it
ran one paragraph ahead of the voice for two days.

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
