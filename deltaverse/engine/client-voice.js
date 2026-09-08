/*!
 * DeltaVerse nGn — client-voice (DVClientVoice: the ANCIENT lane — a document read by the device itself).
 *
 * WHAT IT IS. The render host makes a file once and serves it forever; that is the right default and
 * it is the expensive one. This is the other lane: the browser's own synthesiser reads the same blocks,
 * on the CPU and RAM of the machine in front of the reader, with nothing sent anywhere. It starts in
 * under a second, it costs the host nothing, and it gives back no file — which is why it is a lane and
 * not a replacement.
 *
 * IT IS CALLED ANCIENT ON PURPOSE. speechSynthesis is the 1990s tier: a formant or concatenative voice
 * on most platforms, a neural one on a few. The name is a promise about cost, not about quality — and
 * the diagnostics (listen-diag.js) say whether the platform voice is on-device or a network voice,
 * because "runs on your CPU" is a claim this module will not make on a voice that phones home.
 *
 * WHAT IT SHARES WITH THE FILE LANE. The same blocks (the page hands them in, node + text), the same
 * lighting (class `lit` on the block, a `word` span on the word being said, from boundary events), and
 * the same transport verbs — play, pause, stop, step, seek to a block — so a deck built for the file
 * lane drives this one without knowing which it has.
 *
 * Prototype lane (.js, zero-dep, UMD). Needs DVVoices for the voice records; degrades to `usable:false`
 * where speechSynthesis is absent or has no voices, and says so rather than pretending.
 *
 *   var cv = DVClientVoice.create({
 *     blocks: function () { return nodes; },           // [{node, text, tag}], the page's own list
 *     voice: 'ancient', rate: 1,
 *     onState: function (s) { … }                      // called on every change; s = cv.state()
 *   });
 *   cv.play(); cv.pause(); cv.stop(); cv.step(1); cv.seekBlock(7); cv.setRate(1.2); cv.setVoice('neural');
 */
