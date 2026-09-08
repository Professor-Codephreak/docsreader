/*!
 * DeltaVerse nGn — doc.reader (DVDocReader: the document, read aloud).  v2.0.0
 *
 * A LISTEN button that works, on a static page, with no backend. mindX renders documents to .ogg on a
 * FastAPI service and streams the parts; the DeltaVerse is static — it must deploy to a docroot or to
 * IPFS and still speak. So this reads the document the browser is already showing, through the
 * browser's own synthesiser, and it never fetches anything it was not pointed at.
 *
 * WHERE THE BUTTON GOES. Inside the document's own <h1>. "Read this to me" is a decision you make
 * about the thing you are looking at, not a control you go hunting for at the edge of the screen.
 * Pressing it opens the panel AND starts reading in the same gesture. While it is reading it says
 * STOP, in red, because the only thing you want from a button that is already reading is the way out.
 *
 * WHAT IT READS. The document's own blocks, in document order — headings, paragraphs, quotes, list
 * items, citations — each split into sentences, because a sentence is the unit a synthesiser can be
 * interrupted between without losing its place, and because Chrome stalls on long utterances.
 * Skipped: anything marked [data-noread], and the reader's own furniture.
 *
 * THE PANEL IS AN INSTRUMENT, NOT A NOTICE. What used to sit under the controls was a paragraph
 * describing the voice — "neural is the reference, it is not edited, speaking through the platform
 * default, rate 0.98, pitch 1.00". Nobody pressing LISTEN needs to be told that; they can hear it.
 * In its place is an oscilloscope on the audio that is actually playing, and a timeline you can take
 * hold of. Two rules keep both honest:
 *
 *   THE TRACE IS THE SIGNAL. In file mode the rendered audio runs through an AnalyserNode and the
 *   scope draws the samples. The browser's own synthesiser exposes no audio graph, so in live mode
 *   there is nothing to tap — and the scope shows a flat line that says so, rather than a waveform
 *   invented to look busy.
 *
 *   THE TIMELINE IS MEASURED. In file mode it is seconds, and the block ticks along it are the
 *   seconds each block begins, from the manifest. In live mode there is no clock, so the timeline is
 *   the blocks themselves and dragging it lands on a block. Either way what you drag is what you get.
 *
 * THE RENDER MUST BE THE PAGE. Rendered audio is aligned to the page by block INDEX, so an edit that
 * adds or removes a paragraph after the render shifts every highlight from that point on — the voice
 * reads one paragraph while the page lights the next. The manifest therefore carries a fingerprint
 * per block; the player fingerprints the page the same way, maps render blocks to page blocks, and
 * says on the badge when they no longer match instead of lighting the wrong paragraph in silence.
 *
 * VOICES. engine/ngn/voices.js. **neural** is the default on every page and after every refresh; the
 * rate is remembered because it is a comfort setting, the voice is not because an audition is not a
 * preference.
 *
 * Prototype lane (.js, zero-dep, UMD). Injects its own style once. Honours prefers-reduced-motion.
 * Degrades to nothing at all — no button, no panel — where speechSynthesis is absent AND nothing is
 * rendered, rather than offering a LISTEN button that cannot listen.
 *
 *   <script src="/engine/ngn/voices.js"></script>
 *   <script src="/engine/ngn/doc-audio.js"></script>      (optional: the rendered-file lane)
 *   <script src="/engine/ngn/doc-reader.js"></script>
 *   <script>DVDocReader.mount();</script>
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var CSS_ID = 'dv-doc-reader-css';
  var KEY = 'dv_reader_v1';
  var PKEY = 'dv_reader_panel_v2';
  var SKIP = '.dv-reader, .dv-reader-panel, [data-noread], script, style, nav, .foot, .drift';

  function el(t, c, x) { var e = doc.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mmss(s) {
    s = Math.max(0, Math.round(s || 0));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  // A block's fingerprint: FNV-1a over the normalised text, hex. The renderer writes the same thing
  // into the manifest (render_neural.py) so the player can tell whether the page it is on is the page
  // that was rendered — and line the two up when an edit has added or removed a block.
  function fingerprint(text) {
    var t = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
    var h = 0x811c9dc5;
    for (var i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  var reduced = false;
  try { reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

  var CSS = [
    // ── the button in the headline ──
    '.dv-reader{display:inline-flex;align-items:center;gap:.5em;margin-left:.7em;vertical-align:middle;',
    '  font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;font-weight:600;',
    '  letter-spacing:.18em;line-height:1;',
    '  padding:7px 15px;border-radius:8px;cursor:pointer;background:rgba(var(--cy,34,211,238),.10);',
    '  color:rgb(var(--cy,34,211,238));border:1px solid rgba(var(--cy,34,211,238),.34);',
    '  transition:background .2s,border-color .2s,color .2s,box-shadow .2s}',
    '.dv-reader:hover{background:rgba(var(--cy,34,211,238),.15);border-color:rgb(var(--cy,34,211,238));',
    '  box-shadow:0 0 18px rgba(var(--cy,34,211,238),.25)}',
    '.dv-reader.on{background:rgb(var(--cy,34,211,238));color:#04040a;border-color:rgb(var(--cy,34,211,238))}',
    '.dv-reader .i{font-size:10px;line-height:1}',
    '.dv-reader:focus-visible{outline:2px solid rgb(var(--cy,34,211,238));outline-offset:3px}',
    // READING = STOP, IN RED. Stop is the one control with a consequence and it must not look like
    // everything else.
    '.dv-reader.reading,.dv-reader.on.reading{background:rgba(248,81,73,.12);color:#ff6b64;border-color:rgba(248,81,73,.72)}',
    '.dv-reader.reading:hover{background:rgba(248,81,73,.22);border-color:#ff6b64;box-shadow:0 0 18px rgba(248,81,73,.30)}',
    '.dv-reader.reading .i{color:#ff6b64}',
    '.dv-reader[data-mute]{cursor:help;opacity:.55;border-style:dashed}',
    '.dv-reader[data-mute]:hover{background:rgba(var(--am,255,176,84),.10);border-color:rgba(var(--am,255,176,84),.6);',
    '  color:rgb(var(--am,255,176,84));box-shadow:none}',

    // ── the panel ──
    // Draggable from anywhere that is not a control, resizeable from the corner; both remembered.
    '.dv-reader-panel{position:fixed;right:18px;bottom:18px;z-index:2147482000;width:332px;box-sizing:border-box;',
    '  resize:both;overflow:hidden;min-width:280px;min-height:120px;max-width:96vw;max-height:88vh;',
    '  display:flex;flex-direction:column;',
    '  font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);color:rgba(255,255,255,.84);',
    '  background:linear-gradient(180deg,rgba(10,13,24,.74),rgba(5,7,14,.80));',
    '  border:1px solid rgba(var(--vi,157,78,221),.30);border-radius:14px;',
    '  box-shadow:0 24px 64px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.03) inset;',
    '  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}',
    '.dv-reader-panel *{box-sizing:border-box}',
    '.dv-reader-panel[hidden]{display:none}',
    '.dv-reader-panel.moving{transition:none;box-shadow:0 30px 80px rgba(0,0,0,.7),0 0 0 1px rgba(var(--cy,34,211,238),.35)}',
    '.dv-reader-panel.shaded{resize:horizontal;height:auto!important;min-height:0}',
    '.dv-reader-panel.shaded .dvr-body{display:none}',
    // the corner handle the browser draws is faint; name the corner so it can be found
    '.dv-reader-panel::after{content:"";position:absolute;right:4px;bottom:4px;width:10px;height:10px;pointer-events:none;',
    '  border-right:2px solid rgba(255,255,255,.18);border-bottom:2px solid rgba(255,255,255,.18);border-radius:0 0 3px 0}',
    '.dv-reader-panel.shaded::after{display:none}',

    // header — the grip
    '.dvr-hd{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 8px;cursor:move;user-select:none;flex:0 0 auto;',
    '  border-bottom:1px solid rgba(255,255,255,.07);font-size:10px;letter-spacing:.18em;text-transform:uppercase;touch-action:none}',
    '.dvr-hd .grip{color:rgba(255,255,255,.28);font-size:13px;line-height:1;letter-spacing:-2px;flex:0 0 auto;padding:0 2px}',
    '.dvr-hd:hover .grip{color:rgba(var(--cy,34,211,238),.8)}',
    '.dvr-hd .d{width:7px;height:7px;border-radius:50%;background:rgb(var(--cy,34,211,238));flex:0 0 auto;',
    '  box-shadow:0 0 9px rgb(var(--cy,34,211,238))}',
    '.dv-reader-panel.playing .dvr-hd .d{animation:dvr-pulse 1.6s ease-in-out infinite}',
    '@keyframes dvr-pulse{0%,100%{opacity:1}50%{opacity:.3}}',
    '.dvr-hd .t{flex:1;min-width:0;color:rgba(255,255,255,.62);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dvr-hd button{padding:3px 7px!important;font-size:11px!important;line-height:1!important}',
    '.dvr-mode{font-size:9px;letter-spacing:.12em;text-transform:uppercase;padding:2px 7px;border-radius:999px;white-space:nowrap;',
    '  border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.42)}',
    '.dvr-mode.file{color:rgb(var(--am,255,176,84));border-color:rgba(var(--am,255,176,84),.42)}',
    '.dvr-mode.bad{color:#ff6b64;border-color:rgba(248,81,73,.6)}',
    '.dvr-mode.warn{color:rgb(var(--am,255,176,84));border-color:rgba(var(--am,255,176,84),.7);background:rgba(var(--am,255,176,84),.10)}',

    '.dvr-body{padding:10px 10px 8px;display:flex;flex-direction:column;min-height:0;flex:1 1 auto;overflow:hidden}',

    // ── the scope ──
    '.dvr-scope{position:relative;height:46px;flex:0 0 auto;border-radius:8px;overflow:hidden;',
    '  background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.07)}',
    '.dvr-scope canvas{display:block;width:100%;height:100%}',
    '.dvr-scope .lbl{position:absolute;right:7px;bottom:4px;font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;',
    '  color:rgba(255,255,255,.32);pointer-events:none}',
    '.dvr-scope .lbl:empty{display:none}',

    // ── the timeline ──
    // A track you can take hold of. The fill is progress, the ticks are where blocks begin, the knob
    // is where you are. Everything is positioned in percent so a resize does not move the truth.
    '.dvr-tl{position:relative;height:22px;margin:8px 0 2px;cursor:pointer;touch-action:none;flex:0 0 auto;outline:none}',
    '.dvr-tl .trk{position:absolute;left:0;right:0;top:9px;height:4px;border-radius:2px;background:rgba(255,255,255,.12)}',
    '.dvr-tl .fill{position:absolute;left:0;top:9px;height:4px;width:0;border-radius:2px;',
    '  background:linear-gradient(90deg,rgb(var(--cy,34,211,238)),rgb(var(--vi,157,78,221)))}',
    '.dvr-tl .tick{position:absolute;top:7px;width:1px;height:8px;background:rgba(255,255,255,.22);pointer-events:none}',
    '.dvr-tl .tick.h{background:rgba(var(--am,255,176,84),.55);top:5px;height:12px}',
    '.dvr-tl .knob{position:absolute;top:4px;width:14px;height:14px;margin-left:-7px;border-radius:50%;',
    '  background:#fff;border:2px solid rgb(var(--cy,34,211,238));box-shadow:0 0 0 3px rgba(var(--cy,34,211,238),.18),0 2px 8px rgba(0,0,0,.5);',
    '  transition:transform .12s}',
    '.dvr-tl:hover .knob,.dvr-tl.drag .knob,.dvr-tl:focus-visible .knob{transform:scale(1.18)}',
    '.dvr-tl:focus-visible .trk{box-shadow:0 0 0 2px rgba(var(--cy,34,211,238),.45)}',
    '.dvr-tl .tip{position:absolute;top:-16px;transform:translateX(-50%);font-size:9px;letter-spacing:.08em;',
    '  padding:1px 5px;border-radius:4px;background:rgba(0,0,0,.8);color:#fff;white-space:nowrap;pointer-events:none;display:none}',
    '.dvr-tl.drag .tip{display:block}',
    '.dvr-times{display:flex;justify-content:space-between;font-size:9.5px;letter-spacing:.08em;color:rgba(255,255,255,.42);flex:0 0 auto}',
    '.dvr-times b{font-weight:600;color:rgba(255,255,255,.7)}',

    // ── rows and controls ──
    '.dvr-row{display:flex;align-items:center;gap:6px;margin-top:8px;flex:0 0 auto}',
    '.dv-reader-panel button{appearance:none;font:inherit;font-size:11px;cursor:pointer;border-radius:7px;',
    '  padding:6px 9px;color:rgba(255,255,255,.72);background:rgba(255,255,255,.04);',
    '  border:1px solid rgba(255,255,255,.14);transition:color .2s,border-color .2s,background .2s;line-height:1.1}',
    '.dv-reader-panel button:hover{color:#fff;border-color:rgba(var(--cy,34,211,238),.6);background:rgba(var(--cy,34,211,238),.10)}',
    '.dv-reader-panel button:focus-visible{outline:2px solid rgba(var(--cy,34,211,238),.8);outline-offset:1px}',
    '.dvr-play{min-width:46px;color:rgb(var(--cy,34,211,238))!important;border-color:rgba(var(--cy,34,211,238),.45)!important;font-size:12px!important}',
    '.dvr-stop{color:#ff8a84!important;border-color:rgba(248,81,73,.4)!important}',
    '.dvr-stop:hover{background:rgba(248,81,73,.14)!important;border-color:#ff6b64!important}',
    // THE DOWNLOAD IS A LABELLED BUTTON, NOT A GLYPH. The arrow it used to be measured 26px and read as
    // decoration; people asked where the download was while looking at it.
    '.dvr-dl{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:10px!important;font-weight:600;letter-spacing:.14em;',
    '  padding:6px 11px!important;color:rgb(var(--am,255,176,84))!important;border-color:rgba(var(--am,255,176,84),.5)!important;',
    '  background:rgba(var(--am,255,176,84),.08)!important;text-decoration:none;white-space:nowrap}',
    '.dvr-dl:hover{background:rgba(var(--am,255,176,84),.18)!important;border-color:rgb(var(--am,255,176,84))!important;',
    '  box-shadow:0 0 14px rgba(var(--am,255,176,84),.25)}',
    '.dvr-dl .i{font-size:13px;line-height:1}',
    '.dvr-dl[aria-disabled="true"]{opacity:.38;cursor:not-allowed;box-shadow:none!important;background:transparent!important}',
    '.dvr-vlabel{font-size:9px;letter-spacing:.18em;color:rgba(255,255,255,.45);flex:0 0 auto;min-width:38px}',
    '.dv-reader-panel select,.dv-reader-panel input[type=range]{font:inherit;font-size:11px;',
    '  background:rgba(255,255,255,.04);color:rgba(255,255,255,.82);border:1px solid rgba(255,255,255,.14);',
    '  border-radius:7px;padding:4px 6px;flex:1;min-width:0}',
    // THE OPTION LIST IS NOT THE SELECT: both halves must be styled or the popup falls back to a white
    // list with near-white text.
    '.dv-reader-panel .dvr-voicerow select{font-size:12.5px;padding:7px 9px;font-weight:600;',
    '  border-color:rgba(var(--am,255,176,84),.42);color:#fff;cursor:pointer}',
    '.dv-reader-panel .dvr-voicerow select:hover{border-color:rgba(var(--am,255,176,84),.75)}',
    '.dv-reader-panel select option,.dv-reader-panel select optgroup{background:#0b0f1a;color:#e6edf3}',
    '.dv-reader-panel select option:checked{background:#14304a;color:#fff}',
    '.dv-reader-panel input[type=range]{padding:0;height:22px;accent-color:rgb(var(--cy,34,211,238));border:0;background:transparent}',
    '.dvr-rateval{font-size:10px;color:rgba(255,255,255,.55);min-width:38px;text-align:right}',
    '.dvr-count{margin-left:auto;font-size:9.5px;color:rgba(255,255,255,.4);white-space:nowrap}',
    '.dvr-cache{font-size:9px;letter-spacing:.1em;color:rgba(255,255,255,.3);cursor:pointer;margin-top:6px;flex:0 0 auto}',
    '.dvr-cache:empty{display:none}',
    '.dvr-cache:hover{color:rgb(var(--cy,34,211,238))}',
    '#listen-deck:empty{display:none}',
    '#listen-deck{margin-top:8px;flex:0 0 auto}',

    // ── the playlist: the document is the album, its blocks are the tracks ──
    '.dvr-list{list-style:none;margin:9px 0 0;padding:0;min-height:56px;max-height:200px;overflow-y:auto;flex:1 1 auto;',
    '  border-top:1px solid rgba(255,255,255,.07);border-bottom:1px solid rgba(255,255,255,.07)}',
    '.dvr-list li{display:flex;gap:7px;align-items:baseline;padding:4px 3px;font-size:10.5px;cursor:pointer;',
    '  color:rgba(255,255,255,.48);border-radius:5px;transition:color .18s,background .18s}',
    '.dvr-list li:hover{color:#fff;background:rgba(var(--cy,34,211,238),.08)}',
    '.dvr-list li .k{flex:0 0 1.9em;text-align:right;font-size:9px;color:rgba(255,255,255,.28)}',
    '.dvr-list li .x{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    // the row being read shows all of its words; every other row is a one-line track listing
    '.dvr-list li[aria-current="true"]{align-items:flex-start;padding:6px 3px;color:rgb(var(--cy,34,211,238));background:rgba(var(--cy,34,211,238),.10)}',
    '.dvr-list li[aria-current="true"] .x{white-space:normal;overflow:visible;text-overflow:clip;line-height:1.55;color:rgba(255,255,255,.78)}',
    '.dvr-list li .x .w{border-radius:3px;padding:0 1px;transition:background .12s,color .12s}',
    '.dvr-list li[aria-current="true"] .x .w.said{color:rgba(255,255,255,.5)}',
    '.dvr-list li[aria-current="true"] .x .w.on{background:rgba(var(--am,255,176,84),.26);color:#fff;box-shadow:0 0 0 1px rgba(var(--am,255,176,84),.32)}',
    '.dvr-list li .g{flex:0 0 auto;font-size:8px;letter-spacing:.1em;color:rgba(255,255,255,.24);text-transform:uppercase}',
    '.dvr-list li[aria-current="true"] .k::before{content:"\\25b8 "}',
    '.dvr-list li.done{color:rgba(255,255,255,.3)}',

    // ── the page ──
    '.dv-reading{background:linear-gradient(90deg,rgba(var(--cy,34,211,238),.11),rgba(var(--vi,157,78,221),.05));',
    '  box-shadow:inset 3px 0 0 rgb(var(--cy,34,211,238));border-radius:0 5px 5px 0;transition:background .3s}',
    '.dv-word{background:rgba(var(--am,255,176,84),.20);border-radius:3px;box-shadow:0 0 0 1px rgba(var(--am,255,176,84),.28)}',
    '@media (prefers-reduced-motion: reduce){.dvr-tl .fill{transition:none}.dv-reader-panel .dvr-hd .d{animation:none}.dvr-tl .knob{transition:none}}',
    '@media (max-width:520px){.dv-reader-panel{right:8px;left:8px;bottom:8px;width:auto;max-width:none;resize:none}}'
  ].join('');

  function ensureCss() {
    if (doc.getElementById(CSS_ID)) return;
    var s = el('style'); s.id = CSS_ID; s.textContent = CSS; doc.head.appendChild(s);
  }

  // ── the document, as things that can be said ───────────────────────────
  // Splitting must not ALTER the text. An abbreviation's full stop is protected with a sentinel and
  // restored after the split, never deleted — "250 BC." must still be read as "250 BC."
  var SENT = '';
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
      var bits = p.split(/([,;:—–]\s+)/), buf = '';
      for (var i = 0; i < bits.length; i += 2) {
        var c = (bits[i] || '') + (bits[i + 1] || '');
        if ((buf + c).length > 240 && buf) { out.push(buf.trim()); buf = c; }
        else buf += c;
      }
      if (buf.trim()) out.push(buf.trim());
    });
    return out.map(function (s) { return s.split(SENT).join('.'); }).filter(Boolean);
  }

  function collect(root) {
    var scope = root || doc.body;
    var sel = 'h1,h2,h3,h4,p,blockquote,li,cite,figcaption,dd,dt,td,[data-read]';
    var nodes = [].slice.call(scope.querySelectorAll(sel));
    var blocks = [];
    nodes.forEach(function (n) {
      if (n.closest && n.closest(SKIP)) return;
      if (n.querySelector && n.querySelector(sel)) return;              // containers, not leaves
      var txt = (n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim();
      // the buttons live inside the headline; never read them
      txt = txt.replace(/(\s*\b(LISTEN|STOP|SHARE)(\s*[\u2014-]\s*no voice installed)?)+\s*$/, '').trim();
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
    var hasSynth = !!(global.speechSynthesis && global.SpeechSynthesisUtterance);
    if (!global.DVVoices) return null;
    if (!hasSynth && !global.DVDocAudio) return null;   // nothing could ever be heard
    ensureCss();

    var synth = global.speechSynthesis;
    var blocks = collect(opts.root);
    if (!blocks.length) return null;

    // NEURAL IS THE DEFAULT ON EVERY REFRESH. The rate is a comfort setting and is restored; the voice
    // is an identity and an audition is not a preference.
    // A PAGE MAY PIN THE VOICE. opts.voice names the voice the reading starts in (neural unless said
    // otherwise); opts.chooser === false hides the VOICE row, empties the deck's voice list and makes
    // every voice setter a no-op, so the page reads in one voice and offers no audition. The
    // WordPress reader mounts this way: on an article the voice is the site's, not the visitor's.
    var pinned = opts.chooser === false;
    var state = { voice: opts.voice || 'neural', rate: 1 };
    try {
      var saved = JSON.parse(global.localStorage.getItem(KEY) || '{}');
      if (saved && saved.rate) state.rate = clamp(+saved.rate, 0.6, 1.6);
    } catch (e) {}
    function save() { try { global.localStorage.setItem(KEY, JSON.stringify({ rate: state.rate })); } catch (e) {} }

    // ── the button, inside the document's own h1 ─────────────────────────
    var h1 = (opts.root || doc).querySelector('h1');
    var btn = el('button', 'dv-reader');
    btn.id = 'dv-listen-btn';
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'dv-reader-panel');
    btn.setAttribute('data-noread', '1');
    btn.title = 'Open the player and read this page aloud';
    btn.innerHTML = '<span class="i">&#9654;</span>LISTEN';
    if (h1) h1.appendChild(btn);
    else {
      var host = opts.root || doc.body;
      var p = el('p'); p.appendChild(btn); host.insertBefore(p, host.firstChild);
    }

    // ── the panel ────────────────────────────────────────────────────────
    var srcLabel = opts.label || 'doc.player';
    var pnl = el('div', 'dv-reader-panel'); pnl.id = 'dv-reader-panel'; pnl.hidden = true;
    pnl.setAttribute('data-noread', '1');
    pnl.setAttribute('role', 'region'); pnl.setAttribute('aria-label', 'audio player');
    pnl.innerHTML =
      '<div class="dvr-hd" title="drag to move · double-click to send back to the corner">' +
      '<span class="grip" aria-hidden="true">&#8942;&#8942;</span><span class="d"></span><span class="t"></span>' +
      '<span class="dvr-mode" data-a="mode">live</span>' +
      '<button type="button" data-a="shade" title="shrink to the bar">&#9472;</button>' +
      '<button type="button" data-a="close" title="hide the panel (it does not stop the reading)">&#10005;</button></div>' +
      '<div class="dvr-body">' +
      '<div class="dvr-scope"><canvas></canvas><span class="lbl"></span></div>' +
      '<div class="dvr-tl" data-a="tl" role="slider" tabindex="0" aria-label="position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
      '<div class="trk"></div><div class="fill"></div><div class="ticks"></div><div class="knob"></div><div class="tip"></div></div>' +
      '<div class="dvr-times"><span class="el">0:00</span><span class="mid"></span><span class="tot"></span></div>' +
      '<div class="dvr-row">' +
      '<button type="button" data-a="prev" title="previous block">&#9198;</button>' +
      '<button type="button" class="dvr-play" data-a="play" title="play / pause">&#9654;</button>' +
      '<button type="button" data-a="next" title="next block">&#9197;</button>' +
      '<button type="button" class="dvr-stop" data-a="stop" title="stop and return to the top">&#9632;</button>' +
      '<button type="button" class="dvr-dl" data-a="dl" aria-disabled="true"><span class="i">&#11015;</span>DOWNLOAD</button>' +
      '</div>' +
      '<div class="dvr-row dvr-voicerow"><span class="dvr-vlabel">VOICE</span>' +
      '<select data-a="voice" title="choose the voice — the reading continues from where it is"></select></div>' +
      '<div class="dvr-row"><span class="dvr-vlabel">RATE</span>' +
      '<input type="range" data-a="rate" min="0.6" max="1.6" step="0.02" title="reading speed">' +
      '<span class="dvr-rateval"></span></div>' +
      '<ol class="dvr-list" data-a="list"></ol>' +
      '<div id="listen-deck"></div>' +
      '<div class="dvr-cache" title="audio held in this browser — click to clear"></div>' +
      '</div>';
    doc.body.appendChild(pnl);

    var hd = pnl.querySelector('.dvr-hd');
    var title = pnl.querySelector('.dvr-hd .t');
    var modeEl = pnl.querySelector('[data-a="mode"]');
    var sel = pnl.querySelector('[data-a="voice"]');
    var rate = pnl.querySelector('[data-a="rate"]');
    var rateVal = pnl.querySelector('.dvr-rateval');
    var playB = pnl.querySelector('[data-a="play"]');
    var dl = pnl.querySelector('[data-a="dl"]');
    var tl = pnl.querySelector('[data-a="tl"]');
    var tlFill = tl.querySelector('.fill'), tlKnob = tl.querySelector('.knob'), tlTicks = tl.querySelector('.ticks'), tlTip = tl.querySelector('.tip');
    var tEl = pnl.querySelector('.dvr-times .el'), tMid = pnl.querySelector('.dvr-times .mid'), tTot = pnl.querySelector('.dvr-times .tot');
    var scopeC = pnl.querySelector('.dvr-scope canvas'), scopeL = pnl.querySelector('.dvr-scope .lbl');
    var listEl = pnl.querySelector('[data-a="list"]');
    var cacheEl = pnl.querySelector('.dvr-cache');

    title.textContent = srcLabel;
    rate.value = state.rate; rateVal.textContent = '×' + state.rate.toFixed(2);
    if (pinned) pnl.querySelector('.dvr-voicerow').hidden = true;

    // ── voices ───────────────────────────────────────────────────────────
    function fillVoices() {
      sel.innerHTML = '';
      DVVoices.list().forEach(function (v) {
        var o = doc.createElement('option');
        o.value = v.id;
        o.textContent = v.name + (v.edited ? '  · edited' : '');
        sel.appendChild(o);
      });
      sel.value = state.voice;
    }

    // ── the two modes ────────────────────────────────────────────────────
    // LIVE: the browser's synthesiser. Marks the current word from boundary events; no file, no clock.
    // FILE: audio rendered ahead and kept at /audio/<doc>/<voice>/. Seeks, scrubs, downloads, survives
    //       a reload, and runs through the scope. The manifest carries the exact second each block
    //       begins, so the block is measured and the word inside it is estimated — and said to be.
    var docId = opts.doc || (function () {
      var b = (global.location.pathname.split('/').pop() || 'index').replace(/\.html?$/, '');
      return b || 'index';
    })();
    var A = null, au = null, pi = 0;
    var r2p = null, p2r = null;               // render block -> page block, and back, when they differ
    function fileMode() { return !!A; }
    function pageBlockOf(r) { return r2p ? r2p[r] : r; }
    function renderBlockOf(p) { return p2r ? p2r[p] : p; }
    // Line the render up with the page. With fingerprints the mapping is exact (monotonic match, so a
    // repeated sentence cannot pair with the wrong twin); without them, index is all there is, and a
    // count that differs is reported rather than trusted.
    function alignManifest(m) {
      r2p = p2r = null;
      var n = (m.blocks | 0) || 0, fps = m.blockFingerprints;
      var report = { render: n, page: blocks.length, matched: 0, exact: true };
      if (fps && fps.length) {
        var pf = blocks.map(function (b) { return fingerprint(b.text); });
        var map = [], back = [], j = 0, i;
        for (i = 0; i < fps.length; i++) {
          var k = -1;
          for (var q = j; q < pf.length; q++) if (pf[q] === fps[i]) { k = q; break; }
          if (k < 0) { map[i] = -1; continue; }
          map[i] = k; back[k] = i; j = k + 1; report.matched++;
        }
        report.exact = report.matched === fps.length && report.matched === pf.length;
        if (!report.exact) { r2p = map; p2r = back; }
      } else {
        report.matched = Math.min(n, blocks.length);
        report.exact = n === blocks.length;
      }
      m.align = report;
      return report;
    }
    function partBefore(n) { var t = 0; for (var k = 0; k < n && k < A.parts.length; k++) t += A.parts[k].seconds; return t; }
    function liveCanSpeak() { try { return hasSynth && !!(DVVoices.usable && DVVoices.usable()); } catch (e) { return false; } }

    function ensureAudio() {
      if (au) return au;
      au = new global.Audio(); au.preload = 'auto';
      // the scope taps the element through Web Audio, which needs a CORS-clean source when the part
      // is streamed by URL rather than played from a blob — set before any src
      try { au.crossOrigin = 'anonymous'; } catch (e) {}
      au.addEventListener('timeupdate', onTime);            // the coarse clock, for reduced-motion and background tabs
      au.addEventListener('playing', clockStart);
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
    // A blob is not the only way to reach a file: the direct URL streams and seeks, so it is the
    // retry rather than the last resort.
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
        if (autoplay) return au.play().catch(function (err) {
          if (err && err.name === 'NotAllowedError') { refused(); return; }
          return useDirect('blob playback was refused');
        });
      }).catch(function () { return useDirect('the rendered audio could not be fetched as a blob'); });
    }
    // NotAllowedError is the autoplay policy, not a broken rendering: say so and stay in file mode
    function refused() {
      playing = false; pnl.classList.remove('playing'); playB.innerHTML = '&#9654;'; playB.title = 'play';
      paintBtn();
      modeEl.textContent = 'ready — press play';
      modeEl.title = 'This browser will not start audio on its own until you have interacted with the page. ' +
        'The reading is loaded; press play.';
    }
    // THE CLOCK IS READ EVERY FRAME. `timeupdate` fires about four times a second, so a highlight
    // driven by it is on average an eighth of a second late and sometimes a quarter — enough that a
    // reader following the voice sees the page lag. While a file plays, the element's currentTime is
    // read on every animation frame instead, and the small remaining lead covers the time it takes an
    // eye to notice a change.
    var LEAD = 0.10, clockRAF = 0;
    function clockTick() {
      clockRAF = 0;
      if (!playing || !fileMode() || !au || au.paused) return;
      onTime();
      clockRAF = global.requestAnimationFrame(clockTick);
    }
    function clockStart() { if (!clockRAF && !reduced) clockRAF = global.requestAnimationFrame(clockTick); }
    function onTime() {
      if (!A || !au) return;
      var part = A.parts[pi], t = au.currentTime;
      var rb = part.from, mk = -1;
      for (var k = 0; k < part.marks.length; k++) if (part.marks[k].at <= t + LEAD) { rb = part.marks[k].block; mk = k; } else break;
      var b = pageBlockOf(rb);
      if (b >= 0 && b !== bi && blocks[b]) { bi = b; light(blocks[bi]); }
      if (b >= 0 && mk >= 0 && blocks[bi] && blocks[bi].words.length) {
        var start = part.marks[mk].at;
        var end = mk + 1 < part.marks.length ? part.marks[mk + 1].at : part.seconds;
        var gap = (A.gap != null ? +A.gap : 0.35);
        var span = Math.max(0.2, end - start - gap);           // the speech, not the pause after it
        setWord(wordAtFraction(blocks[bi].words, (t + LEAD - start) / span));
      }
      progress();
    }
    function fallToLive(why) {
      if (!liveCanSpeak()) { failFile(why); return; }
      A = null; if (au) { try { au.pause(); } catch (e) {} }
      setMode('live');
      if (why) { try { console.info('[doc.player] ' + why + ' — falling back to live synthesis'); } catch (e) {} }
    }
    // FALLING BACK INTO SILENCE IS NOT A FALLBACK. With no synthesiser voices installed, the file was
    // the only thing that could ever work here; stop, stay in file mode, and say why.
    function failFile(why) {
      playing = false;
      if (au) { try { au.pause(); } catch (e) {} }
      pnl.classList.remove('playing'); playB.innerHTML = '&#9654;'; playB.title = 'play';
      paintBtn();
      modeEl.textContent = 'file — cannot play'; modeEl.className = 'dvr-mode file bad';
      modeEl.title = (why || 'the rendered audio could not be played') +
        ', and this browser has no installed speech voices to fall back on. The file itself is fine — use DOWNLOAD.';
      try { console.warn('[doc.player] ' + (why || 'audio failed') + ' — and live synthesis has no voices; not pretending to play'); } catch (e) {}
    }
    function setMode(m) {
      var al = (m === 'file' && A && A.align) ? A.align : null;
      var off = al && !al.exact;
      modeEl.className = 'dvr-mode' + (m === 'file' ? ' file' : '') + (off ? ' warn' : '');
      modeEl.textContent = m === 'file' ? (off ? 'rendered · page changed' : 'rendered') : 'live';
      modeEl.title = m === 'file'
        ? 'rendered audio: ' + A.seconds.toFixed(0) + ' s, ' + (A.bytes / 1024 / 1024).toFixed(2) + ' MB, ' + A.parts.length +
          ' part(s). Seeks and downloads. The block is measured (its start second is in the file); the word inside it is estimated.' +
          (off ? ' THE PAGE HAS CHANGED SINCE THIS WAS RENDERED: ' + al.render + ' blocks were recorded, the page has ' + al.page +
            (A.blockFingerprints ? ', ' + al.matched + ' match and are lined up by fingerprint; the rest are not lit.' :
              '. Without fingerprints in the manifest the highlight is by index and will drift after the edit — re-render this page.') : '')
        : 'live synthesis in this browser: marks the current word from the synthesiser itself; there is no file to seek, download or scope';
      try { if (off) console.warn('[doc.player] rendered audio is for a different page: ' + al.render + ' blocks recorded, ' + al.page + ' on the page, ' + al.matched + ' matched' + (A.blockFingerprints ? ' by fingerprint' : ' (no fingerprints — re-render)')); } catch (e) {}
      dl.setAttribute('aria-disabled', m === 'file' ? 'false' : 'true');
      dl.title = m === 'file'
        ? 'Save the rendered audio (' + A.parts.length + ' Opus file' + (A.parts.length > 1 ? 's' : '') + ', ' + (A.bytes / 1024 / 1024).toFixed(1) + ' MB)'
        : 'No file to download: this reading is synthesised live in your browser. Pages that have been rendered ahead offer a file here.';
      scopeL.textContent = m === 'file' ? '' : 'live synthesis · no signal to tap';
      drawTicks();
      progress();
    }
    function adoptManifest(m) {
      A = (m && m.parts && m.parts.length && m.parts[0].marks) ? m : null;
      if (A) alignManifest(A);
      setMode(A ? 'file' : 'live');
      if (A) {
        pi = 0; ensureAudio();
        // Arm the first part IMMEDIATELY: a browser only starts audio inside a user gesture, and awaiting a
        // fetch before play() spends the gesture. With the source set, the click plays synchronously.
        loadPart(0, false);
        warmAll();
      }
    }
    // Pull every remaining part into the cache in the background, once, so that seeking anywhere and
    // every later visit are served from IndexedDB rather than the network.
    var warmed = false;
    function warmAll() {
      if (warmed || !A || !global.DVDocAudio) return;
      warmed = true;
      var k = 1;
      (function next() {
        if (k >= A.parts.length) { showCache(); return; }
        DVDocAudio.blob(A.parts[k].url).then(function () { k++; next(); }, function () { k++; next(); });
      })();
    }
    function showCache() {
      if (!global.DVDocAudio || !A || !DVDocAudio.stats) return;
      DVDocAudio.stats().then(function (st) {
        cacheEl.textContent = 'held in this browser: ' + (st.bytes / 1024 / 1024).toFixed(1) + ' MB';
        cacheEl.title = st.items + ' part(s) of a ' + (st.cap / 1024 / 1024).toFixed(0) + ' MB cap — a later visit fetches nothing. Click to clear.';
      });
    }
    cacheEl.addEventListener('click', function () {
      if (!global.DVDocAudio) return;
      DVDocAudio.clear().then(function () { cacheEl.textContent = 'cache cleared'; });
    });

    // ── state ────────────────────────────────────────────────────────────
    var bi = 0, si = 0, playing = false, cur = null, wordSpan = null, litBlock = null;
    var wi = -1;                                 // the word being said, as an index into blocks[bi].words
    blocks.forEach(function (b) { b.words = b.text.split(/\s+/).filter(Boolean); });
    var totalSent = blocks.reduce(function (a, b) { return a + b.sentences.length; }, 0);
    var doneSent = 0;
    function sentBefore(n) { var s = 0; for (var k = 0; k < n && k < blocks.length; k++) s += blocks[k].sentences.length; return s; }

    // THE BUTTON HAS ONE JOB AND ONE PLACE THAT DECIDES IT.
    function paintBtn() {
      if (btn.dataset.mute) {
        btn.classList.remove('reading');
        btn.innerHTML = '<span class="i">&#9654;</span>LISTEN &mdash; no voice installed';
        return;
      }
      if (playing) {
        btn.classList.add('reading');
        btn.innerHTML = '<span class="i">&#9632;</span>STOP';
        btn.title = 'stop reading';
      } else {
        btn.classList.remove('reading');
        btn.innerHTML = '<span class="i">&#9654;</span>LISTEN';
        btn.title = 'Open the player and read this page aloud';
      }
    }

    function light(b) {
      unlight();
      if (!b) return;
      litBlock = b.node; litBlock.classList.add('dv-reading');
      var r = litBlock.getBoundingClientRect();
      if (r.top < 60 || r.bottom > global.innerHeight - 60) {
        try { litBlock.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }); } catch (e) { litBlock.scrollIntoView(); }
      }
    }
    function unlight() {
      clearWord();
      if (litBlock) litBlock.classList.remove('dv-reading');
      litBlock = null;
      wi = -1;
    }
    // ── THE WORD, BY INDEX ────────────────────────────────────────────────
    // Both lanes resolve the word being said to an INDEX into the block's words; the page and the
    // panel's row are marked from the same index, so they can never disagree.
    function wordIndexAt(b, sIdx, charIndex) {
      var n = 0, k;
      for (k = 0; k < sIdx && k < b.sentences.length; k++) n += b.sentences[k].split(/\s+/).filter(Boolean).length;
      var head = b.sentences[sIdx] ? b.sentences[sIdx].slice(0, charIndex) : '';
      var before = head.split(/\s+/).filter(Boolean).length;
      if (head && !/\s$/.test(head)) before = Math.max(0, before - 1);
      return n + before;
    }
    // File mode has no boundary events, so the word is estimated by weight — a word's length plus a
    // bonus for the punctuation after it, which is what actually takes the time.
    function wordAtFraction(words, frac) {
      var total = 0, i, w = [];
      for (i = 0; i < words.length; i++) { w[i] = words[i].length + 1 + (/[.,;:!?—]$/.test(words[i]) ? 5 : 0); total += w[i]; }
      var want = clamp(frac, 0, 0.999999) * total, run = 0;
      for (i = 0; i < words.length; i++) { run += w[i]; if (run > want) return i; }
      return words.length - 1;
    }
    function markWordIndex(node, k) {
      clearWord();
      if (!node || k == null || k < 0) return;
      try {
        var walker = doc.createTreeWalker(node, global.NodeFilter.SHOW_TEXT, null), t, seen = 0;
        while ((t = walker.nextNode())) {
          if (t.parentNode && t.parentNode.closest && t.parentNode.closest('.dv-reader')) continue;
          var re = /\S+/g, m;
          while ((m = re.exec(t.nodeValue))) {
            if (seen === k) {
              var rng = doc.createRange();
              rng.setStart(t, m.index); rng.setEnd(t, m.index + m[0].length);
              var sp = el('span', 'dv-word');
              rng.surroundContents(sp);
              wordSpan = sp;
              return;
            }
            seen++;
          }
        }
      } catch (e) { wordSpan = null; }
    }
    function setWord(k) {
      if (k === wi) return;
      wi = k;
      markWordIndex(blocks[bi] && blocks[bi].node, k);
      markList();
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

    // ── the playlist ─────────────────────────────────────────────────────
    function buildList() {
      listEl.innerHTML = '';
      blocks.forEach(function (b, k) {
        var li = doc.createElement('li');
        li.dataset.k = k;
        li.innerHTML = '<span class="k">' + (k + 1) + '</span><span class="x"></span><span class="g">' + b.tag + '</span>';
        var x = li.querySelector('.x');
        b.words.forEach(function (w, i) {
          var sp = el('span', 'w'); sp.textContent = w; x.appendChild(sp);
          if (i < b.words.length - 1) x.appendChild(doc.createTextNode(' '));
        });
        li.title = b.text.slice(0, 220) + (b.text.length > 220 ? '…' : '');
        listEl.appendChild(li);
      });
    }
    listEl.addEventListener('click', function (e) {
      var li = e.target.closest && e.target.closest('li'); if (!li) return;
      if (btn.dataset.mute && !fileMode()) return;
      jumpTo(+li.dataset.k, true);
    });
    var lastMark = '';
    function markList() {
      var sig = bi + ':' + wi;
      if (sig === lastMark) return;
      lastMark = sig;
      [].forEach.call(listEl.children, function (li, k) {
        li.setAttribute('aria-current', k === bi ? 'true' : 'false');
        li.classList.toggle('done', k < bi);
      });
      var row = listEl.children[bi];
      if (row) {
        var ws = row.querySelectorAll('.w'), onEl = null;
        for (var i = 0; i < ws.length; i++) {
          ws[i].classList.toggle('on', i === wi);
          ws[i].classList.toggle('said', wi >= 0 && i < wi);
          if (i === wi) onEl = ws[i];
        }
        if (!pnl.hidden && !tlDrag) { try { (onEl || row).scrollIntoView({ block: 'nearest' }); } catch (e) {} }
      }
    }

    // ── the timeline ─────────────────────────────────────────────────────
    function elapsedSeconds() { return fileMode() && au ? partBefore(pi) + (au.currentTime || 0) : 0; }
    function fraction() {
      if (fileMode() && A && A.seconds) return clamp(elapsedSeconds() / A.seconds, 0, 1);
      return totalSent ? clamp(doneSent / totalSent, 0, 1) : 0;
    }
    function drawTicks() {
      tlTicks.innerHTML = '';
      var n = blocks.length;
      if (n < 2) return;
      var frag = doc.createDocumentFragment(), made = 0;
      if (fileMode() && A.seconds) {
        // measured: the second each block begins, across the parts
        var run = 0;
        A.parts.forEach(function (pt) {
          (pt.marks || []).forEach(function (mk) {
            if (made > 160) return;
            var pb = pageBlockOf(mk.block);
            if (pb < 0) return;
            var t = el('i', 'tick' + (/^h[1-4]$/.test(blocks[pb] && blocks[pb].tag) ? ' h' : ''));
            t.style.left = ((run + mk.at) / A.seconds * 100).toFixed(3) + '%';
            frag.appendChild(t); made++;
          });
          run += pt.seconds || 0;
        });
      } else {
        // live: no clock, so the ticks are sentence counts — where each block begins in the reading
        for (var k = 1; k < n && made < 160; k++) {
          var t2 = el('i', 'tick' + (/^h[1-4]$/.test(blocks[k].tag) ? ' h' : ''));
          t2.style.left = (sentBefore(k) / totalSent * 100).toFixed(3) + '%';
          frag.appendChild(t2); made++;
        }
      }
      tlTicks.appendChild(frag);
    }
    function paintTimeline(f) {
      var pct = (f * 100).toFixed(2) + '%';
      tlFill.style.width = pct; tlKnob.style.left = pct;
      tl.setAttribute('aria-valuenow', Math.round(f * 100));
      if (fileMode() && A) {
        tEl.textContent = mmss(f * A.seconds); tTot.textContent = mmss(A.seconds);
        tMid.textContent = 'block ' + (bi + 1) + ' / ' + blocks.length;
        tl.setAttribute('aria-valuetext', mmss(f * A.seconds) + ' of ' + mmss(A.seconds));
      } else {
        tEl.textContent = 'block ' + (bi + 1); tTot.textContent = blocks.length + ' blocks';
        tMid.textContent = totalSent ? Math.round(f * 100) + '%' : '';
        tl.setAttribute('aria-valuetext', 'block ' + (bi + 1) + ' of ' + blocks.length);
      }
    }
    // what a point on the track means, in the current lane
    function describeAt(f) {
      if (fileMode() && A) return mmss(f * A.seconds);
      var k = clamp(Math.floor(f * blocks.length), 0, blocks.length - 1);
      return 'block ' + (k + 1);
    }
    function seekFraction(f, andPlay) {
      f = clamp(f, 0, 1);
      if (fileMode() && A && A.seconds) {
        var want = f * A.seconds, run = 0;
        for (var k = 0; k < A.parts.length; k++) {
          var d = A.parts[k].seconds || 0;
          if (run + d > want || k === A.parts.length - 1) {
            var off = Math.max(0, Math.min(want - run, d - 0.25));
            var go = function () {
              try { au.currentTime = off; } catch (e) {}
              onTime();
              if (andPlay && !playing) { play(); }
            };
            if (k !== pi || !au || !au.src) loadPart(k, false).then(go); else go();
            return;
          }
          run += d;
        }
        return;
      }
      // live synthesis has no clock, so the fraction lands on a block
      jumpTo(clamp(Math.floor(f * blocks.length), 0, blocks.length - 1), andPlay);
    }
    var tlDrag = false;
    function tlFrac(e) {
      var r = tl.getBoundingClientRect();
      return clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    }
    tl.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      tlDrag = { was: playing, f: tlFrac(e) };
      tl.classList.add('drag');
      if (tl.setPointerCapture) { try { tl.setPointerCapture(e.pointerId); } catch (x) {} }
      paintTimeline(tlDrag.f);
      tlTip.style.left = (tlDrag.f * 100) + '%'; tlTip.textContent = describeAt(tlDrag.f);
      e.preventDefault();
    });
    tl.addEventListener('pointermove', function (e) {
      if (!tlDrag) return;
      tlDrag.f = tlFrac(e);
      paintTimeline(tlDrag.f);
      tlTip.style.left = (tlDrag.f * 100) + '%'; tlTip.textContent = describeAt(tlDrag.f);
    });
    function tlEnd(e) {
      if (!tlDrag) return;
      var f = tlDrag.f, was = tlDrag.was;
      tlDrag = false; tl.classList.remove('drag');
      seekFraction(f, was);
    }
    tl.addEventListener('pointerup', tlEnd);
    tl.addEventListener('pointercancel', tlEnd);
    tl.addEventListener('keydown', function (e) {
      var step = fileMode() ? (5 / Math.max(1, A.seconds)) : (1 / Math.max(1, blocks.length));
      var f = fraction();
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') f += step;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') f -= step;
      else if (e.key === 'Home') f = 0;
      else if (e.key === 'End') f = 0.999;
      else if (e.key === ' ' || e.key === 'Enter') { playing ? pause() : play(); e.preventDefault(); return; }
      else return;
      e.preventDefault();
      seekFraction(f, playing);
    });

    function progress() {
      if (!tlDrag) paintTimeline(fraction());
      title.textContent = playing && blocks[bi] ? blocks[bi].tag.toUpperCase() + ' · reading' : srcLabel;
      markList();
    }

    // ── the scope ────────────────────────────────────────────────────────
    // Built lazily from a gesture (an AudioContext made earlier is born suspended). Only file mode has
    // an element to tap; live mode draws the flat line and the label says why.
    var actx = null, gainNode = null, analyser = null, srcNode = null, deckVol = 1;
    var scopeRAF = 0, scopeBuf = null;
    function ensureGraph() {
      if (actx) return true;
      if (!fileMode()) return false;
      ensureAudio();
      if (!au) return false;
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      try {
        actx = new AC();
        srcNode = actx.createMediaElementSource(au);
        gainNode = actx.createGain(); gainNode.gain.value = deckVol;
        analyser = actx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.6;
        srcNode.connect(gainNode); gainNode.connect(analyser); analyser.connect(actx.destination);
        scopeBuf = new Uint8Array(analyser.fftSize);
      } catch (e) { actx = null; return false; }
      return true;
    }
    function scopeSize() {
      var r = scopeC.parentNode.getBoundingClientRect();
      var dpr = Math.min(2, global.devicePixelRatio || 1);
      var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (scopeC.width !== w || scopeC.height !== h) { scopeC.width = w; scopeC.height = h; }
      return { w: w, h: h, dpr: dpr };
    }
    function scopeFrame() {
      scopeRAF = 0;
      if (pnl.hidden) return;
      var g = scopeC.getContext('2d'); if (!g) return;
      var s = scopeSize(), w = s.w, h = s.h;
      g.clearRect(0, 0, w, h);
      // baseline
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
      var live = playing && fileMode() && analyser && !reduced;
      if (live) {
        analyser.getByteTimeDomainData(scopeBuf);
        var grad = g.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, 'rgb(34,211,238)'); grad.addColorStop(1, 'rgb(157,78,221)');
        g.strokeStyle = grad; g.lineWidth = Math.max(1, 1.25 * s.dpr);
        g.shadowColor = 'rgba(34,211,238,.45)'; g.shadowBlur = 4 * s.dpr;
        g.beginPath();
        var n = scopeBuf.length, step = w / (n - 1);
        for (var i = 0; i < n; i++) {
          var y = (scopeBuf[i] / 128 - 1) * (h * 0.46) + h / 2;
          if (i === 0) g.moveTo(0, y); else g.lineTo(i * step, y);
        }
        g.stroke();
        g.shadowBlur = 0;
        scopeRAF = global.requestAnimationFrame(scopeFrame);
      } else {
        g.strokeStyle = fileMode() ? 'rgba(34,211,238,.55)' : 'rgba(255,255,255,.22)';
        g.lineWidth = Math.max(1, 1 * s.dpr);
        g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
        if (playing && fileMode() && !analyser) scopeRAF = global.requestAnimationFrame(scopeFrame);
      }
    }
    function scopeStart() { if (!scopeRAF) scopeRAF = global.requestAnimationFrame(scopeFrame); }

    // Chrome pauses synthesis after ~15 s and does not resume on its own; nudging it is a harmless
    // no-op elsewhere.
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
        setWord(wordIndexAt(b, si, e.charIndex || 0));
      };
      u.onend = function () { if (cur !== u) return; step(); };
      u.onerror = function () { if (cur !== u) return; step(); };
      try { synth.speak(u); } catch (e) { finish(); }
      progress();
    }
    function step() { clearWord(); doneSent++; si++; progress(); say(); }
    function finish() { stop(); bi = 0; si = 0; doneSent = 0; if (au && fileMode()) { pi = 0; } progress(); }

    function play() {
      if (playing) return;
      if (!fileMode() && !liveCanSpeak()) return;
      playing = true; pnl.classList.add('playing');
      playB.innerHTML = '&#10073;&#10073;'; playB.title = 'pause';
      paintBtn();
      if (fileMode()) {
        ensureGraph();
        if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
        if (au.src) {
          au.play().then(function () { warmAll(); scopeStart(); clockStart(); }, function (err) {
            if (err && err.name === 'NotAllowedError') { refused(); return; }
            fallToLive('playback was refused');
          });
        } else {
          loadPart(pi, true).then(function () { scopeStart(); clockStart(); });
        }
        progress(); return;
      }
      guard(true);
      scopeStart();
      if (synth.paused && synth.speaking) { synth.resume(); progress(); return; }
      say();
    }
    function pause() {
      playing = false; pnl.classList.remove('playing');
      playB.innerHTML = '&#9654;'; playB.title = 'play';
      paintBtn();
      if (fileMode()) { try { au.pause(); } catch (e) {} progress(); scopeStart(); return; }
      guard(false);
      try { synth.pause(); } catch (e) {}
      progress(); scopeStart();
    }
    function stop() {
      playing = false; pnl.classList.remove('playing');
      playB.innerHTML = '&#9654;'; playB.title = 'play';
      if (fileMode() && au) { try { au.pause(); au.currentTime = 0; } catch (e) {} }
      guard(false);
      cur = null;
      try { if (hasSynth) synth.cancel(); } catch (e) {}
      unlight(); progress(); paintBtn(); scopeStart();
    }
    function jumpTo(n, andPlay) {
      var was = playing;
      bi = clamp(n, 0, blocks.length - 1);
      if (fileMode()) {
        var rb = renderBlockOf(bi);
        if (rb == null || rb < 0) { light(blocks[bi]); progress(); return; }   // this block was never recorded
        for (var k = 0; k < A.parts.length; k++) {
          var pt = A.parts[k];
          if (rb < pt.from || rb > pt.to) continue;
          var at = 0;
          for (var j = 0; j < pt.marks.length; j++) if (pt.marks[j].block <= rb) at = pt.marks[j].at;
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
      if (was || andPlay) { playing = false; play(); }
    }
    function jump(d) { jumpTo(bi + d); }

    // ── the panel's own controls ─────────────────────────────────────────
    var restored = false;
    function openPanel(open) {
      if (open === undefined) open = pnl.hidden;
      pnl.hidden = !open;
      btn.classList.toggle('on', open);
      btn.setAttribute('aria-expanded', String(open));
      if (open && !restored) { restored = true; try { panelRestore(); } catch (e) {} }
      if (open) { drawTicks(); progress(); scopeStart(); }
      return open;
    }
    btn.addEventListener('click', function () {
      if (playing) { stop(); return; }               // READING? THEN THIS IS STOP.
      openPanel(true);
      if (btn.dataset.mute && !fileMode()) {
        title.textContent = 'no voice on this platform';
        scopeL.textContent = 'no voices installed';
        return;
      }
      if (!playing) play();                            // one gesture: open AND read
    });

    pnl.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button'); if (!b || !b.dataset.a) return;
      var a = b.dataset.a;
      if (a === 'play') { playing ? pause() : play(); }
      else if (a === 'prev') jump(-1);
      else if (a === 'next') jump(1);
      else if (a === 'stop') finish();
      else if (a === 'dl') { if (A && global.DVDocAudio && dl.getAttribute('aria-disabled') !== 'true') DVDocAudio.download(A); }
      else if (a === 'shade') { pnl.classList.toggle('shaded'); b.innerHTML = pnl.classList.contains('shaded') ? '&#9633;' : '&#9472;'; panelSave(); }
      else if (a === 'close') openPanel(false);
    });

    // CHANGING VOICE CONTINUES FROM WHERE YOU WERE. The position is carried as a fraction of the
    // whole, because the voices differ in pace and a timestamp does not survive the crossing. The old
    // audio keeps playing until the new manifest is in hand.
    sel.addEventListener('change', function () {
      state.voice = sel.value;
      var was = playing, f = fraction();
      lookForAudio().then(function () {
        if (fileMode() || liveCanSpeak()) delete btn.dataset.mute; else btn.dataset.mute = '1';
        stop();
        seekFraction(f, was);
        paintBtn();
      });
    });
    rate.addEventListener('input', function () {
      state.rate = +rate.value;
      rateVal.textContent = '×' + state.rate.toFixed(2);
      if (fileMode() && au) { try { au.playbackRate = state.rate; } catch (e) {} }
    });
    rate.addEventListener('change', function () {
      save();
      if (fileMode()) return;                    // the element took the new rate live
      if (playing) { var b = bi, s = si, d = doneSent; stop(); bi = b; si = s; doneSent = d; play(); }
      else progress();
    });

    // ── WHERE YOU PUT IT, AND HOW BIG YOU MADE IT ────────────────────────
    // Two traps, both fallen into once: never save while hidden (a hidden panel measures 0x0), and
    // clamp against the panel rather than a constant (or it can be parked with only a title bar
    // reachable).
    function panelSave() {
      if (pnl.hidden) return;
      var r = pnl.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) return;
      try {
        global.localStorage.setItem(PKEY, JSON.stringify({
          left: Math.round(r.left), top: Math.round(r.top),
          w: Math.round(r.width), h: pnl.classList.contains('shaded') ? 0 : Math.round(r.height),
          shaded: pnl.classList.contains('shaded') ? 1 : 0,
          docked: pnl.style.left ? 0 : 1
        }));
      } catch (e) {}
    }
    function panelRestore() {
      var v = null;
      try { v = JSON.parse(global.localStorage.getItem(PKEY) || 'null'); } catch (e) {}
      if (!v) return;
      var vw = global.innerWidth, vh = global.innerHeight;
      if (vw <= 520) return;                       // phones: the stylesheet lays it out
      var w = clamp(+v.w || 332, 280, Math.round(vw * 0.96));
      var h = clamp(+v.h || 0, 0, Math.round(vh * 0.88));
      pnl.style.width = w + 'px';
      if (h > 120) pnl.style.height = h + 'px';
      if (v.shaded) { pnl.classList.add('shaded'); var sb = pnl.querySelector('[data-a="shade"]'); if (sb) sb.innerHTML = '&#9633;'; }
      if (v.docked) { pnl.style.left = pnl.style.top = ''; pnl.style.right = '18px'; pnl.style.bottom = '18px'; return; }
      pnl.style.left = clamp(+v.left || 0, 0, Math.max(0, vw - w)) + 'px';
      pnl.style.top = clamp(+v.top || 0, 0, Math.max(0, vh - Math.min(h || 140, vh - 40))) + 'px';
      pnl.style.right = 'auto'; pnl.style.bottom = 'auto';
    }
    function dock() {
      pnl.style.left = pnl.style.top = ''; pnl.style.right = '18px'; pnl.style.bottom = '18px';
      panelSave();
    }
    if (typeof global.ResizeObserver !== 'undefined') {
      var rzT = 0;
      new global.ResizeObserver(function () { clearTimeout(rzT); rzT = setTimeout(function () { panelSave(); scopeStart(); }, 220); }).observe(pnl);
    }
    global.addEventListener('resize', function () { if (!pnl.hidden) { panelRestore(); scopeStart(); } });

    // DRAG FROM ANYWHERE THAT IS NOT A CONTROL. The header is the obvious grip and says so, but the
    // panel is small and a reader whose article is behind it should be able to take hold of any
    // quiet part of it — the scope, the times, a gap — and move it out of the way.
    var drag = null;
    function dragTarget(e) {
      var t = e.target;
      if (!t || !t.closest) return false;
      if (t.closest('button,select,input,a,li,.dvr-tl,.dvr-list,#listen-deck,.dvr-cache')) return false;
      return !!t.closest('.dv-reader-panel');
    }
    pnl.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      if (!dragTarget(e)) return;
      var r = pnl.getBoundingClientRect();
      // the resize corner belongs to the browser
      if (e.clientX > r.right - 18 && e.clientY > r.bottom - 18) return;
      pnl.style.left = r.left + 'px'; pnl.style.top = r.top + 'px';
      pnl.style.right = 'auto'; pnl.style.bottom = 'auto';
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
      pnl.classList.add('moving');
      if (pnl.setPointerCapture) { try { pnl.setPointerCapture(e.pointerId); } catch (x) {} }
      e.preventDefault();
    });
    pnl.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.moved = true;
      pnl.style.left = clamp(e.clientX - drag.dx, 0, Math.max(0, global.innerWidth - pnl.offsetWidth)) + 'px';
      pnl.style.top = clamp(e.clientY - drag.dy, 0, Math.max(0, global.innerHeight - 44)) + 'px';
    });
    function endDrag() { if (drag) { drag = null; pnl.classList.remove('moving'); panelSave(); } }
    pnl.addEventListener('pointerup', endDrag);
    pnl.addEventListener('pointercancel', endDrag);
    hd.addEventListener('dblclick', function (e) { if (e.target.tagName !== 'BUTTON') dock(); });

    // a page left mid-sentence must not keep talking to an empty room
    global.addEventListener('beforeunload', function () { try { if (hasSynth) synth.cancel(); } catch (e) {} });
    doc.addEventListener('visibilitychange', function () { if (doc.hidden && playing && !fileMode()) pause(); });

    // ── THE AUDIO DECK CONTRACT ──────────────────────────────────────────
    // The dreamknob rack owns no state: it reads window.listenState() and writes back through these
    // globals, then re-reads on "mindx:listen". The panel works with the rack never loaded.
    function emit() { try { global.dispatchEvent(new global.Event('mindx:listen')); } catch (e) {} }
    global.listenState = function () {
      return {
        playing: playing, ready: fileMode() || liveCanSpeak(),
        mode: fileMode() ? 'file' : 'live',
        part: fileMode() ? pi + 1 : bi + 1,
        parts: fileMode() && A ? A.parts.length : blocks.length,
        vol: deckVol, rate: state.rate, voice: state.voice,
        voices: pinned ? [] : DVVoices.list().map(function (v) { return { id: v.id, label: v.name }; }),
        analyser: analyser, ensureAudio: ensureGraph
      };
    };
    global.listenVol = function (v) {
      deckVol = clamp(+v || 0, 0, 4);
      if (deckVol <= 1 && !actx) { if (au) au.volume = deckVol; }
      else if (ensureGraph()) { if (au) au.volume = 1; gainNode.gain.value = deckVol; }
      else if (au) { au.volume = Math.min(deckVol, 1); }
      emit();
    };
    global.listenSpeed = function (v) {
      rate.value = clamp(+v || 1, 0.6, 1.6);
      state.rate = +rate.value; rateVal.textContent = '×' + state.rate.toFixed(2);
      save();
      if (fileMode() && au) { try { au.playbackRate = state.rate; } catch (e) {} }
      emit();
    };
    global.listenVoice = function (id) {
      if (pinned || !id || id === state.voice) return;
      sel.value = id; sel.dispatchEvent(new global.Event('change')); emit();
    };
    global.listenToggle = function () { if (playing) pause(); else play(); emit(); };

    // ── AUTOSTART, WITH A BUFFER AND WITHOUT PRETENDING ──────────────────
    // A browser will not start audio without a gesture unless the site has a media history; the
    // attempt is made, and a refusal leaves the panel open, buffered and one press from reading.
    var AUTOSTART_BUFFER = 6, AUTOSTART_DEADLINE = 9000;
    function autostart() {
      try { if (new global.URLSearchParams(global.location.search).get('autoplay') === '0') return; } catch (e) {}
      if (!A || !A.parts || !A.parts.length) return;
      ensureAudio();
      if (!au) return;
      openPanel(true);
      var started = false, t0 = Date.now();
      function buffered() {
        try { return au.buffered && au.buffered.length ? au.buffered.end(au.buffered.length - 1) - (au.currentTime || 0) : 0; }
        catch (e) { return 0; }
      }
      var iv = setInterval(function () {
        if (started) return;
        if (buffered() >= AUTOSTART_BUFFER || au.readyState >= 4 || Date.now() - t0 > AUTOSTART_DEADLINE) {
          started = true; clearInterval(iv);
          playing = false; play();
        }
      }, 250);
      loadPart(0, false);
    }

    // The button is shown from the start — LISTEN is the point — but it must never pretend: a platform
    // with the API and no voices drops every utterance in silence, so there it says so. A rendered
    // page still plays there, because that is an ordinary audio file.
    btn.title = 'looking for audio…';
    Promise.all([DVVoices.ready(), lookForAudio()]).then(function () {
      buildList();
      fillVoices();
      drawTicks();
      if (fileMode()) {
        btn.title = 'Open the player — this page is rendered, so it starts instantly and can be downloaded';
        if (opts.autostart) autostart();
        return;
      }
      if (!liveCanSpeak()) {
        btn.dataset.mute = '1';
        paintBtn();
        btn.title = 'This browser has a speech synthesiser but no installed voices, and this page has no rendered ' +
          'audio in this voice, so nothing can be spoken here. On Linux: install speech-dispatcher and a voice such ' +
          'as espeak-ng. On macOS, iOS, Windows and Android voices ship with the system.';
        if (opts.onUnavailable) { try { opts.onUnavailable(btn); } catch (e) {} }
        return;
      }
      btn.title = 'Open the player and read this page aloud';
    });
    function lookForAudio() {
      if (!global.DVDocAudio) { adoptManifest(null); return Promise.resolve(); }
      return DVDocAudio.manifest(docId, state.voice).then(adoptManifest).catch(function () { adoptManifest(null); });
    }
    progress();

    return {
      el: pnl, button: btn, blocks: blocks,
      play: play, pause: pause, stop: finish,
      next: function () { jump(1); }, prev: function () { jump(-1); },
      seek: function (f) { seekFraction(f, playing); },
      voice: function (id) { if (!pinned && id && id !== state.voice) { sel.value = id; sel.dispatchEvent(new global.Event('change')); } return state.voice; },
      open: openPanel, dock: dock,
      // THE RENDER MAY ARRIVE WHILE THE PAGE IS OPEN. adopt(m) takes a manifest in the store's shape
      // and moves the reader into file mode on it (a live reading in progress is paused, then resumed
      // on the file); append(parts) adds parts to the manifest already adopted — the way a chained
      // render lands clip by clip — without disturbing the part that is playing: the element's own
      // 'ended' moves on to the next part, and the ticks and total are redrawn.
      adopt: function (m) {
        if (!m || !m.parts || !m.parts.length) return false;
        var was = playing && !fileMode();
        if (was) pause();
        adoptManifest(m);
        if (!fileMode()) return false;
        if (was) play();
        drawTicks(); progress();
        return true;
      },
      append: function (parts) {
        if (!A || !parts || !parts.length) return false;
        parts.forEach(function (p) { if (p && p.url && p.marks) A.parts.push(p); });
        A.seconds = A.parts.reduce(function (a, p) { return a + (p.seconds || 0); }, 0);
        A.blocks = Math.max(A.blocks | 0, A.parts.reduce(function (a, p) { return Math.max(a, (p.to | 0) + 1); }, 0));
        if (A.bytes != null) A.bytes = A.parts.reduce(function (a, p) { return a + (p.bytes || 0); }, 0);
        warmed = false; warmAll();
        drawTicks(); progress();
        return true;
      },
      manifest: function () { return A; },
      mode: function () { return fileMode() ? 'file' : 'live'; },
      destroy: function () { stop(); pnl.remove(); btn.remove(); }
    };
  }

  var DV = { mount: mount, collect: collect, sentences: sentences, fingerprint: fingerprint, version: '2.2.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = DV;
  global.DVDocReader = DV;
})(typeof window !== 'undefined' ? window : this);
