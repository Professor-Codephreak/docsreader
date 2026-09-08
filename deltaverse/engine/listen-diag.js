/*!
 * DeltaVerse nGn — listen-diag (DVListenDiag: what listening actually costs, measured on this device).
 *
 * WHY. A player that says "rendering…" and a player that says "block 12 of 44 · 2.3× realtime · ≈40 s
 * left · 1.4 s buffered ahead · this voice runs on your CPU" are not the same instrument. The second
 * one lets a reader decide — wait, switch voice, or read it themselves. Every number here is either
 * measured on the device the page is running on, or copied verbatim from the render host's own
 * ledger and labelled as the host's. Nothing is estimated silently; where the browser cannot measure
 * something (no performance.memory, no AudioContext yet) the field is null and the display says so.
 *
 * WHAT IT MEASURES
 *   client   cores (navigator.hardwareConcurrency), device memory (navigator.deviceMemory, Chrome
 *            only, bucketed by the browser), JS heap (performance.memory, Chrome only), and
 *            main-thread jitter: the p95 overshoot of requestAnimationFrame over the last 120 frames.
 *            Jitter is the honest CPU-pressure proxy a page has — a busy main thread misses frames.
 *   audio    the <audio> element the page hands it: time, duration, seconds buffered AHEAD of the
 *            playhead, stalls (waiting events), and the AudioContext's declared output latency.
 *   synth    the browser synthesiser (the ANCIENT lane): time from speak() to the first sound, words
 *            per second from boundary events, characters per second, whether the platform voice is
 *            on-device (SpeechSynthesisVoice.localService) or a network voice — because "rendered on
 *            your CPU" is only true when it is, and this module refuses to say it otherwise.
 *   render   whatever the page last reported from the host's progress ledger (state, blocks,
 *            audioSeconds, synthSeconds, rtf, eta, queue position) — copied, labelled `host`.
 *   net      resource timing for /audio and /docsplayer fetches: requests, bytes over the wire,
 *            cache hits (a transferSize of 0 with a decoded body is the browser's own cache).
 *
 * Prototype lane (.js, zero-dep, UMD). Nothing leaves the browser; nothing is stored.
 *
 *   DVListenDiag.start();                       // begins the frame sampler + resource observer
 *   DVListenDiag.attachAudio(audioElement);     // one or more; the active one is whichever plays
 *   DVListenDiag.note('render', ledgerRow);     // the page copies the host's progress in
 *   DVListenDiag.watchSynth();                  // patches speechSynthesis.speak to time utterances
 *   DVListenDiag.snapshot();                    // the whole picture, for a gloss panel
 */
