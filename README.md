# docsreader

Two readers that speak a document aloud and light the words as they go, and the
one lesson that separates them.

```
mindx/       the mindX reader — rendered audio, XMMS transport, scope + spectrum
deltaverse/  the DeltaVerse reader — browser synthesis, block highlighting, an audio store
```

Both give a page a **LISTEN** button that opens a panel and starts reading in the
same gesture — an open panel with a silent play button asks you to press a second
button to do the thing you already asked for.

---

## `mindx/` — the rendered reader

Extracted whole from `mindx_backend_service/main_service.py`, where it lived as
Python string concatenation. That is *why* it is extracted: a `\n` that went
through one too few levels of escaping once emitted a **literal newline inside a
JS string literal** and killed the entire player on a live page. Code generated
by string-joining in another language cannot be linted, cannot be
syntax-checked before it ships, and cannot be tested outside its host.

- **XMMS/Winamp 2.x anatomy** — title marquee, LED clock, small visualiser, one
  transport row, seek bar, volume and balance, and two buttons that open the
  other two windows. Borrowed on purpose: that layout settled this problem in
  1997.
- **PL is not a metaphor** — a document's *parts* are a playlist.
- **Oscilloscope and spectrum**, with a zoom from the analyser's full ~43 ms
  window down to **0.7 ms**, where a waveform stops being a green smear and
  becomes a pitch period you can count.
- **Volume to 400 %**, remembered per voice — an `<audio>` element's own volume
  is capped at 1.0 and can only attenuate, so above 100 % this drives a Web Audio
  `GainNode` and reports the amplification in dB.
- **Stereo balance** on a real `StereoPannerNode`, absent rather than faked where
  the browser has none.
- **A window** — drag, resize, and shade to a bar carrying transport, timeline,
  download and the oscilloscope. Nothing is duplicated to make the small mode
  work: the bar *is* the transport in both.

```bash
cd mindx && npm run check && npm run serve
# http://localhost:8899/examples/standalone.html   (mock backend included)
```

### The backend contract

One endpoint, two shapes:

```
GET {base}?engine=&voice=&rate=&format=json  -> {state, manifest:{parts:[{file,seconds,bytes,words,backend}]}}
GET {base}/{part.file}?engine=&voice=&rate=  -> audio/ogg   (Range-capable)
```

`examples/mock_backend.py` is forty lines that satisfy it, so the player runs
with no mindX at all.

---

## `deltaverse/` — the synthesis reader

Reads the document **the browser is already showing** — no rendering service, no
audio files, nothing fetched. It works on a static host and would work from IPFS.
Progress is driven by the synthesiser's own **word-boundary events** rather than
by a timer, which is why the highlight tracks the voice instead of drifting.

When a page *has* been rendered ahead, it plays the file instead and lights the
**block** (a file has no word boundaries, but the manifest carries the second
each block begins).

`render/` rebuilds a voice into the store:

```bash
python3 render/blocks.py https://host/page.html     # reproduce collect(), verified by checksum
python3 render/render_neural.py voices neural       # piper -> opus + manifest with marks
```

### Three fixes worth carrying into any reader

1. **Falling back into silence is not a fallback.** The reader dropped to live
   synthesis on any audio error — including on machines with **zero installed
   voices**, every headless Linux, which is precisely the machine that most needs
   the rendered audio. Degrading from something that failed once to something
   that *cannot work* is strictly worse than staying put and saying so.
2. **Never show a state the machine cannot be in.** After that fallback the
   transport showed the pause glyph while nothing could possibly play.
3. **`cache: 'force-cache'` on a mutable manifest pins readers to the first
   render they ever saw.** Re-rendering a voice from espeak-ng to piper changed
   nothing in any browser that had visited before — it kept playing the old voice
   and reporting the old duration. The manifest must revalidate (`no-cache`, one
   conditional request, usually a 304), and the part URLs must carry a version
   derived from the render, so new audio is a different resource rather than the
   same name with different bytes.

---

## The lesson the two share

The same optimisation is correct in one and a bug in the other.

The live substrate behind these readers links particles by proximity and tests
only its eight array-neighbours — fine at 30 fps, because the nodes **drift**: a
link missed this frame forms two seconds later. Copied faithfully into a *still*
renderer it drew ten links across sixty-four nodes and read as scattered dots.
A still has no later.

**An optimisation that is correct in a moving field is a bug in a frozen one.**

---

## Licence

Apache-2.0. Built for [mindX](https://mindx.pythai.net) and
[DeltaVerse](https://deltaverse.pythai.net) by
[Professor Codephreak](https://github.com/Professor-Codephreak).
