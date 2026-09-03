# Technical

## Layout

```
deltaverse/
  engine/voices.js        the voice registry: two saved voices + derivations
  engine/doc-reader.js    the reader, the panel, the transport, the deck contract
  engine/doc-audio.js     the audio store client (manifest + parts + download)
  voices/neural.json      THE IMMUTABLE REFERENCE, written down
  voices/espeak-ng/       the tuned cast (full voices and !v/ variants)
  render/                 ahead-of-time rendering into the audio store
mindx/                    the same reader with an XMMS-era transport
wordpress/                wordpress.reader — the reader running inside WordPress
```

## The voice registry (`voices.js`)

Two frozen records — `NEURAL` and `JAIMLA` — in `SAVED`, plus `DERIVED` entries
holding a ratio and a `from`. `get(id)` returns a resolved voice; a saved voice
returns its own prosody, a derived one multiplies its parent's.

```js
DVVoices.get('neural')   // { prosody, voice, reference: true, saved: true }
DVVoices.list()          // saved first, then derivations
DVVoices.edit('ovie', { rate: 0.9 })   // derivations only; persisted
DVVoices.edit('neural', …)             // refused, with the derivation to make
DVVoices.derive('mine', { from: 'jaimla', delta: { rate: 0.95 } })
DVVoices.usable()        // API present AND at least one voice enumerated
```

`ready()` is memoised and bounded by a **wall-clock** deadline (2 s), not a tick
count — see *Counting ticks is not measuring time* in `explanation.md`.

`pick(spec)` walks `spec.prefer` in order, first match wins, preferring voices in
the reader's own language within each tier. A voice that names a platform voice
which is not installed therefore degrades to the best present one rather than to
nothing.

## Block extraction

`collect(root)` selects
`h1,h2,h3,h4,p,blockquote,li,cite,figcaption,dd,dt,td,[data-read]`, keeps only
leaves (an element containing another match is a container, not a block), skips
anything inside `[data-noread]`, `script`, `style`, `nav`, `.foot`, `.drift`, and
requires at least one alphanumeric character.

`render/blocks.py` reproduces this server-side and prints a checksum, because the
audio manifest aligns to blocks **by index**. Change the prose and the marks move.

## The audio store

```
/audio/<doc>/<voice>/part-01.opus
/audio/<doc>/<voice>/manifest.json
```

```json
{ "voice": "neural", "blocks": 28, "seconds": 205.5,
  "parts": [{ "url": "…/part-01.opus", "from": 0, "to": 27,
              "marks": [{ "block": 0, "at": 0.0 }, …] }] }
```

**Caching.** The manifest must revalidate (`Cache-Control: no-cache`) and part
URLs must carry a version derived from the render. `cache: 'force-cache'` on a
mutable manifest pins a reader to the first render they ever saw: re-rendering a
voice changed nothing in any browser that had visited before — it kept playing
the old audio and reporting the old duration. New audio must be a *different
resource*, not the same name with different bytes.

## Rendering

| script | engine | notes |
|---|---|---|
| `render_neural.py` | piper | the reference. **No scaling flag.** |
| `render_derived.py` | piper | ratios; `model` may override the base |
| `render_overlord.py` | espeak-ng ×3 | body + calibrated octave + texture |
| `octave.py` | — | the octave calibration, shared |
| `docsplayer_service.py` | both | the live render service (`:4031`) |

**piper is non-deterministic** (`noise_scale 0.667`, `noise_w 0.8`): two renders
of one sentence differ byte for byte. Compare durations, never checksums.

Pitch is derived from duration, since piper has no pitch control:

```
length_scale L = P / S        →  duration ×L
declare the wav at SR × P     →  pitch ×P, duration ÷P
net: duration ×1/S, pitch ×P
```

**The octave** is calibrated, not computed. `octave.calibrate(wpm)` renders a
probe, measures f0 by autocorrelation, halves it, and binary-searches the sub
voice's `pitch` parameter until it lands there — writing `overlordsub` as it goes.
espeak's `pitch` is not linear in Hz at the bottom of its range, so halving the
parameter gives 1.24 octaves, not one. Achieved: −22 cents.

The three layers are aligned **per block**, each resampled to the body's exact
sample count, so drift is bounded by one sentence instead of accumulating across
a document. The alignment stretch is reported as a further detune, because it is.

## The player's contract

| control | behaviour |
|---|---|
| **LISTEN** | opens the panel **and reads**. Always. Closing is the × button's job. |
| **LISTEN while reading** | becomes a red **STOP** — back to the top, not merely paused |
| **voice change** | continues from where you were, carried as a FRACTION |
| **panel** | draggable **and** resizeable, position and size remembered |
| **AUDIO DECK** | open by default; the instruments and the fine controls together |

**LISTEN's contract is the word on it.** The handler used to TOGGLE the panel and start
playback only if the panel had been shut — so anything that had already opened it
(autostart, an earlier press, a restored layout) turned LISTEN into a close button.

