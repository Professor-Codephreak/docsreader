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

function Strip({ caption, children, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }} title={hint}>
      {children}
      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.16em', color: INK3 }}>{caption}</span>
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
function Gain({ vol, voiceLabel }) {
  const db = vol > 100 ? 20 * Math.log10(vol / 100) : (vol > 0 ? 20 * Math.log10(vol / 100) : -Infinity)
  return (
    <Strip
      caption={voiceLabel ? `GAIN · ${voiceLabel}` : 'GAIN'}
      hint={(vol > 100
        ? `amplified ${db.toFixed(1)} dB above the file`
        : (vol === 100 ? 'the file, unamplified' : `${(-db).toFixed(1)} dB below the file`))
        + ' — remembered per voice'}>
      <MetalKnob
        value={vol} min={0} max={400} step={1}
        taper={powTaper(2)} detents={[100]} detentSize={0.03}
        size={62} color={vol > 100 ? GOLD : GREEN} tone="dark"
        aria-label="volume, up to 400 percent"
        onChange={(v) => window.listenVol && window.listenVol(v)}
      />
      <SegmentDisplay
        value={vol >= 100 ? db.toFixed(1) : String(vol)}
        digits={5} height={15} color={vol > 100 ? GOLD : GREEN}
      />
      <span style={{ fontFamily: MONO, fontSize: 8.5, color: INK3 }}>
        {vol >= 100 ? 'dB OVER FILE' : `${vol}% OF FILE`}
      </span>
    </Strip>
  )
}

// SPEED. Same 0.5-2.5x the slider spans, with 1x detented.
function Speed({ rate }) {
  return (
    <Strip caption="SPEED" hint={`${rate}× playback`}>
      <VintageKnob
        value={rate} min={0.5} max={2.5} step={0.01}
        detents={[1]} detentSize={0.02}
        size={54} color={BLUE}
        aria-label="playback speed"
        onChange={(v) => window.listenSpeed && window.listenSpeed(v)}
      />
      <SegmentDisplay value={rate.toFixed(2)} digits={4} height={13} color={BLUE} />
    </Strip>
  )
}

// LEVEL. The real thing: RMS over the AnalyserNode the scope and spectrum
// already build, in dBFS, with the meter's own ballistics and peak hold. It
// reads AFTER the gain node, so it shows what is actually reaching the ear —
// which is the only reason to put a meter next to a gain knob at all.
function Level({ playing }) {
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
    <Strip caption="LEVEL" hint="RMS after the gain stage, dBFS — what reaches the ear">
      <Meter
        value={db} min={-60} max={0} scale="db" orientation="vertical"
        length={72} breadth={13} segments={20} peakHold={900} ballistics
        zones={[{ upTo: -12, color: GREEN }, { upTo: -3, color: GOLD }, { upTo: 0, color: RED }]}
        disabled={!playing}
      />
      <SegmentDisplay value={db <= -60 ? '--' : db.toFixed(0)} digits={3} height={13}
        color={db > -3 ? RED : db > -12 ? GOLD : GREEN} />
    </Strip>
  )
}

// VOICE. The registry, in the order the picker renders it. A voice change is a
// different rendering and therefore a different cache key — this is the most
// expensive control on the panel, so it commits on release, not per step.
function Voice({ voices, voice }) {
  const labels = voices.map(v => String(v.label || v.id || '').slice(0, 9).toUpperCase())
  const i = Math.max(0, voices.findIndex(v => v.id === voice))
  return (
    <Strip caption="VOICE" hint="each voice is a separate rendering">
      <SegmentSwitch
        options={labels} value={i} led color={GOLD} size={11}
        onChange={(n) => voices[n] && window.listenVoice && window.listenVoice(voices[n].id)}
      />
    </Strip>
  )
}

function Transport({ playing, ready, part, parts }) {
  return (
    <Strip caption="TRANSPORT" hint={parts ? `part ${part + 1} of ${parts}` : 'not rendered yet'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TransportButton
          kind={playing ? 'pause' : 'play'} active={playing} size={30}
          color={playing ? GREEN : GOLD}
          onClick={() => window.listenToggle && window.listenToggle()}
        />
        <SegmentDisplay value={parts ? `${part + 1}-${parts}` : '--'} digits={4} height={15}
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
  if (!s) return null
  return (
    <DreamknobProvider theme={THEME}>
      <Rack title="AUDIO DECK" accentColor={GOLD} style={{ maxWidth: 760 }}>
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end',
          gap: 22, padding: '10px 14px',
        }}>
          <Transport playing={s.playing} ready={s.ready} part={s.part} parts={s.parts} />
          <Gain vol={s.vol} voiceLabel={(s.voices || []).find(v => v.id === s.voice)?.label} />
          <Level playing={s.playing} />
          <Speed rate={s.rate} />
          <Voice voices={s.voices || []} voice={s.voice} />
        </div>
      </Rack>
    </DreamknobProvider>
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
