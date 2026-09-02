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
 *                           delta from it (×0.94 rate, −0.08 pitch) rather than an absolute, so
 *                           improving neural improves everything derived from it, which is the point.
 *   3. a CHARACTER        — who is speaking, in one line, shown in the reader.
 *
 * THE DERIVED VOICES
 *   neural       the realm's own voice. The reference. Immutable, and the default.
 *   jaimla       the machine-learning agent — slower and a shade lower, because it considers before it
 *                answers. Jaimla is an agent of the realm, not a narrator of it.
 *   overlord     the register the realm uses about itself: unhurried, low, certain.
 *   ovie         the ollywoo director — quicker and brighter; it is watching, and it is keen.
 *   participant  you, read back to yourself: neutral, local, unremarkable on purpose.
 *
 * Editing: `DVVoices.edit('jaimla', { rate: 0.9 })` adjusts a DERIVED voice and persists it;
 * `DVVoices.reset('jaimla')` returns it to its seed; `DVVoices.derive('mine', { from:'neural', … })`
 * makes a new one. Every derived voice can always say what it is a derivation OF.
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

  // ── the derivations, each stating its delta from the reference ─────────
  var DERIVED = {
    jaimla: {
      id: 'jaimla', name: 'Jaimla', from: 'neural',
      character: 'the machine-learning agent — it considers before it answers',
      delta: { rate: 0.94, pitch: 0.92 },
      prefer: [/neural/i, /natural/i, /google uk english male/i, /daniel/i, /male/i]
    },
    overlord: {
      id: 'overlord', name: 'OVERLORD', from: 'neural',
      character: 'the register the realm uses about itself — unhurried, low, certain',
      delta: { rate: 0.86, pitch: 0.84 },
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
  function ready() {
    return new Promise(function (res) {
      if (!synth) { res([]); return; }
      if (loadPlatform().length) { res(platform); return; }
      var done = false, n = 0;
      var finish = function () { if (done) return; done = true; res(loadPlatform()); };
      try { synth.addEventListener('voiceschanged', finish, { once: true }); } catch (e) { synth.onvoiceschanged = finish; }
      var iv = setInterval(function () { if (loadPlatform().length || ++n > 20) { clearInterval(iv); finish(); } }, 100);
    });
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
    if (!id || id === 'neural') {
      return Object.freeze({
        id: 'neural', name: NEURAL.name, character: NEURAL.character, immutable: true,
        from: null, seed: null,
        prosody: { rate: NEURAL.prosody.rate, pitch: NEURAL.prosody.pitch, volume: NEURAL.prosody.volume },
        voice: pick(NEURAL), derivedFrom: null
      });
    }
    var d = DERIVED[id];
    if (!d) return get('neural');
    var seed = NEURAL.prosody;
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
      derivedFrom: 'neural ×' + (d.delta.rate || 1).toFixed(2) + ' rate, ×' + (d.delta.pitch || 1).toFixed(2) + ' pitch'
    });
  }

  function list() {
    return ['neural'].concat(Object.keys(DERIVED)).map(get);
  }

  // ── editing: derivations only ──────────────────────────────────────────
  function edit(id, patch) {
    if (!id || id === 'neural') {
      // Not an error to ask — an error to do. Say why, and offer the thing that IS allowed.
      return { ok: false, reason: 'neural is the reference and is not edited. Derive from it instead: ' +
        'DVVoices.derive("mine", { from:"neural", delta:{ rate:0.95 } })' };
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
    if (!id || id === 'neural' || DERIVED[id]) return { ok: false, reason: 'pick an unused id' };
    DERIVED[id] = {
      id: id, name: spec.name || id, from: spec.from || 'neural',
      character: spec.character || 'derived from neural',
      delta: spec.delta || {}, prefer: spec.prefer || NEURAL.prefer, local: !!spec.local
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
