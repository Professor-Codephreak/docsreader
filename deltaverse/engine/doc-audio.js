/*!
 * DeltaVerse nGn — doc.audio (DVDocAudio: rendered audio, kept).
 *
 * THE PROBLEM. A LISTEN that re-synthesises the document on every press spends the same work twice,
 * every time, forever — and the browser's own synthesiser gives back no file at all: speechSynthesis
 * exposes no audio stream, so there is nothing to keep, nothing to seek and nothing to download. It is
 * the right default (it needs no server and works from IPFS) but it is not a player.
 *
 * SO THE AUDIO IS RENDERED AHEAD, ONCE, AND KEPT. scripts/render-listen.mjs renders each document with
 * espeak-ng and encodes with opusenc, writing immutable parts and a manifest to /audio/<doc>/<voice>/.
 * This module is the layer in front of that store, and it keeps them TWICE:
 *
 *   the host    /audio/<doc>/<voice>/part-NN.opus   immutable, served with a long max-age
 *   the browser IndexedDB, keyed by url             so a returning reader fetches nothing at all
 *
 * WHAT EACH MODE CAN DO — the player says which one it is in, because they are not the same thing:
 *
 *   live synthesis   marks the current WORD (boundary events), starts instantly, no file, no seeking
 *   rendered audio   seeks, scrubs, downloads, survives a reload — but a file has no word boundaries,
 *                    so it lights the block and not the word
 *
 * Neither is strictly better. The player prefers rendered audio when a manifest exists, because seeking
 * and downloading is what someone who pressed LISTEN twice actually wants, and falls back to live
 * synthesis when it does not — which is always, on a document nobody has rendered yet.
 *
 * THE CACHE IS BOUNDED AND HONEST. A cap (64 MB by default), least-recently-used eviction, and
 * `stats()` so the player can show what is being held. `clear()` empties it. Nothing here is user
 * data — it is the site's own pages, read aloud — and it never leaves the browser it was cached in.
 *
 * Prototype lane (.js, zero-dep, UMD). Degrades to "no store" wherever IndexedDB is absent or blocked
 * (private windows, storage disabled): every method still resolves, it simply fetches each time.
 *
 *   var m = await DVDocAudio.manifest('voices', 'neural');   // null when nothing is rendered
 *   if (m) audio.src = await DVDocAudio.objectUrl(m.parts[0].url);
 */
