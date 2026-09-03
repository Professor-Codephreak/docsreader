// Audio deck — the doc reader's playback controls as instruments.
//
// The other racks on this site are READ-ONLY: every needle is a number the mind
// produced and nothing on the panel accepts input. This one is the exception,
// and it is the only one: these knobs are controls, because playback is the one
// thing on a document page that genuinely belongs to the reader.
//
// It owns NO state. The plain HTML controls in .font-ctrl are the truth; this
// island reads window.listenState() and writes through the same globals they
// use (listenVol / listenSpeed / listenVoice / listenToggle), then re-reads on
// the "mindx:listen" event. Two faces, one machine — so a knob and its slider
// can never disagree, and the page still works with this script never loaded.
//
// Build: npm run build  →  ../static/audio_rack.js (committed; the VPS has no node).
import { useEffect, useRef, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import {
  DreamknobProvider, Rack, MetalKnob, VintageKnob, SegmentDisplay,
  Meter, SegmentSwitch, TransportButton, PushButton, powTaper,
} from 'dreamknob'

const GOLD = '#e3b341', BLUE = '#58a6ff', GREEN = '#3fb950', RED = '#f85149'
const INK3 = '#6b7480'
const MONO = "'JetBrains Mono','SF Mono','Fira Code',ui-monospace,monospace"

const THEME = {
  accent: GOLD,
  track: 'rgba(120,132,148,.18)',
  face: '#0a0e16',
  text: '#e6edf3',
  label: INK3,
  ticks: '#3a4350',
  panel: 'rgba(6,9,15,.72)',
  ledGreen: GREEN,
  ledAmber: GOLD,
  fontMono: MONO,
}

const snap = () => (window.listenState ? window.listenState() : null)

// ── HOW WIDE IS THE DECK ACTUALLY ALLOWED TO BE ─────────────────────────────
//
// The rack was built at maxWidth 760 and the panel it lives in is 308px wide.
// The container had overflow-x:auto, so nothing LOOKED broken — the deck simply
// ran off the side and you scrolled sideways to reach the voice switch. A rack
// you have to scroll horizontally is a rack with half its controls hidden, and
// hiding the controls is the one thing a control surface must not do.
//
// The panel is also `resize: both`, so its width is a live value the reader sets
// by dragging, not a constant to design against. ResizeObserver is the only
// honest answer: measure the box we were actually given, and re-measure whenever
// it changes. It fires on the drag, on window resize, on the accordion opening,
// and on a phone rotating — four things that would otherwise need four listeners
// and would still miss the drag.
function useBoxWidth(ref) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setW(el.clientWidth || el.getBoundingClientRect().width || 0)
    read()
    if (typeof ResizeObserver === 'undefined') {
      // no observer: the window is the next best proxy, and better than a constant
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

// THE TIERS. Not a smooth scale: knobs have a size below which they stop being
// usable with a finger, and text has a size below which it stops being text. So
// the deck steps between four layouts that were each chosen to work, rather than
// interpolating into sizes that work at neither end.
//
// `stack` is the important one. Below ~250px the five strips cannot sit in a row
// at any size, so they go to a two-column grid instead of wrapping raggedly —
// wrap leaves one orphan on the last line and reads as a mistake.
const TIERS = [
  { max: 250, id: 'micro', gain: 42, speed: 36, meter: 52, xport: 24, sw: 9,
    gap: 9, pad: '8px 8px', cap: 8, seg: 11, label: 5, cols: 2 },
  { max: 340, id: 'narrow', gain: 50, speed: 42, meter: 60, xport: 26, sw: 10,
    gap: 12, pad: '9px 10px', cap: 8.5, seg: 12, label: 6, cols: 0 },
  { max: 470, id: 'mid', gain: 56, speed: 48, meter: 66, xport: 28, sw: 10,
    gap: 16, pad: '10px 12px', cap: 9, seg: 13, label: 7, cols: 0 },
  { max: Infinity, id: 'wide', gain: 62, speed: 54, meter: 72, xport: 30, sw: 11,
    gap: 22, pad: '10px 14px', cap: 9, seg: 15, label: 9, cols: 0 },
]
const tierFor = (w) => TIERS.find(t => (w || 308) <= t.max) || TIERS[TIERS.length - 1]

function Strip({ caption, children, hint, t }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: t.id === 'micro' ? 4 : 6, minWidth: 0,
    }} title={hint}>
      {children}
      <span style={{
        fontFamily: MONO, fontSize: t.cap, letterSpacing: '.16em', color: INK3,
        // the caption is the first thing to overflow, and an ellipsis is more
        // honest than a caption that pushes the knob out of the panel
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{caption}</span>
    </div>
  )
}

// GAIN. 0-400%, and the top three quarters of that travel are AMPLIFICATION —
// above 100% the <audio> element is pinned at 1.0 and a Web Audio GainNode
// carries the rest, because an element's own volume can only ever attenuate.
// This is the knob ANCIENT needs: it is a whisper by design, and even after the
// -14 dBFS loudness normalisation it is the quietest thing in the cast.
//
// The taper is powTaper(2): loudness is not linear in the ear, so a linear
// knob spends most of its travel in the top of the range where nothing much
// changes. The square curve gives the quiet end the resolution it deserves.
// 100% is a magnetic detent — the file, unamplified, is a place you can find.
//
// The setting is PER VOICE. After normalisation the voices still do not arrive
// at the same loudness — ANCIENT is a whisper by design and takes +11.5 dB of
// make-up gain where LEADER takes -0.7 — so one global number is wrong by
// construction: set for one voice it is wrong for the next. Switching voices
// loads that voice's own gain.
function Gain({ vol, voiceLabel, t }) {
  const db = vol > 100 ? 20 * Math.log10(vol / 100) : (vol > 0 ? 20 * Math.log10(vol / 100) : -Infinity)
  return (
    <Strip
      t={t}
      caption={voiceLabel && t.id !== 'micro' ? `GAIN · ${voiceLabel}` : 'GAIN'}
      hint={(vol > 100
        ? `amplified ${db.toFixed(1)} dB above the file`
        : (vol === 100 ? 'the file, unamplified' : `${(-db).toFixed(1)} dB below the file`))
        + ' — remembered per voice'}>
      <MetalKnob
        value={vol} min={0} max={400} step={1}
        taper={powTaper(2)} detents={[100]} detentSize={0.03}
        size={t.gain} color={vol > 100 ? GOLD : GREEN} tone="dark"
        aria-label="volume, up to 400 percent"
        onChange={(v) => window.listenVol && window.listenVol(v)}
      />
      <SegmentDisplay
        value={vol >= 100 ? db.toFixed(1) : String(vol)}
        digits={5} height={t.seg} color={vol > 100 ? GOLD : GREEN}
      />
      {t.id === 'micro' ? null : (
        <span style={{ fontFamily: MONO, fontSize: 8.5, color: INK3 }}>
          {vol >= 100 ? 'dB OVER FILE' : `${vol}% OF FILE`}
        </span>
      )}
    </Strip>
  )
}

// SPEED. Same 0.5-2.5x the slider spans, with 1x detented.
function Speed({ rate, t }) {
  return (
    <Strip t={t} caption="SPEED" hint={`${rate}× playback`}>
      <VintageKnob
        value={rate} min={0.5} max={2.5} step={0.01}
        detents={[1]} detentSize={0.02}
        size={t.speed} color={BLUE}
        aria-label="playback speed"
        onChange={(v) => window.listenSpeed && window.listenSpeed(v)}
      />
      <SegmentDisplay value={rate.toFixed(2)} digits={4} height={t.seg - 2} color={BLUE} />
    </Strip>
  )
}

// LEVEL. The real thing: RMS over the AnalyserNode the scope and spectrum
// already build, in dBFS, with the meter's own ballistics and peak hold. It
// reads AFTER the gain node, so it shows what is actually reaching the ear —
// which is the only reason to put a meter next to a gain knob at all.
function Level({ playing, t }) {
  const [db, setDb] = useState(-60)
  const raf = useRef(0)
  const buf = useRef(null)
  useEffect(() => {
    let stop = false
    const tick = () => {
      if (stop) return
      const s = snap()
      const an = s && s.analyser
      if (an) {
        if (!buf.current || buf.current.length !== an.fftSize) buf.current = new Uint8Array(an.fftSize)
        an.getByteTimeDomainData(buf.current)
        let sum = 0
        for (let i = 0; i < buf.current.length; i++) {
          const x = (buf.current[i] - 128) / 128
          sum += x * x
        }
        const rms = Math.sqrt(sum / buf.current.length)
        setDb(rms > 0 ? Math.max(-60, 20 * Math.log10(rms)) : -60)
      } else {
        setDb(-60)
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { stop = true; cancelAnimationFrame(raf.current) }
  }, [])
  return (
    <Strip t={t} caption="LEVEL" hint="RMS after the gain stage, dBFS — what reaches the ear">
      <Meter
        value={db} min={-60} max={0} scale="db" orientation="vertical"
        length={t.meter} breadth={t.id === 'micro' ? 10 : 13}
        segments={t.id === 'micro' ? 14 : 20} peakHold={900} ballistics
        zones={[{ upTo: -12, color: GREEN }, { upTo: -3, color: GOLD }, { upTo: 0, color: RED }]}
        disabled={!playing}
      />
      <SegmentDisplay value={db <= -60 ? '--' : db.toFixed(0)} digits={3} height={t.seg - 2}
        color={db > -3 ? RED : db > -12 ? GOLD : GREEN} />
    </Strip>
  )
}

// VOICE. The registry, in the order the picker renders it. A voice change is a
// different rendering and therefore a different cache key — this is the most
// expensive control on the panel, so it commits on release, not per step.
function Voice({ voices, voice, t }) {
  // the cast is the widest thing on the deck, so the labels are the first thing
  // the tier shortens: nine characters at full width, five when there is no room
  const labels = voices.map(v => String(v.label || v.id || '').slice(0, t.label).toUpperCase())
  const i = Math.max(0, voices.findIndex(v => v.id === voice))
  return (
    <Strip t={t} caption="VOICE" hint="each voice is a separate rendering">
      <SegmentSwitch
        options={labels} value={i} led color={GOLD} size={t.sw}
        onChange={(n) => voices[n] && window.listenVoice && window.listenVoice(voices[n].id)}
      />
    </Strip>
  )
}

function Transport({ playing, ready, part, parts, t }) {
  return (
    <Strip t={t} caption="TRANSPORT" hint={parts ? `part ${part + 1} of ${parts}` : 'not rendered yet'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: t.id === 'micro' ? 5 : 8 }}>
        <TransportButton
          kind={playing ? 'pause' : 'play'} active={playing} size={t.xport}
          color={playing ? GREEN : GOLD}
          onClick={() => window.listenToggle && window.listenToggle()}
        />
        <SegmentDisplay value={parts ? `${part + 1}-${parts}` : '--'} digits={4} height={t.seg}
          color={ready ? GREEN : INK3} />
      </div>
    </Strip>
  )
}

function Deck() {
  const [s, setS] = useState(snap)
  const sync = useCallback(() => setS(snap()), [])
  useEffect(() => {
    // The meter reads the AnalyserNode, which does not exist until something
    // asks for it. Opening the deck is that ask.
    const st = snap()
    if (st && st.ensureAudio) { try { st.ensureAudio() } catch (e) { /* meter stays dark */ } }
    sync()
  }, [sync])
  useEffect(() => {
    window.addEventListener('mindx:listen', sync)
    const id = setInterval(sync, 1000)   // part index advances without an event
    return () => { window.removeEventListener('mindx:listen', sync); clearInterval(id) }
  }, [sync])
  // The box is measured, not assumed. The outer div is what the panel actually
  // gave us; everything inside sizes itself from that one number.
  const box = useRef(null)
  const w = useBoxWidth(box)
  const t = tierFor(w)
  if (!s) return null
  const strips = [
    <Transport key="x" t={t} playing={s.playing} ready={s.ready} part={s.part} parts={s.parts} />,
    <Gain key="g" t={t} vol={s.vol} voiceLabel={(s.voices || []).find(v => v.id === s.voice)?.label} />,
    <Level key="l" t={t} playing={s.playing} />,
    <Speed key="s" t={t} rate={s.rate} />,
    <Voice key="v" t={t} voices={s.voices || []} voice={s.voice} />,
  ]
  return (
    <div ref={box} style={{ width: '100%', minWidth: 0 }}>
    <DreamknobProvider theme={THEME}>
      {/* maxWidth was 760 in a 308px panel. It is now whatever we were given. */}
      <Rack title={t.id === 'micro' ? 'DECK' : 'AUDIO DECK'} accentColor={GOLD}
            style={{ maxWidth: '100%', width: '100%' }}>
        <div style={t.cols ? {
          // BELOW ~250px THE ROW CANNOT WORK AT ANY KNOB SIZE, so it becomes a
          // grid. Flex-wrap would leave one orphan strip on the last line, which
          // reads as a layout that broke rather than one that adapted.
          display: 'grid', gridTemplateColumns: `repeat(${t.cols}, minmax(0, 1fr))`,
          justifyItems: 'center', alignItems: 'end',
          gap: t.gap, padding: t.pad,
        } : {
          display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end',
          justifyContent: 'flex-start',
          gap: t.gap, padding: t.pad,
        }}>
          {strips}
        </div>
      </Rack>
    </DreamknobProvider>
    </div>
  )
}

// MOUNTING AT SCRIPT-EVAL TIME ONLY WORKS WHEN THE HOST IS ALREADY THERE.
//
// On the mindX doc page the player markup is server-rendered, so #listen-deck and
// window.listenState both exist before this file runs. On DeltaVerse the player
// builds its panel in JavaScript when the reader mounts, which can be after this
// script — so the one-shot check found nothing and the deck silently never
// appeared. Wait for both, briefly, instead of assuming a load order.
function mount() {
  const el = document.getElementById('listen-deck')
  if (!el || !window.listenState || el.dataset.mounted) return !!el?.dataset.mounted
  el.dataset.mounted = '1'
  createRoot(el).render(<Deck />)
  return true
}
if (!mount()) {
  const t0 = Date.now()
  const iv = setInterval(() => {
    // a wall-clock deadline, not a tick count: a hidden tab throttles timers to
    // about 1 Hz and a count of ticks would stretch ten seconds into minutes
    if (mount() || Date.now() - t0 > 10000) clearInterval(iv)
  }, 120)
  window.addEventListener('mindx:listen', mount)
}
