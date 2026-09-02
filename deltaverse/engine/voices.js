/*!
 * DeltaVerse nGn — voices (DVVoices: neural is the reference, and the reference is not edited).
 *
 * THE RULE. **neural** is the default voice and it is IMMUTABLE. It is not a preference you may tune;
 * it is the reference the others are measured against. Every other voice in the realm is DERIVED from
 * it — seeded with neural's own prosody and then given a stated delta — so if voice editing is wanted,
 * what is edited is a derivation, never the reference. `DVVoices.get('neural')` returns a frozen record
 * and `DVVoices.edit('neural', …)` refuses. That is deliberate: a reader who has heard the realm speak
 * once should hear the same voice next time, on every page, whatever anyone has been experimenting with.
 *
 * WHAT A VOICE IS HERE. Not an audio file and not a model — the browser owns the synthesis
 * (speechSynthesis, on-device where the platform has it). A DeltaVerse voice is three things:
 *
 *   1. a SELECTION RULE   — an ordered list of patterns over the platform's own voices, first match
 *                           wins, so the best voice actually present is used rather than a name that
 *                           may not exist. neural prefers the genuinely neural ones (Natural, Neural,
 *                           Premium, Enhanced, WaveNet, Siri) and falls back gracefully to anything.
 *   2. a PROSODY          — rate, pitch, volume. neural's is the reference; a derived voice states its
 *                           delta from it (a ratio such as ×1.08 rate) rather than an absolute, so
 *                           improving neural improves everything derived from it, which is the point.
 *   3. a CHARACTER        — who is speaking, in one line, shown in the reader.
 *
 * THE SAVED VOICES — each its own record, neither a ratio on the other
 *   neural       the realm's own voice. The reference, and the DEFAULT.
 *   jaimla       the machine-learning agent of the realm. THE FEMALE VOICE, and female by
 *                SELECTION rather than by multiplier — see the JAIMLA record for why a ratio
 *                cannot do this. She considers before she answers; she is in the realm, not
 *                narrating it.
 *
 * THE DERIVED VOICES — a stated delta on a saved voice
 *   overlord     the register the realm uses about itself: unhurried, low, certain.
 *   ovie         the ollywoo director — quicker and brighter; it is watching, and it is keen.
 *   participant  you, read back to yourself: neutral, local, unremarkable on purpose.
 *
 * Editing: `DVVoices.edit('ovie', { rate: 0.9 })` adjusts a DERIVED voice and persists it;
 * `DVVoices.reset('ovie')` returns it to its seed; `DVVoices.derive('mine', { from:'jaimla', … })`
 * makes a new one from either saved voice. A derived voice can always say what it derives FROM.
 * Editing a SAVED voice is refused, with the derivation to make instead.
 *
 * Prototype lane (.js, zero-dep, UMD). No network, no model download, nothing leaves the browser.
 *
 *   DVVoices.ready().then(function(){ var v = DVVoices.speak('hello', { voice:'jaimla' }); });
 */