(function (global) {
  'use strict';

  var DB = 'dv-doc-audio', STORE = 'parts', VER = 1;
  var CAP = 64 * 1024 * 1024;                      // bytes held in the browser, before eviction

  // WHERE THE STORE IS. Same-origin `/audio` is right for every DeltaVerse page
  // and wrong for the only reader that does not run on DeltaVerse: wordpress.reader
  // lives on the publisher's own site, where `/audio` is the publisher's `/audio`
  // and there is nothing in it. An absolute root is set once, before this loads.
  // Cross-origin reads work because the store answers with an
  // Access-Control-Allow-Origin for named pythai.net surfaces; a host that is not
  // named simply gets no manifest, and the reader falls back to live synthesis,
  // which is the same thing that happens for a document nobody has rendered.
  var ROOT = (typeof global.DV_AUDIO_ROOT === 'string' && global.DV_AUDIO_ROOT)
    ? String(global.DV_AUDIO_ROOT).replace(/\/+$/, '')
    : '/audio';
  var mem = {};                                    // manifest memo, per (doc, voice)
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      var idb = global.indexedDB;
      if (!idb) { res(null); return; }             // no store: every method still works, uncached
      var rq;
      try { rq = idb.open(DB, VER); } catch (e) { res(null); return; }
      rq.onupgradeneeded = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains(STORE)) {
          var s = d.createObjectStore(STORE, { keyPath: 'url' });
          s.createIndex('used', 'used');           // for least-recently-used eviction
        }
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { res(null); };
      rq.onblocked = function () { res(null); };
    });
    return dbp;
  }

  function tx(mode) {
    return open().then(function (d) {
      if (!d) return null;
      try { return d.transaction(STORE, mode).objectStore(STORE); } catch (e) { return null; }
    });
  }
  function req(r) {
    return new Promise(function (res, rej) {
      if (!r) { res(null); return; }
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }

  // ── the manifest ───────────────────────────────────────────────────────
  // Absent is the normal case, not an error: most documents have never been rendered. A 404 here means
  // "use live synthesis", and it must not look like a failure in the console.
  function manifest(docId, voiceId) {
    var key = docId + '/' + voiceId;
    if (mem[key] !== undefined) return Promise.resolve(mem[key]);
    var base = ROOT + '/' + encodeURIComponent(docId) + '/' + encodeURIComponent(voiceId);
    // THE MANIFEST IS NOT IMMUTABLE. The parts are written under fixed names
    // (part-01.opus) and the manifest is rewritten on every render, so
    // `force-cache` — which serves a cached entry regardless of freshness and
    // only touches the network when there is none — pinned every returning
    // reader to the FIRST render they ever saw. Re-rendering this document's
    // neural voice from espeak-ng to piper changed nothing in a browser that had
    // been here before; it kept playing the old voice and reporting the old
    // duration. `no-cache` still uses the cache, it just revalidates first, so
    // the usual answer is a 304 and the cost is one conditional request.
    return fetch(base + '/manifest.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (m) {
        if (m && m.parts) {
          // Version the PART urls from the manifest itself, so a re-render is a
          // different resource rather than the same name with different bytes.
          // Without this the audio stays cached even once the manifest updates —
          // and the two then disagree, which is worse than either being stale.
          var v = String(m.generated || m.bytes || '').replace(/[^0-9A-Za-z]/g, '').slice(-14);
          m.parts.forEach(function (p) {
            p.url = base + '/' + p.file + (v ? ('?v=' + v) : '');
          });
        }
        mem[key] = m || null;
        return mem[key];
      });
  }

  // ── the parts ──────────────────────────────────────────────────────────
  function cached(url) {
    return tx('readonly').then(function (s) { return s ? req(s.get(url)) : null; }).catch(function () { return null; });
  }
  function put(url, blob) {
    return tx('readwrite').then(function (s) {
      if (!s) return null;
      return req(s.put({ url: url, blob: blob, bytes: blob.size, used: Date.now() }));
    }).then(function () { return evict(); }).catch(function () { return null; });
  }
  function touch(url) {
    return tx('readwrite').then(function (s) {
      if (!s) return null;
      return req(s.get(url)).then(function (rec) {
        if (!rec) return null;
        rec.used = Date.now();
        return req(s.put(rec));
      });
    }).catch(function () { return null; });
  }

  function blob(url) {
    return cached(url).then(function (rec) {
      if (rec && rec.blob) { touch(url); return rec.blob; }
      return fetch(url, { cache: 'force-cache' }).then(function (r) {
        if (!r.ok) throw new Error('audio part ' + r.status);
        return r.blob();
      }).then(function (b) { put(url, b); return b; });
    });
  }

  var urls = {};
  function objectUrl(url) {
    if (urls[url]) return Promise.resolve(urls[url]);
    return blob(url).then(function (b) { urls[url] = URL.createObjectURL(b); return urls[url]; });
  }
  function release() {
    Object.keys(urls).forEach(function (k) { try { URL.revokeObjectURL(urls[k]); } catch (e) {} });
    urls = {};
  }

  // ── the bound ──────────────────────────────────────────────────────────
  function all() {
    return tx('readonly').then(function (s) { return s ? req(s.getAll()) : []; }).catch(function () { return []; });
  }
  function stats() {
    return all().then(function (rows) {
      return { items: rows.length, bytes: rows.reduce(function (a, r) { return a + (r.bytes || 0); }, 0), cap: CAP };
    });
  }
  function evict() {
    return all().then(function (rows) {
      var total = rows.reduce(function (a, r) { return a + (r.bytes || 0); }, 0);
      if (total <= CAP) return 0;
      rows.sort(function (a, b) { return (a.used || 0) - (b.used || 0); });   // oldest use goes first
      var dropped = 0;
      return tx('readwrite').then(function (s) {
        if (!s) return 0;
        var chain = Promise.resolve();
        rows.forEach(function (r) {
          if (total <= CAP) return;
          total -= (r.bytes || 0); dropped++;
          chain = chain.then(function () { return req(s.delete(r.url)); });
        });
        return chain.then(function () { return dropped; });
      });
    }).catch(function () { return 0; });
  }
  function clear() {
    release();
    mem = {};
    return tx('readwrite').then(function (s) { return s ? req(s.clear()) : null; }).catch(function () { return null; });
  }

  // ── the download ───────────────────────────────────────────────────────
  // A real file, named after the document and the voice, from the cache when it is already there — which
  // is the point of keeping it. One part is one file; a multi-part document offers each part, because
  // concatenating Opus streams in the browser would produce something no player is obliged to read.
  function download(m, partIndex) {
    if (!m || !m.parts || !m.parts.length) return Promise.resolve(false);
    var parts = partIndex == null ? m.parts : [m.parts[partIndex]];
    return parts.reduce(function (chain, p, k) {
      return chain.then(function () {
        return objectUrl(p.url).then(function (u) {
          var a = global.document.createElement('a');
          a.href = u;
          a.download = m.doc + '-' + m.voice + (m.parts.length > 1 ? '-part' + String(p.n).padStart(2, '0') : '') + '.opus';
          global.document.body.appendChild(a); a.click(); a.remove();
          return new Promise(function (r) { setTimeout(r, k < parts.length - 1 ? 350 : 0); });
        });
      });
    }, Promise.resolve()).then(function () { return true; });
  }

  var DV = {
    manifest: manifest, blob: blob, objectUrl: objectUrl, release: release,
    stats: stats, evict: evict, clear: clear, download: download,
    cap: function (v) { if (v != null) CAP = Math.max(1024 * 1024, v | 0); return CAP; },
    root: function (v) { if (v != null) ROOT = String(v).replace(/\/$/, ''); return ROOT; },
    supported: !!global.indexedDB,
    version: '1.0.0'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DV;
  DV.root = function (url) {
    if (url !== undefined) { ROOT = String(url || '/audio').replace(/\/+$/, ''); mem = {}; }
    return ROOT;
  };
  global.DVDocAudio = DV;
})(typeof window !== 'undefined' ? window : this);
