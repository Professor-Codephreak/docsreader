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