(function (global) {
  'use strict';

  var KEY = 'dv_voices_v1';
  var synth = global.speechSynthesis || null;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ── the reference ──────────────────────────────────────────────────────
  // Everything else in this file is a delta from this record. It is frozen.
  var NEURAL = Object.freeze({
    id: 'neural',
    name: 'Neural',
    character: 'the realm’s own voice — the reference every other voice is derived from',
    immutable: true,
    lang: 'en',
    // ordered: the first pattern with a match on this platform wins
    prefer: [
      /natural/i, /neural/i, /premium/i, /enhanced/i, /wavenet/i,
      /siri/i, /^google (uk|us) english/i, /google/i, /microsoft/i
    ],
    prosody: Object.freeze({ rate: 0.98, pitch: 1.0, volume: 1.0 })
  });

  // ── the second saved voice ─────────────────────────────────────────────
  // JAIMLA IS NOT A DERIVATION, AND SHE CANNOT BE ONE.
  //
  // She used to be `delta: { rate: 0.94, pitch: 0.92 }` on neural, with a
  // selection rule that asked the platform for `daniel` and `male`. That is a
  // male voice slowed down and pitched down, saved under a female name — and a
  // ratio cannot fix it, because pitch is not gender. Lowering a male voice
  // drags its formants down with it and produces a larger man; RAISING one
  // produces a man speaking falsetto. The thing that carries gender is the
  // voice the platform hands over, and that is a SELECTION, not a multiplier.
  //
  // So Jaimla is saved the way neural is saved: her own record, her own
  // selection rule, her own prosody, answering to nobody's ratio. neural stays
  // the default and stays the reference the DERIVED voices are measured
  // against; Jaimla is simply the other voice the realm keeps.
  //
  // The rendered store agrees, and was measured: mindX's own JAIMLA is
  // en_GB-jenny_dioco-medium at f0 183.8 Hz against neural's alan at 94.6 Hz,
  // and the bar mindX set for itself is every male below 150 and every female
  // above 180. The old x0.92-on-alan rendering sat at about 87.
  var JAIMLA = Object.freeze({
    id: 'jaimla',
    name: 'Jaimla',
    character: 'the machine-learning agent of the realm — she considers before she answers',
    immutable: true,
    saved: true,
    lang: 'en',
    gender: 'female',
    // ordered, and female FIRST: a named female voice, then any voice the
    // platform is willing to call female, and only then the neural tiers. A
    // platform with no female voice at all gets the best one it has and the
    // page says which, rather than pretending with a multiplier.
    prefer: [
      /google uk english female/i, /google us english female/i,
      /samantha/i, /serena/i, /kate/i, /libby/i, /aria/i, /jenny/i, /zira/i, /fiona/i,
      /female/i,
      /natural/i, /neural/i, /premium/i, /enhanced/i
    ],
    // Unhurried, not slow. mindX renders her at 168 wpm against a 175 nominal,
    // and this is the same relation: softness here is taking her time, not
    // dragging. Pitch is 1.0 because the VOICE is female — there is nothing
    // left to fake, and multiplying a female voice up only makes it shrill.
    prosody: Object.freeze({ rate: 0.94, pitch: 1.0, volume: 1.0 })
  });

  var SAVED = { neural: NEURAL, jaimla: JAIMLA };

  // ── the derivations, each stating its delta from the reference ─────────
  var DERIVED = {
    overlord: {
      id: 'overlord', name: 'OVERLORD', from: 'neural',
      character: 'the register the realm uses about itself — unhurried, low, certain. ' +
                 'LEADER\u2019s mass and ANCIENT\u2019s refusal to raise a syllable.',
      // The RENDERED overlord is no longer a ratio on the reference at all: it is its
      // own voice (en-earth+overlord) with a measured octave under it — see
      // render/render_overlord.py. A browser cannot do any of that, so this delta is
      // an APPROXIMATION of it and is labelled as one: as low and as slow as a
      // speechSynthesis voice will go without turning to gravel.
      delta: { rate: 0.84, pitch: 0.78 },
      approximates: 'en-earth+overlord, layered — the rendered file is the real one',
      prefer: [/natural/i, /neural/i, /premium/i, /male/i]
    },
    ovie: {
      id: 'ovie', name: 'Ovie', from: 'neural',
      character: 'the ollywoo director — quicker and brighter; it is watching, and it is keen',
      delta: { rate: 1.08, pitch: 1.08 },
      prefer: [/natural/i, /neural/i, /female/i, /samantha/i, /zira/i]
    },
    participant: {
      id: 'participant', name: 'Participant', from: 'neural',
      character: 'you, read back to yourself — neutral, local, unremarkable on purpose',
      delta: { rate: 1.0, pitch: 1.0 },
      local: true, prefer: [/./]
    }
  };

  var edits = {};                       // derived id → { rate?, pitch?, volume? }, persisted
  try { edits = JSON.parse(global.localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
  function persist() { try { global.localStorage.setItem(KEY, JSON.stringify(edits)); } catch (e) {} }

  // ── the platform's own voices ──────────────────────────────────────────
  var platform = [];
  function loadPlatform() { platform = (synth && synth.getVoices && synth.getVoices()) || []; return platform; }
  // COUNTING TICKS IS NOT MEASURING TIME, AND IN A BACKGROUND TAB IT IS NOT CLOSE.
  //
  // This used to give up after 20 ticks of a 100 ms interval and call that "2
  // seconds". It is 2 seconds only in a focused tab. Chrome throttles timers in a
  // HIDDEN tab to roughly 1 Hz, and in a fully backgrounded one to once a minute —
  // measured on this page while hidden: a 100 ms interval ticked every 947 ms, so
  // the 2-second budget became 20, and could become 21 minutes. Every caller puts
  // its whole bootstrap inside ready().then(...), so the page rendered NOTHING for
  // that entire time: no voice rows, no LISTEN button, nothing to click. Opening
  // the page in a background tab — a middle-click, a restored session — was enough.
  //
  // So the deadline is now WALL CLOCK. Throttling can delay when we notice the
  // deadline has passed, but it can no longer multiply the deadline itself, and the
  // fallback timeout is a single setTimeout for the whole budget rather than a
  // count of ticks that each have to arrive.
  //
  // It is also memoised. ready() was starting a fresh interval for every caller,
  // and three scripts on this page call it.
  var READY = null;
  var READY_MS = 2000;
  function ready() {
    if (READY) return READY;
    READY = new Promise(function (res) {
      if (!synth) { res([]); return; }
      if (loadPlatform().length) { res(platform); return; }
      var done = false;
      var finish = function () { if (done) return; done = true; res(loadPlatform()); };
      try { synth.addEventListener('voiceschanged', finish, { once: true }); }
      catch (e) { synth.onvoiceschanged = finish; }
      var deadline = Date.now() + READY_MS;
      setTimeout(finish, READY_MS);                       // the budget, in one timer
      var iv = setInterval(function () {                  // early exit if voices land sooner
        if (loadPlatform().length || Date.now() >= deadline) { clearInterval(iv); finish(); }
      }, 100);
    });
    return READY;
  }

  // first pattern with a match wins; a voice in the reader's own language is preferred within a tier
  function pick(spec) {
    var pool = platform.slice();
    if (!pool.length) return null;
    var lang = (global.navigator && navigator.language) || 'en-US';
    var base = String(lang).slice(0, 2).toLowerCase();
    var mine = pool.filter(function (v) { return String(v.lang || '').slice(0, 2).toLowerCase() === base; });
    var tiers = mine.length ? [mine, pool] : [pool];
    if (spec.local) tiers.unshift(pool.filter(function (v) { return v.localService; }));
    for (var t = 0; t < tiers.length; t++) {
      for (var p = 0; p < (spec.prefer || []).length; p++) {
        for (var i = 0; i < tiers[t].length; i++) {
          if (spec.prefer[p].test(tiers[t][i].name || '')) return tiers[t][i];
        }
      }
    }
    return mine[0] || pool[0] || null;
  }

  // ── resolve an id to everything a reader needs ─────────────────────────
  function get(id) {
    var sv = SAVED[id || 'neural'];
    if (sv) {
      return Object.freeze({
        id: sv.id, name: sv.name, character: sv.character, immutable: true,
        saved: true, gender: sv.gender || null,
        reference: sv.id === 'neural',
        from: null, seed: null,
        prosody: { rate: sv.prosody.rate, pitch: sv.prosody.pitch, volume: sv.prosody.volume },
        voice: pick(sv), derivedFrom: null
      });
    }
    var d = DERIVED[id];
    if (!d) return get('neural');
    var seed = (SAVED[d.from] || NEURAL).prosody;
    var base = {
      rate: clamp(seed.rate * (d.delta.rate == null ? 1 : d.delta.rate), 0.1, 4),
      pitch: clamp(seed.pitch * (d.delta.pitch == null ? 1 : d.delta.pitch), 0, 2),
      volume: clamp(seed.volume * (d.delta.volume == null ? 1 : d.delta.volume), 0, 1)
    };
    var e = edits[id] || {};
    return Object.freeze({
      id: d.id, name: d.name, character: d.character, immutable: false,
      from: d.from, seed: base,                        // what it would be with no edits
      prosody: {
        rate: clamp(e.rate == null ? base.rate : e.rate, 0.1, 4),
        pitch: clamp(e.pitch == null ? base.pitch : e.pitch, 0, 2),
        volume: clamp(e.volume == null ? base.volume : e.volume, 0, 1)
      },
      edited: !!(e.rate != null || e.pitch != null || e.volume != null),
      voice: pick(d),
      derivedFrom: (d.from || 'neural') + ' ×' + (d.delta.rate || 1).toFixed(2) + ' rate, ×' + (d.delta.pitch || 1).toFixed(2) + ' pitch'
    });
  }

  // neural first, because it is the default; then the other saved voice; then
  // the derivations, which are the only editable things here.
  function list() {
    return Object.keys(SAVED).concat(Object.keys(DERIVED)).map(get);
  }

  // ── editing: derivations only ──────────────────────────────────────────
  function edit(id, patch) {
    var sv = SAVED[id || 'neural'];
    if (sv) {
      // Not an error to ask — an error to do. Say why, and offer what IS allowed.
      return { ok: false, reason: sv.name + ' is a saved voice and is not edited. ' +
        'Derive from it instead: DVVoices.derive("mine", { from:"' + sv.id + '", delta:{ rate:0.95 } })' };
    }
    if (!DERIVED[id]) return { ok: false, reason: 'no such voice: ' + id };
    var e = edits[id] || (edits[id] = {});
    if (patch.rate != null) e.rate = clamp(+patch.rate, 0.1, 4);
    if (patch.pitch != null) e.pitch = clamp(+patch.pitch, 0, 2);
    if (patch.volume != null) e.volume = clamp(+patch.volume, 0, 1);
    persist();
    return { ok: true, voice: get(id) };
  }
  function reset(id) {
    if (id) delete edits[id]; else edits = {};
    persist();
    return id ? get(id) : list();
  }
  // a new voice, seeded from the reference — the sanctioned way to have a voice of your own
  function derive(id, spec) {
    spec = spec || {};
    if (!id || SAVED[id] || DERIVED[id]) return { ok: false, reason: 'pick an unused id' };
    var from = SAVED[spec.from] ? spec.from : 'neural';
    DERIVED[id] = {
      id: id, name: spec.name || id, from: from,
      character: spec.character || ('derived from ' + from),
      delta: spec.delta || {}, prefer: spec.prefer || SAVED[from].prefer, local: !!spec.local
    };
    return { ok: true, voice: get(id) };
  }

  // ── speaking ───────────────────────────────────────────────────────────
  function utter(text, opts) {
    opts = opts || {};
    var v = get(opts.voice || 'neural');
    var u = new global.SpeechSynthesisUtterance(String(text || ''));
    if (v.voice) { u.voice = v.voice; u.lang = v.voice.lang; }
    u.rate = clamp(v.prosody.rate * (opts.rate || 1), 0.1, 4);
    u.pitch = clamp(v.prosody.pitch * (opts.pitch || 1), 0, 2);
    u.volume = clamp(v.prosody.volume * (opts.volume == null ? 1 : opts.volume), 0, 1);
    return u;
  }
  function speak(text, opts) {
    if (!synth) return null;
    var u = utter(text, opts);
    synth.speak(u);
    return u;
  }
  function cancel() { try { synth && synth.cancel(); } catch (e) {} }

  // `speechSynthesis` existing is NOT the same as speech being possible. Headless Linux, a Linux
  // desktop without speech-dispatcher, and some Android WebViews all expose the API and enumerate zero
  // voices — every utterance is then silently dropped. Anything offering a LISTEN button must ask
  // `usable()` after `ready()`, not `supported`, or it offers a button that cannot listen.
  function usable() { return !!synth && platform.length > 0; }

  var DV = {
    NEURAL: NEURAL, ready: ready, get: get, list: list, usable: usable,
    edit: edit, reset: reset, derive: derive,
    utter: utter, speak: speak, cancel: cancel,
    platform: function () { return platform.slice(); },
    supported: !!synth,
    version: '1.0.0'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DV;
  global.DVVoices = DV;
})(typeof window !== 'undefined' ? window : this);