(function (global) {
  'use strict';

  var synth = global.speechSynthesis || null;

  function sentences(text) {
    if (global.DVDocReader && DVDocReader.sentences) return DVDocReader.sentences(text);
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    var out = t.match(/[^.!?]+[.!?]+["'”’)\]]*|[^.!?]+$/g) || [t];
    return out.map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function usable() {
    try { return !!(synth && global.SpeechSynthesisUtterance && global.DVVoices && DVVoices.usable && DVVoices.usable()); }
    catch (e) { return false; }
  }

  // The word being said: a span around the k-th word of the block, exactly as playdocs marks it, so the
  // page's own CSS lights it. Restored to plain text when the word moves on.
  function markWord(node, k, held) {
    unmarkWord(held);
    if (!node || k < 0) return held;
    try {
      var walker = global.document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null), tn, seen = 0;
      while ((tn = walker.nextNode())) {
        var re = /\S+/g, m;
        while ((m = re.exec(tn.nodeValue))) {
          if (seen === k) {
            var rng = global.document.createRange(); rng.setStart(tn, m.index); rng.setEnd(tn, m.index + m[0].length);
            var sp = global.document.createElement('span'); sp.className = 'word'; rng.surroundContents(sp);
            held.span = sp; held.k = k; return held;
          }
          seen++;
        }
      }
    } catch (e) {}
    return held;
  }
  function unmarkWord(held) {
    if (!held.span) return;
    try { var par = held.span.parentNode; if (par) { while (held.span.firstChild) par.insertBefore(held.span.firstChild, held.span); par.removeChild(held.span); par.normalize(); } } catch (e) {}
    held.span = null; held.k = -1;
  }
  function wordIndexAt(block, si, charIndex) {
    // the utterance is one sentence; count the words of the sentences before it, then the words up to charIndex
    var before = 0;
    for (var i = 0; i < si; i++) before += (block.sents[i].match(/\S+/g) || []).length;
    var upto = (block.sents[si].slice(0, charIndex).match(/\S+/g) || []).length;
    return before + upto;
  }

  function create(opts) {
    opts = opts || {};
    var voiceId = opts.voice || 'ancient', rate = +opts.rate || 1;
    var playing = false, paused = false, bi = 0, si = 0, cur = null, seq = 0;
    var lit = null, held = { span: null, k: -1 };
    var list = [];               // [{node, text, sents}]
    var guard = 0;

    function refresh() {
      var src = (typeof opts.blocks === 'function' ? opts.blocks() : opts.blocks) || [];
      list = src.map(function (b) { return { node: b.node, text: b.text, tag: b.tag, sents: sentences(b.text) }; });
    }
    function emit() { if (typeof opts.onState === 'function') { try { opts.onState(state()); } catch (e) {} } }
    function light(i) {
      unlight();
      var b = list[i]; if (!b || !b.node) return;
      lit = b.node; lit.classList.add('lit');
      if (opts.follow !== false) { try { lit.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
      if (typeof opts.onBlock === 'function') { try { opts.onBlock(i); } catch (e) {} }
    }
    function unlight() { unmarkWord(held); if (lit) lit.classList.remove('lit'); lit = null; }

    // Chrome stops a long-running synthesis after ~15 s of one utterance and stalls silently on some
    // platforms; a pause/resume tick every 9 s is the documented workaround and it is harmless elsewhere.
    function guardOn() { guardOff(); guard = setInterval(function () { if (!playing || paused) return; try { if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); } } catch (e) {} }, 9000); }
    function guardOff() { if (guard) { clearInterval(guard); guard = 0; } }

    function say() {
      if (!playing || paused) return;
      var b = list[bi];
      if (!b) { finish(); return; }
      if (si >= b.sents.length) { si = 0; bi++; if (bi >= list.length) { finish(); return; } b = list[bi]; }
      if (si === 0) light(bi);
      var text = b.sents[si], my = ++seq;
      var u;
      try { u = DVVoices.utter(text, { voice: voiceId, rate: rate }); }
      catch (e) { u = new global.SpeechSynthesisUtterance(text); u.rate = rate; }
      cur = u;
      u.onboundary = function (e) {
        if (my !== seq) return;
        if (e.name && e.name !== 'word') return;
        held = markWord(b.node, wordIndexAt(b, si, e.charIndex || 0), held);
      };
      u.onend = function () { if (my !== seq || cur !== u) return; unmarkWord(held); si++; say(); emit(); };
      u.onerror = function (e) {
        if (my !== seq || cur !== u) return;
        // 'interrupted' and 'canceled' are us; anything else is the platform refusing this sentence
        if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
        unmarkWord(held); si++; say(); emit();
      };
      try { synth.speak(u); } catch (e) { finish(); }
      emit();
    }
    function cancel() { seq++; cur = null; try { synth.cancel(); } catch (e) {} }
    function finish() { cancel(); playing = false; paused = false; guardOff(); unlight(); bi = 0; si = 0; emit(); if (typeof opts.onEnd === 'function') { try { opts.onEnd(); } catch (e) {} } }

    function play(fromBlock) {
      if (!usable()) { emit(); return false; }
      refresh();
      if (!list.length) return false;
      if (playing && paused) { paused = false; try { synth.resume(); } catch (e) {} guardOn(); emit(); return true; }
      if (playing) return true;
      if (typeof fromBlock === 'number') { bi = Math.max(0, Math.min(list.length - 1, fromBlock)); si = 0; }
      playing = true; paused = false;
      cancel(); guardOn(); say();
      return true;
    }
    function pause() {
      if (!playing || paused) return;
      paused = true; guardOff();
      try { synth.pause(); } catch (e) {}
      emit();
    }
    function stop() { finish(); }
    function toggle() { if (playing && !paused) pause(); else play(); }
    function seekBlock(i) {
      refresh();
      if (i < 0 || i >= list.length) return;
      var was = playing && !paused;
      cancel(); unlight(); bi = i; si = 0;
      if (was) { playing = true; say(); } else { playing = false; paused = false; light(i); }
      emit();
    }
    function step(d) { seekBlock(Math.max(0, Math.min(list.length - 1, (playing ? bi : Math.max(0, bi)) + (d || 1)))); }
    function setRate(r) { rate = Math.max(0.5, Math.min(2.5, +r || 1)); if (playing && !paused) { cancel(); say(); } emit(); }
    function setVoice(id) { voiceId = id || 'ancient'; if (playing && !paused) { cancel(); say(); } emit(); }
    function state() {
      var v = null;
      try { v = global.DVVoices ? DVVoices.get(voiceId) : null; } catch (e) {}
      var pv = v && v.voice;
      return {
        lane: 'client', usable: usable(), playing: playing && !paused, paused: paused,
        block: playing ? bi : -1, blocks: list.length, sentence: si, rate: rate, voice: voiceId,
        voiceName: v ? v.name : voiceId,
        platformVoice: pv ? pv.name : null, onDevice: pv ? !!pv.localService : null, lang: pv ? pv.lang : null
      };
    }
    // a hidden tab pauses the synthesiser on most platforms anyway; pausing explicitly keeps our state true
    global.document.addEventListener('visibilitychange', function () { if (global.document.hidden && playing && !paused) pause(); });

    return { play: play, pause: pause, stop: stop, toggle: toggle, seekBlock: seekBlock, step: step,
             setRate: setRate, setVoice: setVoice, state: state, refresh: refresh, usable: usable };
  }

  var DV = { create: create, usable: usable, sentences: sentences, version: '1.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = DV;
  global.DVClientVoice = DV;
})(typeof window !== 'undefined' ? window : this);