**Autostart is off by default** for the same reason. A browser will not begin audio
without a gesture, so on a first visit autostart could only open the panel and wait,
which bought nothing and cost the button its meaning. `mount({autostart:true})` still
exists, waits for 6 s of buffer with a 9 s deadline, and if the browser refuses leaves
the panel open, loaded, and one press away **with the reason on the badge** — never a
play glyph that has already been turned down.

**A voice change carries a fraction, not a timestamp.** The same reading is 348 s in
neural and 582 s in OVERLORD, so 240 seconds into one is not 240 seconds into the other;
41% of the way through is 41% of the way through. On the mindX player the old voice also
keeps reading while the new one renders — a layered voice can be minutes of build, and
silence for that long is indistinguishable from a hang.

## The word being read

Two mechanisms, and the reader says which it is using.

**live** — `speechSynthesis` fires real `onboundary` events, so the word is measured. The
marker used to be found with `indexOf` on the block, which returns the FIRST occurrence:
in *"the voice is the reference the voice is not edited"* every `the` lit the first one
and the marker sat still while the reading moved on. It looked sloppy because it was —
the finger was on a different instance of the right word. It now walks text nodes from a
cursor that advances sentence by sentence.

**file** — a rendered file carries no word boundaries, only the second each BLOCK begins.
The block is exact; the position inside it is interpolated by weight (a word's length plus
a bonus for the punctuation after it, which is what actually takes the time).

Either way the marker **leads the clock by 220 ms**. `timeupdate` fires about four times a
second, so it was on average an eighth of a second stale before it moved — and a reader
watching the word follows the VOICE, so a consistently late marker reads as the page
lagging rather than as sampling.

**The three-word view** — previous, current, next, current highlighted — is driven by the
same source, so the panel and the page can never disagree about which word is being said.
Three words is the most you can read without moving your eyes, which makes it a place to
rest them rather than a second document to track.

## The instrument deck

The rack (`mindx/rack/`, built with esbuild to a committed artifact) owns no
state. It reads `window.listenState()` and writes through globals:

```js
window.listenState()      // { playing, ready, mode, part, parts, vol, rate,
                          //   voice, voices, analyser, ensureAudio }
window.listenVol(2.5)     // 0–4; above 1.0 needs the Web Audio graph
window.listenSpeed(1.25)  // quantised to the slider's own step
window.listenVoice('jaimla')
window.listenToggle()
window.dispatchEvent(new Event('mindx:listen'))   // re-read
```

The rack **measures its own box** with a ResizeObserver and steps between four layouts.
It was authored at 760 px inside a 308 px panel, and `overflow-x:auto` meant nothing
looked broken — the deck simply ran off the side with the voice switch out of reach. Steps
rather than a smooth scale, because a knob has a size below which it stops being usable
with a finger; below ~250 px the five strips become a two-column grid, since flex-wrap
leaves an orphan and reads as a break rather than an adaptation.

`ensureGraph()` builds `MediaElementSource → Gain → Analyser → destination`
lazily, on first use — an `AudioContext` constructed before a user gesture is
created suspended. It is **not** called `ensureAudio`: that name belongs to the
function creating the `<audio>` element, and a second `function ensureAudio()` in
one scope wins by hoisting and would stop the element being made at all.

## The render service (`:4031`)

`POST /docsplayer/render` `{ url, title, voice, blocks: [{text}] }` → a manifest.
`GET /docsplayer/{voices,store,health}`.

- Cache key: sha256 of voice + block texts. A hit re-serves and **touches** the
  directory, so the LRU tracks last *played*, not last *made*.
- Budget 300 MB, least-recently-played evicted first.
- One render at a time (2 vCPU), 12 renders per address per 5 minutes.
- Text reaches every synthesiser over **stdin, never argv** — `ps` is
  world-readable.
- Renders live under the document root and are served by Apache as static files:
  range requests, caching and download all come free.

## CORS

`/docsplayer/` and `/audio/` answer with `Access-Control-Allow-Origin` only for a
named list of origins, never a wildcard — a wildcard would make it an open render
farm. Verified both ways: an allowed origin gets the header, a foreign one gets
nothing.

## Browser facts worth knowing

- `speechSynthesis` existing ≠ speech being possible. Headless Linux enumerates
  zero voices and drops every utterance silently. Check `usable()`.
- Chrome pauses synthesis after ~15 s; the documented mitigation is a
  `pause()`/`resume()` nudge, harmless where it is not needed.
- Timers in a hidden tab are throttled to ~1 Hz, and to ~1/minute when fully
  backgrounded. Never build a timeout out of a tick count.
- `<audio>.volume` is an attenuator and clamps at 1.0.
- A `DOMParser` document has no browsing context: its scripts never run and its
  images never load. That is what makes it safe to parse a fetched page in.