(function (global) {
  'use strict';

  var FRAMES = 120;
  var samples = [];            // rAF overshoot, ms
  var lastFrame = 0, rafId = 0, running = false, fps = 0, fpsCount = 0, fpsAt = 0;
  var audios = [];
  var stalls = 0;
  var render = null, renderAt = 0;
  var synth = { active: false, utterances: 0, boundaries: 0, chars: 0, words: 0, speakAt: 0,
                startAt: 0, firstLatencyMs: null, lastLatencyMs: null, spokenMs: 0, voiceName: null,
                onDevice: null, lang: null, patched: false };
  var net = { requests: 0, bytes: 0, cacheHits: 0, lastMs: null, lastUrl: null };
  var events = [];             // a short ring of what happened, newest last
  var EVENTS_MAX = 24;
  var actx = null;

  function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }
  function push(kind, text) {
    events.push({ at: Date.now(), kind: kind, text: text });
    while (events.length > EVENTS_MAX) events.shift();
  }

  // ── the frame sampler: main-thread jitter, honestly ─────────────────────
  function frame(t) {
    rafId = 0;
    if (!running) return;
    if (lastFrame) {
      var dt = t - lastFrame;
      // 16.67 ms is the ideal at 60 Hz; anything over that is the main thread being busy. A 120 Hz
      // display shows ~8.3 ms frames, so overshoot is measured against the smaller of the two the
      // device has actually been producing rather than a constant.
      var ideal = Math.min(16.67, dt);
      samples.push(Math.max(0, dt - ideal));
      while (samples.length > FRAMES) samples.shift();
      fpsCount++;
      if (t - fpsAt >= 1000) { fps = Math.round(fpsCount * 1000 / (t - fpsAt)); fpsCount = 0; fpsAt = t; }
    } else { fpsAt = t; }
    lastFrame = t;
    rafId = global.requestAnimationFrame(frame);
  }
  function p95() {
    if (!samples.length) return null;
    var s = samples.slice().sort(function (a, b) { return a - b; });
    return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] * 10) / 10;
  }
  function start() {
    if (running) return;
    running = true; lastFrame = 0;
    if (global.requestAnimationFrame) rafId = global.requestAnimationFrame(frame);
    observeNet();
    global.document.addEventListener('visibilitychange', function () {
      // a hidden tab throttles rAF to nothing: those gaps are the browser, not the CPU
      if (global.document.hidden) { lastFrame = 0; samples.length = 0; }
    });
  }
  function stop() { running = false; if (rafId) { global.cancelAnimationFrame(rafId); rafId = 0; } }

  // ── the element ──────────────────────────────────────────────────────────
  function attachAudio(el) {
    if (!el || audios.indexOf(el) >= 0) return;
    audios.push(el);
    el.addEventListener('waiting', function () { stalls++; push('audio', 'stalled — waiting for data'); });
    el.addEventListener('stalled', function () { stalls++; push('audio', 'stalled — the network stopped'); });
  }
  function attachContext(ctx) { actx = ctx || actx; }
  function active() {
    for (var i = 0; i < audios.length; i++) if (audios[i].src && !audios[i].paused) return audios[i];
    for (var j = 0; j < audios.length; j++) if (audios[j].src) return audios[j];
    return audios[0] || null;
  }
  function bufferedAhead(el) {
    try {
      var t = el.currentTime || 0, b = el.buffered;
      for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 0.05 && b.end(i) >= t) return Math.max(0, b.end(i) - t);
    } catch (e) {}
    return 0;
  }

  // ── the synthesiser: timed, and told apart from a network voice ─────────
  function watchSynth() {
    var ss = global.speechSynthesis;
    if (!ss || synth.patched || typeof ss.speak !== 'function') return;
    synth.patched = true;
    var speak = ss.speak.bind(ss);
    ss.speak = function (u) {
      try {
        var text = String(u && u.text || '');
        synth.utterances++; synth.chars += text.length; synth.words += (text.match(/\S+/g) || []).length;
        synth.speakAt = now(); synth.active = true;
        if (u && u.voice) { synth.voiceName = u.voice.name || null; synth.onDevice = !!u.voice.localService; synth.lang = u.voice.lang || null; }
        u.addEventListener('start', function () {
          synth.startAt = now();
          var l = Math.round(synth.startAt - synth.speakAt);
          if (synth.firstLatencyMs == null) synth.firstLatencyMs = l;
          synth.lastLatencyMs = l;
        });
        u.addEventListener('boundary', function () { synth.boundaries++; });
        var done = function () { if (synth.startAt) synth.spokenMs += now() - synth.startAt; synth.startAt = 0; synth.active = false; };
        u.addEventListener('end', done); u.addEventListener('error', done);
      } catch (e) {}
      return speak(u);
    };
  }

  // ── the wire ────────────────────────────────────────────────────────────
  var observed = false;
  function observeNet() {
    if (observed || !global.PerformanceObserver) return;
    observed = true;
    try {
      var po = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          if (!/\/(audio|docsplayer)\//.test(e.name)) return;
          net.requests++;
          var wire = e.transferSize || 0, body = e.decodedBodySize || e.encodedBodySize || 0;
          if (!wire && body) net.cacheHits++;
          net.bytes += wire;
          net.lastMs = Math.round(e.duration); net.lastUrl = e.name;
        });
      });
      po.observe({ type: 'resource', buffered: true });
    } catch (e) { observed = false; }
  }

  // ── what the page tells us ──────────────────────────────────────────────
  function note(kind, data) {
    if (kind === 'render') { render = data || null; renderAt = Date.now(); if (data && data.state) push('render', (data.voiceName || data.voice || '') + ' · ' + data.state + (data.blocksTotal ? ' · ' + (data.blocksDone || 0) + '/' + data.blocksTotal : '')); return; }
    if (kind === 'event') { push(data && data.kind || 'note', data && data.text || ''); return; }
    push(kind, typeof data === 'string' ? data : JSON.stringify(data || {}));
  }

  function snapshot() {
    var nav = global.navigator || {};
    var mem = global.performance && performance.memory ? performance.memory : null;
    var el = active();
    var spokenS = (synth.spokenMs + (synth.active && synth.startAt ? now() - synth.startAt : 0)) / 1000;
    return {
      at: Date.now(),
      client: {
        cores: nav.hardwareConcurrency || null,
        deviceMemoryGB: (typeof nav.deviceMemory === 'number') ? nav.deviceMemory : null,
        heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
        heapLimitMB: mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : null,
        jitterP95Ms: p95(),
        fps: fps || null,
        frames: samples.length,
        visible: !global.document.hidden,
        reducedMotion: (function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })()
      },
      audio: el ? {
        src: !!el.src, playing: !el.paused && !el.ended, time: el.currentTime || 0,
        duration: isFinite(el.duration) ? el.duration : 0, bufferedAheadS: Math.round(bufferedAhead(el) * 10) / 10,
        readyState: el.readyState, rate: el.playbackRate, stalls: stalls,
        latencyMs: actx ? Math.round(((actx.outputLatency || 0) + (actx.baseLatency || 0)) * 1000) : null,
        sampleRate: actx ? actx.sampleRate : null
      } : null,
      synth: {
        supported: !!(global.speechSynthesis && global.SpeechSynthesisUtterance),
        active: synth.active, utterances: synth.utterances, boundaries: synth.boundaries,
        voiceName: synth.voiceName, onDevice: synth.onDevice, lang: synth.lang,
        firstLatencyMs: synth.firstLatencyMs, lastLatencyMs: synth.lastLatencyMs,
        charsPerSec: spokenS > 0.5 ? Math.round(synth.chars / spokenS * 10) / 10 : null,
        wordsPerMin: spokenS > 0.5 ? Math.round(synth.words / spokenS * 60) : null,
        spokenS: Math.round(spokenS)
      },
      render: render ? Object.assign({ ageS: Math.round((Date.now() - renderAt) / 1000), origin: 'host' }, render) : null,
      net: { requests: net.requests, bytes: net.bytes, cacheHits: net.cacheHits, lastMs: net.lastMs },
      events: events.slice()
    };
  }

  var DV = { start: start, stop: stop, attachAudio: attachAudio, attachContext: attachContext, watchSynth: watchSynth,
             note: note, snapshot: snapshot, events: function () { return events.slice(); }, version: '1.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = DV;
  global.DVListenDiag = DV;
})(typeof window !== 'undefined' ? window : this);
