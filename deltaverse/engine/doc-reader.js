/*!
 * DeltaVerse nGn — doc.reader (DVDocReader: the document, read aloud).
 *
 * A LISTEN button that works, on a static page, with no backend. mindX renders documents to .ogg on a
 * FastAPI service and streams the parts; the DeltaVerse is static — it must deploy to a docroot or to
 * IPFS and still speak. So this reads the document the browser is already showing, through the
 * browser's own synthesiser, and it never fetches anything.
 *
 * WHERE THE BUTTON GOES. Inside the document's own <h1>. "Read this to me" is a decision you make
 * about the thing you are looking at, not a control you go hunting for at the edge of the screen.
 * Pressing it opens the panel AND starts reading in the same gesture — an open panel with a silent
 * PLAY button asks you to press a second button to do the thing you already asked for. Pressing it
 * again hides the panel; it does not stop the audio, because closing a control surface is not the
 * same as saying stop.
 *
 * WHAT IT READS. The document's own blocks, in document order — headings, paragraphs, quotes, list
 * items, citations — each split into sentences, because a sentence is the unit a synthesiser can be
 * interrupted between without losing its place, and because Chrome stalls on long utterances.
 * Skipped: anything marked [data-noread], and the reader's own furniture.
 *
 * THE PROGRESS IS REAL. speechSynthesis exposes no audio graph, so there is no waveform to draw and
 * this does not draw a fake one. What it does have is `boundary` events — the synthesiser saying which
 * word it has reached — so the reading line advances on actual word boundaries, the current block is
 * lit, and the current word is marked in place. That is a true readout of where the voice is, which a
 * decorative oscilloscope would not be.
 *
 * VOICES. engine/ngn/voices.js. **neural** is the default and is not editable; every other voice is a
 * stated derivation of it, and the panel says what the derivation is. Jaimla is the machine-learning
 * agent's voice, and it is one of the derivations.
 *
 * Prototype lane (.js, zero-dep, UMD). Injects its own style once. Honours prefers-reduced-motion.
 * Degrades to nothing at all — no button, no panel — where speechSynthesis is absent, rather than
 * offering a LISTEN button that cannot listen.
 *
 *   <script src="/engine/ngn/voices.js"></script>
 *   <script src="/engine/ngn/doc-reader.js"></script>
 *   <script>DVDocReader.mount();</script>
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var CSS_ID = 'dv-doc-reader-css';
  var KEY = 'dv_reader_v1';
  var SKIP = '.dv-reader, .dv-reader-panel, [data-noread], script, style, nav, .foot, .drift';

  function el(t, c, x) { var e = doc.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  var CSS = [
    '.dv-reader{display:inline-flex;align-items:center;gap:.5em;margin-left:.7em;vertical-align:middle;',
    '  font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;font-weight:600;',
    '  letter-spacing:.18em;',
    '  padding:7px 15px;border-radius:8px;cursor:pointer;background:rgba(var(--cy,34,211,238),.10);',
    '  color:rgb(var(--cy,34,211,238));border:1px solid rgba(var(--cy,34,211,238),.34);',
    '  transition:background .2s,border-color .2s,color .2s,box-shadow .2s}',
    '.dv-reader:hover{background:rgba(var(--cy,34,211,238),.15);border-color:rgb(var(--cy,34,211,238));',
    '  box-shadow:0 0 18px rgba(var(--cy,34,211,238),.25)}',
    '.dv-reader.on{background:rgb(var(--cy,34,211,238));color:#04040a;border-color:rgb(var(--cy,34,211,238))}',
    '.dv-reader .i{font-size:10px;line-height:1}',
    '.dv-reader:focus-visible{outline:2px solid rgb(var(--cy,34,211,238));outline-offset:3px}',
    // DRAGGABLE AND RESIZEABLE. `resize` needs a non-visible overflow to work at
    // all, and the min-width is the point below which the transport row cannot
    // lay out. The max-* are viewport-relative so a remembered size from a large
    // monitor cannot open off-screen on a phone.
    '.dv-reader-panel{position:fixed;right:18px;bottom:18px;z-index:2147482000;width:312px;',
    '  resize:both;overflow:auto;min-width:264px;min-height:96px;max-width:96vw;max-height:88vh;',
    '  font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);color:rgba(255,255,255,.82);',
    '  background:rgba(6,8,16,.92);border:1px solid rgba(var(--vi,157,78,221),.34);border-radius:12px;',
    '  box-shadow:0 22px 60px rgba(0,0,0,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}',
    '.dv-reader-panel[hidden]{display:none}',
    '.dv-reader-panel.shaded .dvr-body{display:none}',
    // shaded is a bar: it may still be widened, but height is the title bar
    '.dv-reader-panel.shaded{resize:horizontal;height:auto!important;min-height:0;overflow:visible}',
    '.dvr-hd{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:grab;user-select:none;',
    '  border-bottom:1px solid rgba(255,255,255,.08);font-size:10px;letter-spacing:.18em;text-transform:uppercase}',
    '.dvr-hd.dragging{cursor:grabbing}',
    '.dvr-hd .d{width:7px;height:7px;border-radius:50%;background:rgb(var(--cy,34,211,238));flex:0 0 auto;',
    '  box-shadow:0 0 9px rgb(var(--cy,34,211,238))}',
    '.dv-reader-panel.playing .dvr-hd .d{animation:dvr-pulse 1.6s ease-in-out infinite}',
    '@keyframes dvr-pulse{0%,100%{opacity:1}50%{opacity:.3}}',
    '.dvr-hd .t{flex:1;color:rgba(255,255,255,.62);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dvr-body{padding:10px}',
    '.dvr-line{height:3px;border-radius:2px;background:rgba(255,255,255,.10);overflow:hidden;margin:2px 0 9px}',
    '.dvr-line i{display:block;height:100%;width:0;border-radius:2px;',
    '  background:linear-gradient(90deg,rgb(var(--cy,34,211,238)),rgb(var(--vi,157,78,221)));transition:width .18s linear}',
    '.dvr-row{display:flex;align-items:center;gap:6px;margin-top:8px}',
    '.dv-reader-panel button{appearance:none;font:inherit;font-size:11px;cursor:pointer;border-radius:7px;',
    '  padding:5px 9px;color:rgba(255,255,255,.72);background:rgba(255,255,255,.04);',
    '  border:1px solid rgba(255,255,255,.14);transition:color .2s,border-color .2s,background .2s}',
    '.dv-reader-panel button:hover{color:#fff;border-color:rgba(var(--cy,34,211,238),.6);background:rgba(var(--cy,34,211,238),.10)}',
    '.dvr-play{min-width:44px;color:rgb(var(--cy,34,211,238))!important;border-color:rgba(var(--cy,34,211,238),.45)!important}',
    '.dv-reader-panel select,.dv-reader-panel input[type=range]{font:inherit;font-size:11px;',
    '  background:rgba(255,255,255,.04);color:rgba(255,255,255,.82);border:1px solid rgba(255,255,255,.14);',
    '  border-radius:7px;padding:4px 6px;flex:1;min-width:0}',
    // THE OPTION LIST IS NOT THE SELECT. The closed control was styled dark and
    // the open popup was not, so it fell back to the platform default — a white
    // list rendering near-white inherited text, and the voice names disappeared
    // at the moment you were choosing between them. Both halves must be stated.
    '.dv-reader-panel select option,.dv-reader-panel select optgroup{',
    '  background:#0b0f1a;color:#e6edf3}',
    '.dv-reader-panel select option:checked{background:#14304a;color:#fff}',
    '.dvr-meta{margin-top:9px;font-size:9.5px;line-height:1.75;color:rgba(255,255,255,.42);letter-spacing:.04em}',
    '.dvr-meta b{color:rgba(var(--cy,34,211,238),.92);font-weight:600}',
    '.dvr-meta i{font-style:normal;color:rgba(var(--am,255,176,84),.9)}',
    '.dvr-lock{color:rgba(var(--am,255,176,84),.85)}',
    '.dvr-count{margin-left:auto;font-size:9.5px;color:rgba(255,255,255,.4);white-space:nowrap}',
    '.dvr-dl{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:24px;',
    '  border:1px solid rgba(255,255,255,.14);border-radius:7px;color:rgba(255,255,255,.4);',
    '  text-decoration:none;font-size:12px;cursor:pointer}',
    '.dvr-dl[aria-disabled="true"]{opacity:.3;pointer-events:none}',
    '.dvr-dl:hover{color:#fff;border-color:rgba(var(--cy,34,211,238),.6);background:rgba(var(--cy,34,211,238),.10)}',
    '.dvr-mode{font-size:9px;letter-spacing:.12em;text-transform:uppercase;padding:1px 6px;border-radius:999px;',
    '  border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.42)}',
    '.dvr-mode.file{color:rgb(var(--am,255,176,84));border-color:rgba(var(--am,255,176,84),.42)}',
    // the playlist: the document is the album, and its blocks are the tracks
    '.dvr-list{list-style:none;margin:9px 0 0;padding:0;max-height:158px;overflow-y:auto;',
    '  border-top:1px solid rgba(255,255,255,.07);border-bottom:1px solid rgba(255,255,255,.07)}',
    '.dvr-list li{display:flex;gap:7px;align-items:baseline;padding:4px 3px;font-size:10.5px;cursor:pointer;',
    '  color:rgba(255,255,255,.48);border-radius:5px;transition:color .18s,background .18s}',
    '.dvr-list li:hover{color:#fff;background:rgba(var(--cy,34,211,238),.08)}',
    '.dvr-list li .k{flex:0 0 1.9em;text-align:right;font-size:9px;color:rgba(255,255,255,.28)}',
    '.dvr-list li .x{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dvr-list li .g{flex:0 0 auto;font-size:8px;letter-spacing:.1em;color:rgba(255,255,255,.24);text-transform:uppercase}',
    '.dvr-list li[aria-current="true"]{color:rgb(var(--cy,34,211,238));background:rgba(var(--cy,34,211,238),.10)}',
    '.dvr-list li[aria-current="true"] .k::before{content:"\\25b8 "}',
    '.dvr-list li.done{color:rgba(255,255,255,.3)}',
    // a platform that cannot speak still shows the button — it says so instead of disappearing
    '.dv-reader[data-mute]{cursor:help;opacity:.55;border-style:dashed}',
    '.dv-reader[data-mute]:hover{background:rgba(var(--am,255,176,84),.10);border-color:rgba(var(--am,255,176,84),.6);',
    '  color:rgb(var(--am,255,176,84));box-shadow:none}',
    '.dv-reading{background:linear-gradient(90deg,rgba(var(--cy,34,211,238),.11),rgba(var(--vi,157,78,221),.05));',
    '  box-shadow:inset 3px 0 0 rgb(var(--cy,34,211,238));border-radius:0 5px 5px 0;transition:background .3s}',
    '.dv-word{background:rgba(var(--am,255,176,84),.20);border-radius:3px;box-shadow:0 0 0 1px rgba(var(--am,255,176,84),.28)}',
    '@media (prefers-reduced-motion: reduce){.dvr-line i{transition:none}.dv-reader-panel .dvr-hd .d{animation:none}}',
    '@media (max-width:520px){.dv-reader-panel{right:10px;left:10px;width:auto}}'
  ].join('');

  function ensureCss() {
    if (doc.getElementById(CSS_ID)) return;
    var s = el('style'); s.id = CSS_ID; s.textContent = CSS; doc.head.appendChild(s);
  }

  // ── the document, as things that can be said ───────────────────────────
  // A sentence is the unit: it is where a synthesiser can be interrupted without losing its place, and
  // Chrome stalls on long utterances.
  //
  // Splitting must not ALTER the text. An abbreviation's full stop is protected with a sentinel and
  // restored after the split, never deleted — "250 BC." must still be read as "250 BC." Titles (Dr, Mr,
  // Prof) are always protected because the capitalised word after them is a name, not a new sentence;
  // every other abbreviation is protected only when what follows is lowercase or a digit, because
  // "in 250 BC. Dr Wallace wrote…" really is two sentences and reading it as one is worse than the
  // occasional early break.
  var SENT = '\u0001';
  var TITLES = /\b(Dr|Mr|Mrs|Ms|Prof|Rev|St|Sr|Jr|Mt|Ave)\.\s/g;
  var ABBR = /\b(No|vs|etc|Fig|Vol|Ch|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|BC|AD|approx|cf|al|Inc|Ltd|Co)\.\s+(?=[a-z0-9])/g;
  var EG = /\b(e\.g|i\.e|a\.m|p\.m)\.\s/gi;

  function sentences(text) {
    var t = String(text).replace(/\s+/g, ' ').trim();
    if (!t) return [];
    t = t.replace(TITLES, function (m, w) { return w + SENT + ' '; })
         .replace(ABBR, function (m, w) { return w + SENT + ' '; })
         .replace(EG, function (m, w) { return w.replace(/\./g, SENT) + SENT + ' '; });

    var parts = t.split(/([.!?…]+)(\s+)/);
    var joined = [], k;
    for (k = 0; k < parts.length; k += 3) {
      var s = (parts[k] || '') + (parts[k + 1] || '');
      if (s.trim()) joined.push(s.trim());
    }

    var out = [];
    joined.forEach(function (p) {
      if (p.length <= 240) { out.push(p); return; }
      // A sentence past the safe utterance length is broken at its own clauses — and the separator
      // stays with the clause it followed, so nothing is silently dropped from what is spoken.
      var bits = p.split(/([,;:—–]\s+)/), buf = '';
      for (var i = 0; i < bits.length; i += 2) {
        var c = (bits[i] || '') + (bits[i + 1] || '');
        if ((buf + c).length > 240 && buf) { out.push(buf.trim()); buf = c; }
        else buf += c;
      }
      if (buf.trim()) out.push(buf.trim());
    });
    // restore every protected stop: the text spoken is the text on the page
    return out.map(function (s) { return s.split(SENT).join('.'); }).filter(Boolean);
  }

  function collect(root) {
    var scope = root || doc.body;
    // [data-noread] excludes; [data-read] INCLUDES something the default selector would never catch.
    // The map's tool rows are anchors full of spans — the most valuable content on the page, and
    // invisible to a reader that only knows about paragraphs. An opt-out needs a matching opt-in.
    var sel = 'h1,h2,h3,h4,p,blockquote,li,cite,figcaption,dd,dt,td,[data-read]';
    var nodes = [].slice.call(scope.querySelectorAll(sel));
    var blocks = [];
    nodes.forEach(function (n) {
      if (n.closest && n.closest(SKIP)) return;
      if (n.querySelector && n.querySelector(sel)) return;              // containers, not leaves
      var txt = (n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim();
      txt = txt.replace(/\bLISTEN\b\s*$/, '').trim();                   // never read the button
      if (txt.length < 2 || !/[a-z0-9]/i.test(txt)) return;
      var ss = sentences(txt);
      if (!ss.length) return;
      blocks.push({ node: n, text: txt, sentences: ss, tag: n.tagName.toLowerCase() });
    });
    return blocks;
  }

  // ── the reader ─────────────────────────────────────────────────────────
  function mount(opts) {
    opts = opts || {};
    if (!global.speechSynthesis || !global.SpeechSynthesisUtterance) return null;   // no button it cannot honour
    if (!global.DVVoices) return null;
    ensureCss();

    var synth = global.speechSynthesis;
    var blocks = collect(opts.root);
    if (!blocks.length) return null;

    // NEURAL IS THE DEFAULT ON EVERY REFRESH, AND THAT IS NOT AN OVERSIGHT.
    //
    // The voice used to be restored from localStorage, so whatever you last
    // auditioned became the voice of the realm on that machine forever — press
    // OVERLORD once to hear it and every page you open afterwards greets you in
    // it. The page's own rule is the argument against that: a reader who has
    // heard the realm speak once should hear the same voice next time, on every
    // page, whatever anyone has been experimenting with. An audition is not a
    // preference.
    //
    // The RATE is still restored, because that is a comfort setting rather than
    // an identity — someone who reads at 1.3x wants to read at 1.3x, and it does
    // not change who is speaking.
    var state = { voice: 'neural', rate: 1 };
    try {
      var saved = JSON.parse(global.localStorage.getItem(KEY) || '{}');
      if (saved && saved.rate) state.rate = +saved.rate;
    } catch (e) {}
    // only what is actually restored is stored: writing `voice` here would leave a
    // key on disk that looks like a preference and is never read again.
    function save() { try { global.localStorage.setItem(KEY, JSON.stringify({ rate: state.rate })); } catch (e) {} }

    // ── the button, inside the document's own h1 ─────────────────────────
    var h1 = (opts.root || doc).querySelector('h1');
    var btn = el('button', 'dv-reader');
    btn.id = 'dv-listen-btn';
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'dv-reader-panel');
    btn.title = 'Open the voice panel and read this page aloud';
    btn.innerHTML = '<span class="i">&#9654;</span>LISTEN';
    if (h1) h1.appendChild(btn);
    else {
      var host = opts.root || doc.body;
      var p = el('p'); p.appendChild(btn); host.insertBefore(p, host.firstChild);
    }

    // ── the panel ────────────────────────────────────────────────────────
    var pnl = el('div', 'dv-reader-panel'); pnl.id = 'dv-reader-panel'; pnl.hidden = true;
    pnl.innerHTML =
      '<div class="dvr-hd"><span class="d"></span><span class="t">doc.player</span>' +
      '<span class="dvr-mode" data-a="mode">live</span>' +
      '<button type="button" data-a="shade" title="shrink to the bar">&#9472;</button>' +
      '<button type="button" data-a="close" title="hide the panel (it does not stop the reading)">&#10005;</button></div>' +
      '<div class="dvr-body">' +
      '<div class="dvr-line"><i></i></div>' +
      '<div class="dvr-three" data-a="three" aria-live="off" aria-hidden="true">' +
      '<span class="p"></span><span class="c"></span><span class="n"></span></div>' +
      '<div class="dvr-row">' +
      '<button type="button" data-a="prev" title="previous block">&#9198;</button>' +
      '<button type="button" class="dvr-play" data-a="play" title="play / pause">&#9654;</button>' +
      '<button type="button" data-a="next" title="next block">&#9197;</button>' +
      '<button type="button" data-a="stop" title="stop and return to the top">&#9632;</button>' +
      '<a class="dvr-dl" data-a="dl" aria-disabled="true" title="download the audio">&#8615;</a>' +
      '<span class="dvr-count"></span></div>' +
      '<div class="dvr-row"><select data-a="voice" title="voice"></select></div>' +
      '<div class="dvr-row"><span style="font-size:9.5px;letter-spacing:.14em;color:rgba(255,255,255,.4)">RATE</span>' +
      '<input type="range" data-a="rate" min="0.6" max="1.6" step="0.02"></div>' +
      '<details class="dvr-deck"><summary>AUDIO DECK</summary>' +
      '<div id="listen-deck"></div>' +
      '<p class="dvr-deckoff" data-a="deckoff" hidden></p></details>' +
      '<ol class="dvr-list" data-a="list"></ol>' +
      '<div class="dvr-meta"></div></div>';
    doc.body.appendChild(pnl);

    var line = pnl.querySelector('.dvr-line i');
    var count = pnl.querySelector('.dvr-count');
    var meta = pnl.querySelector('.dvr-meta');
    var sel = pnl.querySelector('[data-a="voice"]');
    var rate = pnl.querySelector('[data-a="rate"]');
    var playB = pnl.querySelector('[data-a="play"]');
    var hd = pnl.querySelector('.dvr-hd');
    var title = pnl.querySelector('.dvr-hd .t');

    rate.value = state.rate;

    // ── voices ───────────────────────────────────────────────────────────
    function fillVoices() {
      sel.innerHTML = '';
      DVVoices.list().forEach(function (v) {
        var o = doc.createElement('option');
        o.value = v.id;
        o.textContent = v.name + (v.immutable ? '  (the reference)' : '') + (v.edited ? '  · edited' : '');
        sel.appendChild(o);
      });
      sel.value = state.voice;
      describe();
    }
    function describe() {
      var v = DVVoices.get(state.voice);
      var pv = v.voice ? v.voice.name : 'the platform default';
      meta.innerHTML =
        (v.immutable
          ? '<span class="dvr-lock">&#9679; neural is the reference &mdash; it is not edited</span>'
          : 'derived from <b>' + v.from + '</b> &middot; <i>' + v.derivedFrom + '</i>') +
        '<br>' + v.character +
        '<br>speaking through <b>' + pv + '</b> &middot; rate ' + v.prosody.rate.toFixed(2) +
        ' &middot; pitch ' + v.prosody.pitch.toFixed(2);
    }

    // ── reading ──────────────────────────────────────────────────────────
    // ── the two modes ────────────────────────────────────────────────────
    // LIVE: the browser's synthesiser. Marks the current word (boundary events); no file, no seeking.
    // FILE: audio rendered ahead by scripts/render-listen.mjs and kept in /audio/<doc>/<voice>/. Seeks,
    //       scrubs, downloads and survives a reload — but a file has no boundary events, so it lights
    //       the block and not the word. The manifest carries the exact second each block begins, so the
    //       block highlight is measured rather than estimated.
    // Neither is better; the player prefers FILE because someone pressing LISTEN twice wants the second
    // press to be instant, and says which mode it is in.
    var docId = opts.doc || (function () {
      var b = (global.location.pathname.split('/').pop() || 'index').replace(/\.html?$/, '');
      return b || 'index';
    })();
    var A = null, au = null, pi = 0, modeEl = pnl.querySelector('[data-a="mode"]');
    var dl = pnl.querySelector('[data-a="dl"]');
    function fileMode() { return !!A; }
    function partBefore(n) { var t = 0; for (var k = 0; k < n && k < A.parts.length; k++) t += A.parts[k].seconds; return t; }
    function ensureAudio() {
      if (au) return au;
      au = new global.Audio(); au.preload = 'metadata';
      au.addEventListener('timeupdate', onTime);
      au.addEventListener('ended', function () {
        if (pi + 1 < A.parts.length) { pi++; loadPart(pi, true); }
        else { finish(); }
      });
      au.addEventListener('error', function () {
        // one direct-URL attempt before concluding the file is unplayable
        if (A && A.parts[pi] && au.src.indexOf('blob:') === 0) {
          try { console.info('[doc.player] element error on the blob — retrying the direct URL'); } catch (e) {}
          au.src = A.parts[pi].url;
          if (playing) { au.play().catch(function () { fallToLive('the rendered audio could not be played'); }); }
          return;
        }
        fallToLive('the rendered audio could not be played');
      });
      return au;
    }
    // A blob is not the only way to reach a file. objectUrl() fetches the whole
    // part into memory first, which costs a 486 KB stall before a single sample
    // plays AND throws away Range support — the direct URL streams and seeks.
    // So the direct URL is the retry, not the last resort.
    function loadPart(n, autoplay) {
      pi = n;
      var direct = A.parts[n].url;
      function useDirect(why) {
        try { console.info('[doc.player] ' + why + ' — retrying the direct URL'); } catch (e) {}
        au.src = direct;
        return autoplay ? au.play().catch(function () {
          fallToLive('playback was refused for both the blob and the direct URL');
        }) : null;
      }
      return DVDocAudio.objectUrl(direct).then(function (u) {
        au.src = u;
        if (autoplay) return au.play().catch(function () { return useDirect('blob playback was refused'); });
      }).catch(function () { return useDirect('the rendered audio could not be fetched as a blob'); });
    }
    function onTime() {
      if (!A || !au) return;
      var part = A.parts[pi], t = au.currentTime;
      var b = part.from;
      for (var k = 0; k < part.marks.length; k++) if (part.marks[k].at <= t) b = part.marks[k].block; else break;
      if (b !== bi) { bi = b; light(blocks[bi]); }
      var elapsed = partBefore(pi) + t;
      line.style.width = (A.seconds ? clamp(elapsed / A.seconds, 0, 1) * 100 : 0).toFixed(2) + '%';
      count.textContent = (bi + 1) + ' / ' + blocks.length;
      markList();
    }
    // FALLING BACK INTO SILENCE IS NOT A FALLBACK.
    //
    // This dropped to live synthesis on any audio error. On a machine with no
    // installed voices — every headless Linux, and this is the machine that most
    // needs the rendered audio — live synthesis CANNOT speak, so the "fallback"
    // was a guaranteed silence, announced by a pause button that claimed to be
    // playing. Degrading from something that failed once to something that
    // cannot work at all is strictly worse than staying put and saying so.
    function liveCanSpeak() {
      try { return !!(global.DVVoices && global.DVVoices.usable && global.DVVoices.usable()); }
      catch (e) { return false; }
    }
    function fallToLive(why) {
      if (!liveCanSpeak()) { failFile(why); return; }
      A = null; if (au) { try { au.pause(); } catch (e) {} }
      modeEl.textContent = 'live'; modeEl.classList.remove('file');
      dl.setAttribute('aria-disabled', 'true');
      if (why) { try { console.info('[doc.player] ' + why + ' — falling back to live synthesis'); } catch (e) {} }
    }
    // The rendered audio failed and there is no synthesiser behind it. Stop
    // pretending: stop the transport, keep file mode (the file is still the only
    // thing that could ever work here), and put the reason where it can be read.
    function failFile(why) {
      playing = false;
      if (au) { try { au.pause(); } catch (e) {} }
      // put the transport back to 'play' — the pause glyph while nothing is
      // playing is the lie this whole function exists to stop telling
      try {
        pnl.classList.remove('playing');
        var pb = pnl.querySelector('[data-a="play"]');
        if (pb) { pb.innerHTML = '&#9654;'; pb.title = 'play'; }
      } catch (e) {}
      modeEl.textContent = 'file — cannot play';
      modeEl.classList.add('file');
      modeEl.title = (why || 'the rendered audio could not be played') +
        ', and this browser has no installed speech voices to fall back on. ' +
        'The audio file itself is fine — download it with the arrow.';
      try { console.warn('[doc.player] ' + (why || 'audio failed') +
        ' — and live synthesis has no voices; not pretending to play'); } catch (e) {}
    }
    function adoptManifest(m) {
      A = (m && m.parts && m.parts.length && m.parts[0].marks) ? m : null;
      modeEl.textContent = A ? 'file' : 'live';
      modeEl.classList.toggle('file', !!A);
      modeEl.title = A
        ? 'rendered audio: ' + A.seconds.toFixed(0) + 's, ' + (A.bytes / 1024 / 1024).toFixed(2) + ' MB, ' +
          A.parts.length + ' part(s) — seeks and downloads; a file has no word boundaries, so it lights the block'
        : 'live synthesis: marks the current word; no file to seek or download';
      dl.setAttribute('aria-disabled', A ? 'false' : 'true');
      if (A) { pi = 0; ensureAudio(); }
    }

    var bi = 0, si = 0, playing = false, cur = null, wordSpan = null, litBlock = null;
    var srcLabel = opts.label || 'doc.player';   // a host page may name what it mounted
    var totalSent = blocks.reduce(function (a, b) { return a + b.sentences.length; }, 0);
    var doneSent = 0;

    function sentBefore(n) {                     // how many sentences precede block n
      var s = 0; for (var k = 0; k < n && k < blocks.length; k++) s += blocks[k].sentences.length; return s;
    }
    function light(b) {
      unlight();
      if (!b) return;
      litBlock = b.node; litBlock.classList.add('dv-reading');
      var r = litBlock.getBoundingClientRect();
      if (r.top < 60 || r.bottom > global.innerHeight - 60) {
        try { litBlock.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { litBlock.scrollIntoView(); }
      }
    }
    function unlight() {
      three('', '', '');
      clearWord();
      if (litBlock) litBlock.classList.remove('dv-reading');
      litBlock = null;
    }
    // THE THREE-WORD VIEW is driven by the same boundary event that lights the
    // page, so it can never disagree with it — there is one source of truth for
    // "which word is being said" and both surfaces read it.
    var threeEl = null;
    function three(prev, cur, next) {
      if (!threeEl) threeEl = pnl.querySelector('[data-a="three"]');
      if (!threeEl) return;
      threeEl.querySelector('.p').textContent = prev || '';
      threeEl.querySelector('.c').textContent = cur || '';
      threeEl.querySelector('.n').textContent = next || '';
      threeEl.setAttribute('aria-hidden', cur ? 'false' : 'true');
    }
    // Neighbours come from the sentence being spoken, not from the page: the page
    // has markup between words and the sentence is exactly what was handed to the
    // synthesiser, so charIndex indexes into it directly.
    function neighbours(sentence, charIndex, len) {
      var before = sentence.slice(0, charIndex).split(/\s+/).filter(Boolean);
      var after = sentence.slice(charIndex + (len || 0)).split(/\s+/).filter(Boolean);
      return [before.length ? before[before.length - 1] : '', after.length ? after[0] : ''];
    }
    // the current word, marked in place — from the synthesiser's own boundary events
    function markWord(node, sentence, charIndex, len) {
      clearWord();
      if (!node || charIndex == null) return;
      var word = sentence.slice(charIndex, charIndex + (len || 0));
      if (!word) word = (sentence.slice(charIndex).split(/\s/)[0] || '');
      word = word.replace(/^[^\wÀ-ɏ]+|[^\wÀ-ɏ]+$/g, '');
      // the strip updates even for the short words the page-marking skips: "a"
      // and "is" are still where you are, and a reading finger that stalls on
      // them is worse than one that does not
      var nb = neighbours(sentence, charIndex, len);
      three(nb[0], word || sentence.slice(charIndex).split(/\s/)[0] || '', nb[1]);
      if (word.length < 2) return;
      try {
        var walker = doc.createTreeWalker(node, global.NodeFilter.SHOW_TEXT, null);
        var t;
        while ((t = walker.nextNode())) {
          var at = t.nodeValue.indexOf(word);
          if (at < 0) continue;
          var rng = doc.createRange();
          rng.setStart(t, at); rng.setEnd(t, at + word.length);
          var s = el('span', 'dv-word');
          rng.surroundContents(s);
          wordSpan = s;
          return;
        }
      } catch (e) { wordSpan = null; }
    }
    function clearWord() {
      if (!wordSpan) return;
      try {
        var p = wordSpan.parentNode;
        if (p) {
          while (wordSpan.firstChild) p.insertBefore(wordSpan.firstChild, wordSpan);
          p.removeChild(wordSpan);
          p.normalize();
        }
      } catch (e) {}
      wordSpan = null;
    }

    var listEl = pnl.querySelector('[data-a="list"]');
    function buildList() {
      listEl.innerHTML = '';
      blocks.forEach(function (b, k) {
        var li = doc.createElement('li');
        li.dataset.k = k;
        li.innerHTML = '<span class="k">' + (k + 1) + '</span>' +
          '<span class="x"></span><span class="g">' + b.tag + '</span>';
        li.querySelector('.x').textContent = b.text.slice(0, 90);
        li.title = b.text.slice(0, 220) + (b.text.length > 220 ? '…' : '');
        listEl.appendChild(li);
      });
    }
    listEl.addEventListener('click', function (e) {
      var li = e.target.closest && e.target.closest('li'); if (!li) return;
      if (btn.dataset.mute) return;
      jumpTo(+li.dataset.k, true);
    });
    function markList() {
      [].forEach.call(listEl.children, function (li, k) {
        li.setAttribute('aria-current', k === bi ? 'true' : 'false');
        li.classList.toggle('done', k < bi);
      });
      var cur = listEl.children[bi];
      if (cur && !pnl.hidden) { try { cur.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
    }

    function progress() {
      line.style.width = (totalSent ? clamp(doneSent / totalSent, 0, 1) * 100 : 0).toFixed(2) + '%';
      count.textContent = (bi + 1) + ' / ' + blocks.length;
      title.textContent = playing && blocks[bi] ? blocks[bi].tag.toUpperCase() + ' · reading' : srcLabel;
      markList();
    }

    // Chrome pauses synthesis after ~15s and does not resume on its own. The documented mitigation is
    // to nudge it; it is a harmless no-op on engines that do not need it.
    var watchdog = 0;
    function guard(on) {
      clearInterval(watchdog);
      if (!on) return;
      watchdog = setInterval(function () {
        if (!playing) return;
        try { if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); } } catch (e) {}
      }, 9000);
    }

    function say() {
      if (!playing) return;
      var b = blocks[bi];
      if (!b) { finish(); return; }
      if (si >= b.sentences.length) {
        si = 0; bi++;
        if (bi >= blocks.length) { finish(); return; }
        b = blocks[bi];
      }
      if (si === 0) light(b);
      var text = b.sentences[si];
      var u = DVVoices.utter(text, { voice: state.voice, rate: state.rate });
      cur = u;
      u.onboundary = function (e) {
        if (e.name && e.name !== 'word') return;
        markWord(b.node, text, e.charIndex, e.charLength);
      };
      u.onend = function () { if (cur !== u) return; step(); };
      u.onerror = function () { if (cur !== u) return; step(); };
      try { synth.speak(u); } catch (e) { finish(); }
      progress();
    }
    function step() { clearWord(); doneSent++; si++; progress(); say(); }
    function finish() { stop(); bi = 0; si = 0; doneSent = 0; progress(); }

    function play() {
      if (playing) return;
      playing = true; pnl.classList.add('playing');
      playB.innerHTML = '&#10073;&#10073;'; playB.title = 'pause';
      if (fileMode()) {
        if (!au.src) loadPart(pi, true); else au.play().catch(function () { fallToLive('playback was refused'); });
        progress(); return;
      }
      guard(true);
      if (synth.paused && synth.speaking) { synth.resume(); progress(); return; }
      say();
    }
    function pause() {
      playing = false; pnl.classList.remove('playing');
      playB.innerHTML = '&#9654;'; playB.title = 'play';
      if (fileMode()) { try { au.pause(); } catch (e) {} progress(); return; }
      guard(false);
      try { synth.pause(); } catch (e) {}
      progress();
    }
    function stop() {
      playing = false; pnl.classList.remove('playing');
      playB.innerHTML = '&#9654;'; playB.title = 'play';
      if (fileMode() && au) { try { au.pause(); au.currentTime = 0; } catch (e) {} }
      guard(false);
      cur = null;
      try { synth.cancel(); } catch (e) {}
      unlight(); progress();
    }
    function jumpTo(n, andPlay) {
      var was = playing;
      bi = clamp(n, 0, blocks.length - 1);
      if (fileMode()) {
        // seek: find the part holding this block, and the second it begins inside it — measured
        for (var k = 0; k < A.parts.length; k++) {
          var pt = A.parts[k];
          if (bi < pt.from || bi > pt.to) continue;
          var at = 0;
          for (var j = 0; j < pt.marks.length; j++) if (pt.marks[j].block <= bi) at = pt.marks[j].at;
          var go = function () { try { au.currentTime = at; } catch (e) {} if (was || andPlay) { playing = false; play(); } };
          if (k !== pi || !au.src) loadPart(k, false).then(go); else go();
          break;
        }
        light(blocks[bi]); progress();
        return;
      }
      cur = null;
      try { synth.cancel(); } catch (e) {}
      clearWord();
      si = 0;
      doneSent = sentBefore(bi);                 // the line never claims progress that was not made
      light(blocks[bi]); progress();
      if (was || andPlay) { playing = false; play(); }    // picking a track means play THAT track;
    }                                                     // stepping while paused stays paused
    function jump(d) { jumpTo(bi + d); }

    // ── the panel's own controls ─────────────────────────────────────────
    var restored = false;
    function openPanel(open) {
      if (open === undefined) open = pnl.hidden;
      pnl.hidden = !open;
      // restore on first SHOW: at mount the panel is hidden, and a hidden panel
      // measures 0x0 so nothing can be clamped against it
      if (open && !restored) { restored = true; try { panelRestore(); } catch (e) {} }
      btn.classList.toggle('on', open);
      btn.setAttribute('aria-expanded', String(open));
      return open;
    }
    btn.addEventListener('click', function () {
      var wasOpen = !pnl.hidden;
      openPanel(!wasOpen);
      if (btn.dataset.mute) {                          // the player opens, and states the difficulty
        title.textContent = 'no voice on this platform';
        meta.innerHTML = '<span class="dvr-lock">&#9679; this browser exposes a speech synthesiser but ' +
          'enumerates <b>no voices</b></span><br>every utterance would be dropped in silence, so nothing ' +
          'is played rather than appearing to play.<br>On Linux: install <b>speech-dispatcher</b> and a ' +
          'voice such as <b>espeak-ng</b>. On macOS, iOS, Windows and Android voices ship with the system.' +
          '<br>The playlist below is what would be read.';
        return;
      }
      if (!wasOpen && !playing) play();               // one gesture: open AND read
    });

    pnl.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button'); if (!b) return;
      var a = b.dataset.a;
      if (a === 'play') { playing ? pause() : play(); }
      else if (a === 'prev') jump(-1);
      else if (a === 'next') jump(1);
      else if (a === 'stop') finish();
      else if (a === 'dl') { if (A) DVDocAudio.download(A); }
      else if (a === 'shade') { pnl.classList.toggle('shaded'); b.innerHTML = pnl.classList.contains('shaded') ? '&#9633;' : '&#9472;'; }
      else if (a === 'close') openPanel(false);
    });
    sel.addEventListener('change', function () {
      state.voice = sel.value; save(); describe();
      var b = bi, was = playing;
      stop();
      lookForAudio().then(function () {
        if (fileMode() || DVVoices.usable()) {
          delete btn.dataset.mute;
          btn.innerHTML = '<span class="i">&#9654;</span>LISTEN';
        } else {
          btn.dataset.mute = '1';
          btn.innerHTML = '<span class="i">&#9654;</span>LISTEN &mdash; no voice installed';
        }
        bi = b;
        if (was) { playing = false; jumpTo(b, true); } else progress();
      });
    });
    rate.addEventListener('input', function () {
      state.rate = +rate.value;
      var v = DVVoices.get(state.voice);
      title.textContent = 'rate ×' + state.rate.toFixed(2) + ' · ' + (v.prosody.rate * state.rate).toFixed(2);
    });
    rate.addEventListener('change', function () {
      save();
      if (playing) { var b = bi, s = si, d = doneSent; stop(); bi = b; si = s; doneSent = d; play(); }
      else progress();
    });

    // ── WHERE YOU PUT IT, AND HOW BIG YOU MADE IT ────────────────────────
    //
    // Two traps this file has already fallen into once, both recorded here so the
    // next person does not repeat them:
    //
    //   1. NEVER SAVE WHILE HIDDEN. A hidden panel measures 0x0 at 0,0, so a save
    //      triggered while closed writes {0,0} and the panel opens in the corner
    //      at zero size next time.
    //   2. CLAMP AGAINST THE PANEL, NOT A CONSTANT. An earlier clamp kept 80px
    //      on screen, which is a title bar and nothing else — you could not reach
    //      the controls to move it back. The restore clamps so the whole panel
    //      is inside the viewport where it fits, and to a generous margin where
    //      it does not.
    var PKEY = 'dv_reader_panel_v1';
    function panelSave() {
      if (pnl.hidden) return;                                  // trap 1
      var r = pnl.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) return;               // nothing real to save
      try {
        global.localStorage.setItem(PKEY, JSON.stringify({
          left: Math.round(r.left), top: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height),
        }));
      } catch (e) {}
    }
    function panelRestore() {
      var v = null;
      try { v = JSON.parse(global.localStorage.getItem(PKEY) || 'null'); } catch (e) {}
      if (!v) return;
      var vw = global.innerWidth, vh = global.innerHeight;
      var w = clamp(+v.w || 312, 264, Math.round(vw * 0.96));
      var h = clamp(+v.h || 0, 0, Math.round(vh * 0.88));
      pnl.style.width = w + 'px';
      if (h > 96) pnl.style.height = h + 'px';
      // trap 2: the whole panel inside the viewport where it fits
      pnl.style.left = clamp(+v.left || 0, 0, Math.max(0, vw - w)) + 'px';
      pnl.style.top = clamp(+v.top || 0, 0, Math.max(0, vh - Math.min(h || 120, vh - 40))) + 'px';
      pnl.style.right = 'auto'; pnl.style.bottom = 'auto';
    }
    // The resize handle is the browser's, so there is no drag event to hook —
    // ResizeObserver is how you find out it happened, and it also catches the
    // window changing under a remembered size.
    if (typeof global.ResizeObserver !== 'undefined') {
      var rzT = 0;
      new global.ResizeObserver(function () {
        clearTimeout(rzT);
        rzT = setTimeout(panelSave, 220);        // the drag fires continuously
      }).observe(pnl);
    }
    global.addEventListener('resize', function () {
      if (!pnl.hidden) panelRestore();           // keep a remembered box on screen
    });

    // drag the header
    var drag = null;
    hd.addEventListener('pointerdown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      var r = pnl.getBoundingClientRect();
      pnl.style.left = r.left + 'px'; pnl.style.top = r.top + 'px';
      pnl.style.right = 'auto'; pnl.style.bottom = 'auto';
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      hd.classList.add('dragging');
      if (hd.setPointerCapture) hd.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    hd.addEventListener('pointermove', function (e) {
      if (!drag) return;
      pnl.style.left = clamp(e.clientX - drag.dx, 0, global.innerWidth - pnl.offsetWidth) + 'px';
      pnl.style.top = clamp(e.clientY - drag.dy, 0, global.innerHeight - 44) + 'px';
    });
    function endDrag() { if (drag) { drag = null; hd.classList.remove('dragging'); panelSave(); } }
    hd.addEventListener('pointerup', endDrag);
    hd.addEventListener('pointercancel', endDrag);

    // a page left mid-sentence must not keep talking to an empty room
    global.addEventListener('beforeunload', function () { try { synth.cancel(); } catch (e) {} });
    doc.addEventListener('visibilitychange', function () { if (doc.hidden && playing) pause(); });

    // The button is not offered until it is known to work. A platform with the API and no voices drops
    // every utterance in silence, and a LISTEN button that does nothing is worse than no button at all.
    // The button is shown from the start — LISTEN is the point of the page and it should be findable
    // immediately. What it must never do is pretend: a platform with the API and no installed voices
    // drops every utterance in silence, so there the button STAYS and SAYS SO rather than disappearing
    // (which reads as a broken page) or playing nothing (which reads as broken audio).
    // A platform with no installed voices cannot do LIVE synthesis — but it can still play a document
    // that was RENDERED ahead, because that is an ordinary audio file. So the store is consulted first
    // and the button is only refused when there is neither a voice nor a rendering: exactly the case
    // where nothing can be heard. (Gating the lookup behind usable() denied rendered audio to the one
    // kind of machine that most needs it.)
    btn.title = 'looking for audio…';
    Promise.all([DVVoices.ready(), lookForAudio()]).then(function () {
      buildList();
      fillVoices();
      if (fileMode()) {
        btn.title = 'Open the player — this page is rendered, so it starts instantly and can be downloaded';
        return;
      }
      if (!DVVoices.usable()) {
        btn.dataset.mute = '1';
        btn.innerHTML = '<span class="i">&#9654;</span>LISTEN &mdash; no voice installed';
        btn.title = 'This browser has a speech synthesiser but no installed voices, and this page has ' +
          'no rendered audio in this voice, so nothing can be spoken here. On Linux: install ' +
          'speech-dispatcher and a voice such as espeak-ng. On macOS, iOS, Windows and Android voices ' +
          'ship with the system.';
        if (opts.onUnavailable) { try { opts.onUnavailable(btn); } catch (e) {} }
        return;
      }
      btn.title = 'Open the player and read this page aloud';
    });
    // ── THE AUDIO DECK CONTRACT ──────────────────────────────────────────
    //
    // The dreamknob rack (static/audio_rack.js) owns NO state. It reads
    // window.listenState() and writes back through these globals, then re-reads
    // on the "mindx:listen" event — the same contract the mindX player exposes,
    // so one island serves both sites and a knob can never disagree with the
    // plain control beside it. The panel works with the rack never loaded.
    //
    // GAIN ABOVE 1.0 NEEDS WEB AUDIO. An <audio> element's `volume` is an
    // ATTENUATOR: it clamps at 1.0 and cannot make anything louder. ANCIENT is a
    // whisper by design and is still the quietest voice in the cast after
    // loudness normalisation, so the deck has to be able to amplify — which
    // means a GainNode, which means a graph. It is built lazily, because
    // constructing an AudioContext before a gesture gets it suspended.
    var actx = null, gainNode = null, analyser = null, srcNode = null;
    var deckVol = 1;
    // NOT `ensureAudio` — that name already belongs to the function that creates the
    // <audio> ELEMENT, and a second `function ensureAudio()` in this scope would win
    // by hoisting and silently stop the element from ever being made. The graph is a
    // different thing from the element and now says so.
    function ensureGraph() {
      if (actx) return true;
      if (!fileMode()) return false;        // live synthesis has no element to tap
      ensureAudio();                        // the element first — the graph needs a source
      if (!au) return false;
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      try {
        actx = new AC();
        srcNode = actx.createMediaElementSource(au);
        gainNode = actx.createGain(); gainNode.gain.value = deckVol;
        analyser = actx.createAnalyser(); analyser.fftSize = 2048;
        srcNode.connect(gainNode); gainNode.connect(analyser); analyser.connect(actx.destination);
      } catch (e) { actx = null; return false; }
      return true;
    }
    function emit() { try { global.dispatchEvent(new global.Event('mindx:listen')); } catch (e) {} }

    global.listenState = function () {
      return {
        playing: playing, ready: fileMode() || liveCanSpeak(),
        mode: fileMode() ? 'file' : 'live',
        part: fileMode() ? pi + 1 : bi + 1,
        parts: fileMode() && A ? A.parts.length : blocks.length,
        vol: deckVol, rate: state.rate, voice: state.voice,
        voices: DVVoices.list().map(function (v) { return { id: v.id, label: v.name }; }),
        analyser: analyser, ensureAudio: ensureGraph
      };
    };
    global.listenVol = function (v) {
      deckVol = clamp(+v || 0, 0, 4);
      // Below 1.0 the element alone is enough and no graph is needed; above it,
      // the element pins at 1.0 and the GainNode carries the rest.
      if (deckVol <= 1 && !actx) { if (au) au.volume = deckVol; }
      else if (ensureGraph()) { if (au) au.volume = 1; gainNode.gain.value = deckVol; }
      else if (au) { au.volume = Math.min(deckVol, 1); }
      emit();
    };
    global.listenSpeed = function (v) {
      // THE SLIDER OWNS THE GRID, SO READ THE VALUE BACK OFF IT.
      // The knob is continuous and the slider has step 0.02 from 0.6, so a knob
      // value of 1.25 is not on the grid: the browser silently snapped the slider
      // to a neighbour while state.rate kept 1.25, and the two faces of the one
      // machine then disagreed — the exact thing this contract exists to prevent.
      // Assigning and re-reading costs nothing and makes the input the authority
      // on what its own value can be.
      rate.value = clamp(+v || 1, 0.6, 1.6);
      state.rate = +rate.value;
      save();
      if (fileMode() && au) { try { au.playbackRate = state.rate; } catch (e) {} }
      emit();
    };
    global.listenVoice = function (id) {
      if (!id || id === state.voice) return;
      sel.value = id; sel.dispatchEvent(new global.Event('change')); emit();
    };
    global.listenToggle = function () { if (playing) pause(); else play(); emit(); };

    // the deck is an enhancement, and says so when it is not there
    var deckOff = pnl.querySelector('[data-a="deckoff"]');
    global.setTimeout(function () {
      var host = pnl.querySelector('#listen-deck');
      if (host && !host.firstChild && deckOff) {
        deckOff.hidden = false;
        deckOff.textContent = 'The instrument deck did not load. Every control it offers is ' +
          'also here as a plain control — nothing is missing but the knobs.';
      }
    }, 4000);

    function lookForAudio() {
      if (!global.DVDocAudio) { adoptManifest(null); return Promise.resolve(); }
      return DVDocAudio.manifest(docId, state.voice).then(adoptManifest).catch(function () { adoptManifest(null); });
    }
    progress();

    return {
      el: pnl, button: btn, blocks: blocks,
      play: play, pause: pause, stop: finish,
      next: function () { jump(1); }, prev: function () { jump(-1); },
      voice: function (id) { if (id) { state.voice = id; sel.value = id; save(); describe(); } return state.voice; },
      open: openPanel,
      destroy: function () { stop(); pnl.remove(); btn.remove(); }
    };
  }

  var DV = { mount: mount, collect: collect, sentences: sentences, version: '1.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = DV;
  global.DVDocReader = DV;
})(typeof window !== 'undefined' ? window : this);
