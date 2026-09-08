/*!
 * wordpress.reader — doc.player, running INSIDE WordPress.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A FETCHER.
 *
 * doc.player can already read a pasted URL: it fetches the page, parses it in an
 * inert document and speaks the text. That works for any host willing to be read
 * by another origin. A typical WordPress install is not:
 *
 *   $ curl -H 'Origin: https://deltaverse.pythai.net' https://rage.pythai.net/
 *   HTTP/2 403          <- the host's WAF refuses anything that is not a browser
 *   (no access-control-allow-origin header at all)
 *
 * Two independent walls, either of which is fatal on its own. The WAF answers 403
 * to a non-browser client — measured from two different networks, so it is the
 * host and not a firewall rule about one address. And even where the WAF lets a
 * request through, the response carries no `Access-Control-Allow-Origin`, so the
 * browser discards it before the page ever sees a byte.
 *
 * You cannot fix that from the outside, and you should not try: the fix would be
 * a server that fetches any URL it is handed, which is an open relay into
 * everything it can reach.
 *
 * So the reader moves. It runs ON the site, reading the article it is already
 * inside. Same origin, so there is nothing to fetch, no CORS to negotiate and no
 * WAF in the path — the text is in the DOM, which is where a reader should be
 * looking anyway.
 *
 * INSTALLING IT ON WORDPRESS. The plugin (wordpress/plugin/) is the ordinary
 * route: upload the zip, activate, and every article has LISTEN beside its
 * headline. The no-install route is the same scripts in a custom_html widget
 * in a footer region -- NOT in post content: WordPress runs `wpautop` over post
 * bodies and that mangles <script>. One widget, sitewide:
 *
 *   <script src="https://deltaverse.pythai.net/engine/ngn/voices.js"></script>
 *   <script src="https://deltaverse.pythai.net/engine/ngn/doc-reader.js"></script>
 *   <script src="https://deltaverse.pythai.net/engine/ngn/doc-audio.js"></script>
 *   <script src="https://deltaverse.pythai.net/engine/ngn/wordpress-reader.js"></script>
 *
 * It is inert on anything that is not a single article, and it degrades to
 * nothing if the synthesiser is missing.
 *
 * WHERE THE BUTTON LANDS. Beside the headline by default. `WPReader.place` may
 * say 'top' (a row above the article text) or 'bottom' (a row below it). A
 * `<span class="wp-reader-listen">` anywhere in the article -- which is what
 * the plugin's [listen] shortcode prints -- wins over all of that: the button
 * is moved into the slot, and if the slot carries data-share, SHARE goes with
 * it.
 *
 * TWO WAYS TO CONFIGURE IT. The plugin (wordpress-reader.php) knows things this
 * file can only guess: which post this is, where its content element is, and
 * whether anything has been rendered for it. It sets `window.WPReader` before
 * this loads and the guessing is skipped entirely. Without the plugin the script
 * still works by inspection, which is what the plain widget install does.
 *
 * TRYING IT ON ONE ARTICLE FIRST. The widget is site-wide -- that is the whole
 * point of it -- but the first install of anything on somebody's live site
 * should not be site-wide. Declare an allowlist of post ids BEFORE the script
 * loads and it boots on those and stays inert everywhere else:
 *
 *   <script>window.WP_READER_ONLY = [1493];</script>
 *
 * Delete that line to go site-wide. The default, with nothing declared, is
 * every single article -- the allowlist is an opt-in restriction, not a
 * requirement, so forgetting it cannot silently disable the reader.
 *
 * SHARING, FROM THE IMAGE. Beside LISTEN there is SHARE, and the featured image
 * carries the same control in its corner. Both share what a share actually
 * shows: the page's own card -- og:title, og:description and og:image, read from
 * the <head> the site already emits, so the preview a reader is handed is the
 * preview the network will render. On a device with the Web Share API the
 * image file travels with the link (navigator.share with files); everywhere
 * else a small menu offers X, Facebook, LinkedIn, Reddit, Pinterest (the one
 * network that shares an image rather than a link), Telegram, WhatsApp, email,
 * copy-link and save-image, with the card previewed above them.
 *
 *   window.WPReader = { share: true }        // default: button + image corner
 *   window.WPReader = { share: 'title' }     // headline button only
 *   window.WPReader = { share: 'image' }     // image corner only
 *   window.WPReader = { share: false }       // off
 *   window.WPReader = { shareImage: 'https://.../card.jpg' }  // override the card
 *
 * Nothing is sent anywhere by this script: every route above is a link the
 * visitor opens, or the browser's own share sheet.
 *
 * v0.0.1alpha (engine 1.3.0) — THE VOICE IS YOURS TO CHOOSE, AND CHOOSING RENDERS. The reader
 * used to pin one voice and hide the chooser. Now the VOICE row is on by default and a pick does
 * the obvious thing: if the render host holds this article in that voice, the file is attached;
 * if it does not, the article's own blocks are posted to the host and rendered — as a chain of
 * clips, the first within seconds, the rest landing as parts while the first plays. The host keys
 * renders by text and voice, so this happens once per article per voice, ever, for all readers.
 *
 *   window.WPReader = {
 *     chooser: true,                 // the VOICE row (default on; false pins the site's voice)
 *     autorender: true,              // a pick with nothing held renders it (default on)
 *     anticipate: true,              // clip 1 of the default voice renders when the page opens
 *     renderHost: 'https://deltaverse.pythai.net',   // the docsplayer that renders and stores
 *     engine: 'https://deltaverse.pythai.net/engine/ngn',   // where listen_gloss.js is fetched
 *     gloss: true                    // the GLOSS button: a semi-transparent diagnostics panel
 *   }
 *
 * ANCIENT IS THE CLIENT LANE. Pick it and the browser's own synthesiser reads the article on the
 * device's CPU and RAM; nothing is posted anywhere. The gloss says whether the platform voice is
 * on-device or a network voice, because that claim is only true when it is.
 *
 * PRESETS, THE HERO BUTTON, THE PLAY MENU AND PYTHIA (engine 1.4.0).
 *
 *   window.WPReader = { preset: 'jaimla' }            // or { preset: { '1165': 'jaimla', default: 'neural' } }
 *
 * The jaimla preset is the original article played back in the realm's female voice with the
 * DeltaVerse substrate under it: a band above the text where the DELTAVERSE wordmark is
 * triangulated and breathes with the audio that is actually playing (the reader's own analyser,
 * four bands, level and inflection — never a demo tide while a file plays). The hero LISTEN button
 * is the same button doc-reader mounts, dressed: a sub-line that says which voice and whether the
 * file is held (immediate) or renders on press, a level bar inside it while playing, full width on
 * a phone. Press it and it plays. PRESS AND HOLD it (half a second) and the play menu opens: the
 * cast, ANCIENT (this device), PYTHIA, the substrate switch and the gloss.
 *
 * PYTHIA is the voice of the oracle — jaimla and ANCIENT combined. The rendered jaimla file plays
 * through an oracle chamber (a Web Audio delay with feedback, tapped from the reader's analyser so
 * the dry path is untouched) and the device's own ANCIENT voice repeats the opening of each block a
 * beat behind her, from this CPU. Nothing about it is a new model: it is two voices the reader
 * already has, arranged. Where the browser cannot synthesise, PYTHIA is jaimla in the chamber alone
 * and the menu says so.
 *
 * WHAT IS NOT PROMISED. A render is the host's work at its own pace (about 2.4× realtime for the
 * neural voices on the box that serves these pages); the reader starts in the browser's voice the
 * moment LISTEN is pressed and moves onto the rendered file when the first clip lands, which can
 * put the reading back to the top of that clip. The gloss shows the host's ledger while it works.
 */
(function (global) {
  'use strict';
  var doc = global.document;

  // What the plugin tells us, and what we fall back to without it. Every field is
  // optional: a missing one means "work it out", which is exactly the pre-plugin
  // behaviour, so an install that sets nothing is not a broken install.
  var CFG = global.WPReader || {};
  function cfg(k, dflt) { return (CFG[k] === undefined || CFG[k] === '') ? dflt : CFG[k]; }

  // THE THEME IS NOT KNOWN IN ADVANCE. WordPress themes agree on very little, so
  // the content element is found by trying what themes actually use, in order of
  // how specific each selector is. The last two are desperate but still bounded.
  var CONTENT = [
    '.entry-content', '.post-content', '.article-content', '.single-post-content',
    '.wp-block-post-content', '.td-post-content', '.elementor-widget-theme-post-content',
    'article .content', 'main article', 'article'
  ];
  var TITLE = [
    'h1.entry-title', '.entry-title', 'h1.post-title', '.wp-block-post-title',
    'article h1', 'main h1', 'h1'
  ];
  // Everything a WordPress page hangs around an article that is not the article.
  var NOISE = [
    '.sharedaddy', '.jp-relatedposts', '.wp-block-post-comments', '#comments',
    '.comments-area', '.related-posts', '.author-bio', '.post-navigation',
    '.wp-block-latest-posts', '.widget', 'aside', 'nav', 'footer',
    '.addtoany_share_save_container', '.code-block', '.adsbygoogle',
    // Signature and provenance blocks, which sit INSIDE the content rather than
    // around it and so are not caught by anything above. The first real install
    // read a cryptographic identity footer aloud -- a wallet address, a public
    // key and a list of domains, spoken one character class at a time -- because
    // it was the last child of .entry-content and looked exactly like prose.
    '.mindx-author-identity', '.author-identity', '.post-signature',
    // the editor's scorecard is a figure of dials and a table of numbers — a measurement to look at, not prose to hear
    '.mindx-scorecard', '.mindx-scorecard-table',
    '.copyright-footer', '.site-footer', '.entry-footer', '.wp-block-post-terms'
  ];

  // A selector the plugin supplied is tried first and the guesses stay behind it.
  // The list is not replaced: a theme can be updated out from under a stored
  // setting, and falling back to the guesses is better than falling back to
  // nothing.
  function selectors(name, guesses) {
    var given = cfg(name, '');
    return given ? [given].concat(guesses) : guesses;
  }

  function first(sels, root) {
    for (var i = 0; i < sels.length; i++) {
      var el = (root || doc).querySelector(sels[i]);
      if (el) return el;
    }
    return null;
  }

  // Is this a single article, or a listing? A listing has many article elements
  // and reading it aloud would be reading a table of contents.
  function isSingle() {
    if (doc.body && /(^|\s)single(-|\s|$)/.test(doc.body.className)) return true;
    if (doc.body && /(^|\s)(home|blog|archive|search|category|tag)(-|\s|$)/.test(doc.body.className)) return false;
    return doc.querySelectorAll('article').length <= 1;
  }

  function prune(root) {
    // Mark the furniture instead of removing it: doc.player already honours
    // [data-noread], and a reader has no business deleting someone's page.
    NOISE.forEach(function (sel) {
      var nodes = root.querySelectorAll(sel);
      for (var i = 0; i < nodes.length; i++) nodes[i].setAttribute('data-noread', '1');
    });
  }

  // Which post is this? WordPress puts it on the body as `postid-N` on single
  // articles; there is nothing to read on a page that has no such class.
  function postId() {
    if (cfg('post', 0)) return String(CFG.post);
    var m = (doc.body && doc.body.className || '').match(/postid-(\d+)/);
    return m ? m[1] : null;
  }

  // An allowlist restricts the reader to named posts. Absent or empty means no
  // restriction, so the ordinary site-wide install needs no configuration.
  function allowed() {
    var only = cfg('only', global.WP_READER_ONLY);
    if (!only || !only.length) return true;
    var id = postId();
    if (!id) return false;
    for (var i = 0; i < only.length; i++) {
      if (String(only[i]) === id) return true;
    }
    return false;
  }

  // ── SHARE ──────────────────────────────────────────────────────────────
  // The card is whatever the page already declares for the networks. Reading
  // it from <head> means the button can never disagree with a share pasted by
  // hand: same title, same description, same image.
  var FEATURED = [
    '.entry-thumb', '.post-thumbnail', '.wp-block-post-featured-image', 'figure.featured-image',
    '.featured-image', '.single-featured-image', '.td-post-featured-image', 'article > figure',
    '.entry-content figure.wp-block-image'
  ];
  function meta(name) {
    var m = doc.querySelector('meta[property="' + name + '"]') || doc.querySelector('meta[name="' + name + '"]');
    return m ? (m.getAttribute('content') || '') : '';
  }
  function featuredFigure() {
    for (var i = 0; i < FEATURED.length; i++) {
      var f = doc.querySelector(FEATURED[i]);
      if (f && f.querySelector('img')) return f;
    }
    return null;
  }
  function shareInfo() {
    var canon = doc.querySelector('link[rel="canonical"]');
    var fig = featuredFigure();
    var img = fig ? fig.querySelector('img') : null;
    return {
      url: (canon && canon.href) || meta('og:url') || global.location.href,
      title: meta('og:title') || (doc.title || '').split('|')[0].split(' - ')[0].trim(),
      text: meta('og:description') || meta('description') || '',
      image: cfg('shareImage', '') || meta('og:image') || (img && (img.currentSrc || img.src)) || ''
    };
  }
  function shareMode() {
    var v = cfg('share', true);
    if (v === false || v === 0 || v === '0' || v === 'off' || v === 'false' || v === 'none') return '';
    if (v === 'title' || v === 'image' || v === 'both') return v;
    return 'both';
  }

  var SHARE_CSS_ID = 'dv-share-css';
  var SHARE_CSS = [
    '.dv-share{display:inline-flex;align-items:center;gap:.5em;margin-left:.5em;vertical-align:middle;',
    '  font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;font-weight:600;letter-spacing:.18em;',
    '  padding:7px 15px;border-radius:8px;cursor:pointer;background:rgba(var(--am,255,176,84),.10);',
    '  color:rgb(var(--am,255,176,84));border:1px solid rgba(var(--am,255,176,84),.34);',
    '  transition:background .2s,border-color .2s,box-shadow .2s}',
    '.dv-share:hover,.dv-share[aria-expanded="true"]{background:rgba(var(--am,255,176,84),.16);border-color:rgb(var(--am,255,176,84));',
    '  box-shadow:0 0 18px rgba(var(--am,255,176,84),.25)}',
    '.dv-share .i{font-size:11px;line-height:1}',
    '.dv-share:focus-visible{outline:2px solid rgb(var(--am,255,176,84));outline-offset:3px}',
    // the corner of the featured image: the image is the thing being shared, so
    // the control sits on it rather than somewhere near it
    '.dv-share-host{position:relative}',
    '.dv-share-img{position:absolute;right:10px;bottom:10px;z-index:5;margin:0;',
    '  background:rgba(6,8,16,.82);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);',
    '  box-shadow:0 4px 18px rgba(0,0,0,.45)}',
    '.dv-share-img:hover{background:rgba(6,8,16,.95)}',
    // the menu
    '.dv-share-menu{position:absolute;z-index:2147482001;width:300px;max-width:92vw;',
    '  font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);color:rgba(255,255,255,.82);',
    '  background:rgba(6,8,16,.96);border:1px solid rgba(var(--am,255,176,84),.34);border-radius:12px;',
    '  box-shadow:0 22px 60px rgba(0,0,0,.55);padding:10px;text-align:left}',
    '.dv-share-menu[hidden]{display:none}',
    '.dv-share-card{display:block;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.10);',
    '  background:#0b0f1a;text-decoration:none;color:inherit}',
    '.dv-share-card img{display:block;width:100%;height:auto;aspect-ratio:1.91/1;object-fit:cover}',
    '.dv-share-card b{display:block;padding:8px 10px 2px;font-size:11.5px;line-height:1.35;color:#fff}',
    // margin, not padding: padding inside a line-clamped box lets a third line peek
    '.dv-share-card span{display:-webkit-box;margin:0 10px 9px;padding:0;font-size:10px;line-height:1.45;',
    '  color:rgba(255,255,255,.55);overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
    '.dv-share-k{margin:9px 2px 5px;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.42)}',
    '.dv-share-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}',
    '.dv-share-grid a,.dv-share-grid button{appearance:none;font:inherit;font-size:10.5px;letter-spacing:.04em;cursor:pointer;',
    '  display:flex;align-items:center;justify-content:center;gap:5px;padding:8px 6px;border-radius:7px;',
    '  color:rgba(255,255,255,.8);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14);text-decoration:none;',
    '  transition:color .2s,border-color .2s,background .2s}',
    '.dv-share-grid a:hover,.dv-share-grid button:hover{color:#fff;border-color:rgba(var(--am,255,176,84),.7);background:rgba(var(--am,255,176,84),.12)}',
    '.dv-share-grid .ok{color:rgb(var(--cy,34,211,238));border-color:rgba(var(--cy,34,211,238),.6)}',
    '@media (max-width:520px){.dv-share-menu{left:10px!important;right:10px;width:auto}}'
  ].join('');
  function ensureShareCss() {
    if (doc.getElementById(SHARE_CSS_ID)) return;
    var s = doc.createElement('style'); s.id = SHARE_CSS_ID; s.textContent = SHARE_CSS; doc.head.appendChild(s);
  }

  function enc(v) { return encodeURIComponent(v || ''); }
  function routes(s) {
    var t = s.title, u = s.url, x = s.text, m = s.image;
    var r = [
      ['X', 'https://twitter.com/intent/tweet?url=' + enc(u) + '&text=' + enc(t)],
      ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + enc(u)],
      ['LinkedIn', 'https://www.linkedin.com/sharing/share-offsite/?url=' + enc(u)],
      ['Reddit', 'https://www.reddit.com/submit?url=' + enc(u) + '&title=' + enc(t)],
      ['Telegram', 'https://t.me/share/url?url=' + enc(u) + '&text=' + enc(t)],
      ['WhatsApp', 'https://wa.me/?text=' + enc(t + ' ' + u)],
      ['Email', 'mailto:?subject=' + enc(t) + '&body=' + enc((x ? x + '\n\n' : '') + u)]
    ];
    // Pinterest is the one network that pins the IMAGE and links back to the
    // page, which is exactly "share from the image"; it is offered only when
    // there is an image to pin.
    if (m) r.splice(4, 0, ['Pinterest', 'https://pinterest.com/pin/create/button/?url=' + enc(u) + '&media=' + enc(m) + '&description=' + enc(t)]);
    return r;
  }

  var menuEl = null, menuOwner = null;
  function closeMenu() {
    if (!menuEl) return;
    menuEl.hidden = true;
    if (menuOwner) menuOwner.setAttribute('aria-expanded', 'false');
    menuOwner = null;
  }
  function buildMenu(s) {
    var m = doc.createElement('div');
    m.className = 'dv-share-menu'; m.id = 'dv-share-menu'; m.hidden = true;
    m.setAttribute('data-noread', '1'); m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Share this article');
    var card = '<a class="dv-share-card" href="' + s.url + '" target="_blank" rel="noopener">' +
      (s.image ? '<img src="' + s.image + '" alt="">' : '') +
      '<b></b><span></span></a>';
    var grid = '<div class="dv-share-k">share this card</div><div class="dv-share-grid">' +
      routes(s).map(function (r) {
        return '<a href="' + r[1] + '" target="_blank" rel="noopener noreferrer">' + r[0] + '</a>';
      }).join('') +
      '<button type="button" data-a="copy">Copy link</button>' +
      (s.image ? '<a href="' + s.image + '" download data-a="save">Save image</a>' : '') +
      '</div>';
    m.innerHTML = card + grid;
    m.querySelector('.dv-share-card b').textContent = s.title;
    m.querySelector('.dv-share-card span').textContent = s.text;
    m.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-a="copy"]') : null;
      if (!b) return;
      e.preventDefault();
      var done = function () { b.textContent = 'Copied'; b.className = 'ok'; setTimeout(function () { b.textContent = 'Copy link'; b.className = ''; }, 1600); };
      if (global.navigator.clipboard && global.navigator.clipboard.writeText) global.navigator.clipboard.writeText(s.url).then(done, function () {});
      else { global.prompt('Copy this link', s.url); }
    });
    doc.body.appendChild(m);
    doc.addEventListener('click', function (e) {
      if (!menuEl || menuEl.hidden) return;
      if (menuEl.contains(e.target) || (menuOwner && menuOwner.contains(e.target))) return;
      closeMenu();
    });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
    return m;
  }
  function openMenu(btn, s) {
    ensureShareCss();
    if (!menuEl) menuEl = buildMenu(s);
    if (menuOwner === btn && !menuEl.hidden) { closeMenu(); return; }
    closeMenu();
    menuOwner = btn; btn.setAttribute('aria-expanded', 'true');
    menuEl.hidden = false;
    var r = btn.getBoundingClientRect(), vw = doc.documentElement.clientWidth;
    var left = Math.max(10, Math.min(r.left + global.scrollX, global.scrollX + vw - menuEl.offsetWidth - 10));
    menuEl.style.left = left + 'px';
    menuEl.style.top = (r.bottom + global.scrollY + 8) + 'px';
  }

  // The native sheet gets the image as a file when the platform can take one:
  // that is what makes a share from a phone carry the picture rather than a
  // link that has to be unfurled. Everything that cannot do that gets the menu.
  function nativeShare(s) {
    var nav = global.navigator;
    if (!nav || !nav.share) return Promise.reject(new Error('no-share'));
    var plain = { title: s.title, text: s.text, url: s.url };
    if (!s.image || !nav.canShare || !global.fetch || !global.File) return nav.share(plain);
    return global.fetch(s.image, { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('img');
      return r.blob();
    }).then(function (b) {
      var name = (s.image.split('/').pop() || 'card.jpg').split('?')[0];
      var f = new global.File([b], name, { type: b.type || 'image/jpeg' });
      var withFile = { title: s.title, text: s.text, url: s.url, files: [f] };
      return nav.canShare(withFile) ? nav.share(withFile) : nav.share(plain);
    }, function () { return nav.share(plain); });
  }
  function doShare(btn) {
    var s = shareInfo();
    nativeShare(s).then(function () {}, function (err) {
      // AbortError is the visitor closing the sheet; that is not a failure to
      // fall back from. Anything else -- no API, or a platform that refuses --
      // gets the menu, which always works.
      if (err && err.name === 'AbortError') return;
      openMenu(btn, s);
    });
  }
  function shareButton(cls, label) {
    var b = doc.createElement('button');
    b.type = 'button'; b.className = 'dv-share' + (cls ? ' ' + cls : '');
    b.setAttribute('data-noread', '1'); b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false');
    b.title = 'Share this article with its image';
    b.innerHTML = '<span class="i">&#8679;</span>' + (label || 'SHARE');
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); doShare(b); });
    return b;
  }
  function bootShare() {
    var mode = shareMode();
    if (!mode) return;
    if (!isSingle() || !allowed()) return;
    if (doc.getElementById('dv-share-btn')) return;
    ensureShareCss();
    if (mode === 'both' || mode === 'title') {
      var s = slot(), listen = doc.getElementById('dv-listen-btn');
      var host = (s && s.getAttribute('data-share')) ? s
        : (listen && listen.parentNode && !s) ? listen.parentNode
        : first(selectors('title', TITLE));
      if (host) { var b = shareButton('', 'SHARE'); b.id = 'dv-share-btn'; host.appendChild(b); }
    }
    if (mode === 'both' || mode === 'image') {
      var fig = featuredFigure();
      if (fig) {
        fig.classList.add('dv-share-host');
        var ib = shareButton('dv-share-img', 'SHARE'); ib.id = 'dv-share-img-btn';
        ib.title = 'Share this image';
        fig.appendChild(ib);
      }
    }
  }

  // WHERE THE BUTTONS GO. A slot printed by the [listen] shortcode wins; then
  // the configured place; then the headline, which is where a decision about
  // the thing you are looking at belongs.
  function slot() { return doc.querySelector('.wp-reader-listen'); }
  function rowIn(content, where) {
    var id = 'dv-reader-row-' + where;
    var row = doc.getElementById(id);
    if (row) return row;
    row = doc.createElement('p');
    row.id = id; row.className = 'dv-reader-row'; row.setAttribute('data-noread', '1');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:.6em;align-items:center;margin:0 0 1em';
    if (where === 'bottom') { row.style.margin = '1.4em 0 0'; content.appendChild(row); }
    else content.insertBefore(row, content.firstChild);
    return row;
  }
  function placeFor(content) {
    var s = slot();
    if (s) return s;
    var where = String(cfg('place', 'headline') || 'headline');
    if (where === 'top' || where === 'bottom') return rowIn(content, where);
    if (where !== 'headline' && where.length) {
      var custom = null;
      try { custom = doc.querySelector(where); } catch (e) {}
      if (custom) return custom;
    }
    return first(selectors('title', TITLE));
  }

  // ── THE RENDER LANE ─────────────────────────────────────────────────────
  // DVDocAudio asks the store; when the store has nothing this resolver asks the render host, in
  // the page's own blocks, the same way playdocs does: a whole-document lookup, then a lookup per
  // clip, then — after the visitor has pressed something — a render of the clips in order.
  var RENDER_LANE = { neural: 'neural', jaimla: 'jaimla', leaderofearth: 'leaderofearth', overlord: 'overlord' };
  var CHUNK_WORDS = [90, 180, 360, 720, 1200];
  var renderHost = String(cfg('renderHost', 'https://deltaverse.pythai.net')).replace(/\/+$/, '');
  var engineRoot = String(cfg('engine', renderHost + '/engine/ngn')).replace(/\/+$/, '');
  var autorender = cfg('autorender', true) !== false;
  var anticipate = cfg('anticipate', true) !== false;
  var gestured = false, contentEl = null, reader = null, blocksMemo = null, inflight = {};
  var diag = global.DVListenDiag || null;

  function items() {
    if (blocksMemo) return blocksMemo;
    blocksMemo = (global.DVDocReader && contentEl) ? DVDocReader.collect(contentEl).map(function (b) { return { text: b.text, tag: b.tag }; }) : [];
    return blocksMemo;
  }
  function wordsOf(t) { return (String(t || '').match(/\S+/g) || []).length; }
  function planChunks(list) {
    var out = [], i = 0, n = list.length, ci = 0;
    while (i < n) {
      var target = CHUNK_WORDS[Math.min(ci, CHUNK_WORDS.length - 1)], w = 0, j = i;
      while (j < n && w < target) { w += wordsOf(list[j].text); j++; }
      out.push({ i: ci, from: i, to: j, words: w }); i = j; ci++;
    }
    if (out.length > 1 && out[out.length - 1].words < 30) { var last = out.pop(); out[out.length - 1].to = last.to; out[out.length - 1].words += last.words; }
    out.forEach(function (c) { c.items = list.slice(c.from, c.to); });
    return out;
  }
  function abs(u) { return /^https?:/i.test(u) ? u : renderHost + u; }
  function post(path, body) {
    return global.fetch(renderHost + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function lookup(voice, list) {
    return post('/docsplayer/lookup', { voice: voice, blocks: list.map(function (b) { return { text: b.text }; }) })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function part(m, from) {
    var p = (m.parts && m.parts[0]) || {};
    var marks = (p.marks || m.marks || []).map(function (x) { return { block: (x.block | 0) + from, at: +x.at || 0 }; });
    var n = (m.blocks | 0) || ((p.to | 0) - (p.from | 0) + 1) || 1;
    return { url: abs(p.url || m.download || ''), file: p.file || '', seconds: +(p.seconds || m.seconds) || 0, bytes: +(p.bytes || m.bytes) || 0,
             from: from, to: from + n - 1, marks: marks };
  }
  function manifestOf(parts, list, m0) {
    return {
      key: 'render-host', voice: m0.voice, voiceName: m0.voiceName, engine: m0.engine || '', gap: (m0.gap != null ? +m0.gap : 0.35),
      parts: parts, blocks: list.length, seconds: parts.reduce(function (a, p) { return a + p.seconds; }, 0),
      bytes: parts.reduce(function (a, p) { return a + p.bytes; }, 0),
      blockFingerprints: list.map(function (b) { return DVDocReader.fingerprint(b.text); }),
      generated: m0.generated || '', realtimeFactor: m0.realtimeFactor, origin: renderHost
    };
  }
  var noteEl = null;
  function status(text, bad) {
    if (!noteEl) {
      var pnl = doc.getElementById('dv-reader-panel');
      if (!pnl) return;
      noteEl = doc.createElement('div'); noteEl.className = 'dvr-render-note'; noteEl.setAttribute('data-noread', '1');
      noteEl.style.cssText = 'font-size:10.5px;letter-spacing:.04em;line-height:1.4;padding:4px 10px 6px;color:rgba(255,255,255,.62)';
      pnl.appendChild(noteEl);
    }
    noteEl.textContent = text || ''; noteEl.style.color = bad ? '#f6a3a3' : 'rgba(255,255,255,.62)';
    if (diag) diag.note('event', { kind: 'render', text: text });
  }
  function settle(r, label) {
    return r.json().then(function (j) {
      if (r.status === 429) throw new Error('the render host asked this address to slow down — try again in a few minutes');
      if (r.status === 202 || (j && j.queued)) return awaitJob(j.job, j.key, label);
      if (!r.ok) throw new Error(j.detail || j.error || ('the render host answered HTTP ' + r.status));
      return j;
    }, function () { throw new Error('the render host answered HTTP ' + r.status + ' and not JSON'); });
  }
  function awaitJob(job, key, label) {
    var t0 = Date.now();
    return new Promise(function (res, rej) {
      (function tick() {
        global.fetch(renderHost + '/docsplayer/progress?job=' + encodeURIComponent(job), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
            if (d) {
              if (diag) diag.note('render', d);
              var pct = d.blocksTotal ? Math.round(100 * (d.blocksDone || 0) / d.blocksTotal) : 0;
              status(label + ' · ' + (d.state === 'queued' ? 'queued' + (d.position ? ' · position ' + d.position : '') : d.state) +
                     (d.blocksTotal ? ' · block ' + Math.min(d.blocksTotal, (d.blocksDone || 0) + 1) + '/' + d.blocksTotal + ' · ' + pct + '%' : '') +
                     (d.rtf ? ' · ' + (+d.rtf).toFixed(2) + '× measured' : '') + (d.eta != null ? ' · ≈' + Math.round(d.eta) + ' s left' : ''));
            }
            if (d && d.state === 'done') return global.fetch(renderHost + '/docsplayer/render/' + key).then(function (r) { return r.json(); }).then(res);
            if (d && d.state === 'failed') return rej(new Error(d.error || 'the render failed on the host'));
            if (Date.now() - t0 > 40 * 60 * 1000) return rej(new Error('gave up waiting for the render after forty minutes'));
            setTimeout(tick, 1200);
          }).catch(function () { setTimeout(tick, 2500); });
      })();
    });
  }
  function renderClip(voice, c, total, label) {
    var job = 'wp_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    return post('/docsplayer/render', {
      url: global.location.href, title: (doc.title || 'article').split('|')[0].trim().slice(0, 120) + (total > 1 ? ' — part ' + (c.i + 1) + '/' + total : ''),
      formats: ['opus'], blocks: c.items.map(function (b) { return { text: b.text, tag: b.tag }; }), voice: voice, job: job
    }).then(function (r) { return settle(r, label); });
  }
  function noteHeld(voiceId, m) { if (!global.DVDocAudio) return m; if (!DVDocAudio._held) DVDocAudio._held = {}; if (m && m.parts && m.parts.length) DVDocAudio._held[voiceId] = true; return m; }
  // (docId, voiceId) → manifest | null. Called by DVDocAudio when the store had nothing.
  function resolver(docId, voiceId) {
    var voice = RENDER_LANE[voiceId];
    if (!voice || !contentEl) return Promise.resolve(null);
    var list = items(); if (!list.length) return Promise.resolve(null);
    var plan = planChunks(list), key = voiceId;
    if (inflight[key]) return inflight[key];
    var p = lookup(voice, list).then(function (whole) {
      if (whole && whole.parts) { status(voiceId + ' · held by the render host · ' + Math.round(whole.seconds || 0) + ' s'); return manifestOf([part(whole, 0)], list, whole); }
      return Promise.all(plan.map(function (c) { return lookup(voice, c.items); })).then(function (held) {
        if (held.every(Boolean)) { status(voiceId + ' · ' + plan.length + ' clips held by the render host'); return manifestOf(held.map(function (m, k) { return part(m, plan[k].from); }), list, held[0]); }
        // nothing pressed yet and this is not the default voice: live synthesis, no render on a page view
        if (!autorender) return null;
        var presetVoice = (presetFor(postId()) || {}).voice || cfg('voice', 'neural');
        if (!gestured && !(anticipate && voiceId === presetVoice)) return null;
        var label = voiceId + (plan.length > 1 ? ' · clip 1/' + plan.length : '');
        var first = held[0] ? Promise.resolve(held[0]) : renderClip(voice, plan[0], plan.length, label);
        return first.then(function (m0) {
          var man = manifestOf([part(m0, plan[0].from)], list, m0);
          status(voiceId + ' · clip 1 ready · ' + Math.round(m0.seconds || 0) + ' s' + (plan.length > 1 ? ' · the rest render while it plays' : ''));
          (function next(k) {
            if (k >= plan.length) { status(voiceId + ' · rendered · ' + plan.length + ' clip' + (plan.length === 1 ? '' : 's') + ' · ' + Math.round(man.seconds) + ' s'); return; }
            (held[k] ? Promise.resolve(held[k]) : renderClip(voice, plan[k], plan.length, voiceId + ' · clip ' + (k + 1) + '/' + plan.length))
              .then(function (m) { var pt = part(m, plan[k].from); man.parts.push(pt); man.seconds += pt.seconds; man.bytes += pt.bytes; if (reader && reader.append && reader.mode && reader.mode() === 'file') reader.append([pt]); next(k + 1); })
              .catch(function (e) { status(voiceId + ' · clip ' + (k + 1) + ' failed: ' + ((e && e.message) || e), true); });
          })(1);
          return man;
        });
      });
    }).catch(function (e) { status(voiceId + ': ' + ((e && e.message) || e), true); return null; })
      .then(function (m) { delete inflight[key]; return m; });
    inflight[key] = p.then(function (m) { return noteHeld(voiceId, m); });
    return inflight[key];
  }
  // A press is a gesture: from now on a pick may render. If the reading is live in a renderable
  // voice with nothing held, ask the store again — the resolver will render clip 1 and the reader
  // adopts it the moment it exists.
  function onGesture() {
    if (gestured) return; gestured = true;
    if (!reader || !global.DVDocAudio || !autorender) return;
    var v = reader.voice();
    if (!RENDER_LANE[v] || (reader.mode && reader.mode() === 'file')) return;
    DVDocAudio.forget(cfg('doc', '') || postId() || 'post', v);
    DVDocAudio.manifest(cfg('doc', '') || postId() || 'post', v).then(function (m) { if (m && reader.adopt) reader.adopt(m); });
  }

  // ── THE GLOSS ───────────────────────────────────────────────────────────
  var glossApi = null, glossLoading = false;
  function glossMount() {
    if (!global.ListenGloss) return;
    glossApi = ListenGloss.mount({
      title: 'LISTEN · GLOSS · ' + ((doc.title || 'article').split('|')[0].trim().slice(0, 28)),
      state: function () { return global.listenState ? global.listenState() : null; },
      diag: function () { return diag ? diag.snapshot() : null; },
      lane: function () { var s = global.listenState ? global.listenState() : null; return s && s.mode === 'live' && reader && reader.voice() === 'ancient' ? 'client' : null; }
    });
  }
  function glossToggle() {
    if (glossApi) { glossApi.toggle(); return; }
    if (global.ListenGloss) { glossMount(); return; }
    if (glossLoading) return; glossLoading = true;
    var s = doc.createElement('script'); s.src = engineRoot + '/listen_gloss.js'; s.async = true;
    s.onload = function () { glossLoading = false; glossMount(); };
    s.onerror = function () { glossLoading = false; status('the gloss could not be loaded from ' + engineRoot, true); };
    doc.head.appendChild(s);
  }
  function glossButton(host) {
    if (!host || doc.getElementById('dv-gloss-btn')) return;
    var b = doc.createElement('button');
    b.type = 'button'; b.id = 'dv-gloss-btn'; b.className = 'dv-share'; b.setAttribute('data-noread', '1');
    b.title = 'GLOSS — a semi-transparent panel of what the listening costs, measured on this device';
    b.innerHTML = '<span class="i">&#10022;</span>GLOSS';
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); glossToggle(); });
    host.appendChild(b);
  }

  // ── PRESETS ─────────────────────────────────────────────────────────────
  var PRESETS = {
    neural:  { voice: 'neural',  substrate: false, hero: true },
    jaimla:  { voice: 'jaimla',  substrate: true,  hero: true },
    ancient: { voice: 'ancient', substrate: false, hero: true },
    pythia:  { voice: 'jaimla',  substrate: true,  hero: true, pythia: true }
  };
  // AUTOSTART. `autostart: true` (or `{ '1476': true }`) opens the player and starts the reading when
  // the page loads, from the rendered file. A browser that refuses autoplay is not argued with: the
  // reader says "ready — press play" with the panel open, which is the truth of that browser.
  function autostartFor(id) {
    var a = cfg('autostart', false);
    if (a && typeof a === 'object') a = a[String(id)] || a['default'] || false;
    return a === true || a === 1 || a === '1' || a === 'true';
  }
  // NO VOICES INSTALLED IS NOT NO AUDIO. A browser with a synthesiser and no voices used to mute the
  // button whenever the page's default voice had no rendered file — while another voice's file sat
  // in the store. Look for any held voice before giving up, and keep looking for a while: a render
  // in progress lands without the page reloading.
  var HELD_ORDER = ['jaimla', 'neural', 'leaderofearth', 'overlord'];
  function fallbackToHeld(tries) {
    if (!reader || !global.DVDocAudio) return;
    var s = global.listenState ? global.listenState() : null;
    if (!s || s.mode === 'file') return;
    var synth = !!(global.DVVoices && DVVoices.usable && DVVoices.usable());
    if (synth && !autostartFor(postId())) return;                 // live synthesis is a working reader
    var docId = cfg('doc', '') || postId() || 'post';
    var order = [reader.voice()].concat(HELD_ORDER.filter(function (v) { return v !== reader.voice(); }));
    (function next(i) {
      if (i >= order.length) {
        if ((tries || 0) < 12) setTimeout(function () { fallbackToHeld((tries || 0) + 1); }, 20000);
        return;
      }
      var v = order[i];
      DVDocAudio.forget(docId, v);
      // a plain store read: the resolver would render, and this is only a look
      global.fetch(DVDocAudio.root() + '/' + encodeURIComponent(docId) + '/' + encodeURIComponent(v) + '/manifest.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (m) {
          if (!m || !m.parts || !m.parts.length) return next(i + 1);
          status((v === reader.voice() ? v : v + ' (held; ' + reader.voice() + ' has no file yet)') + ' · rendered file found');
          if (v !== reader.voice()) reader.voice(v); else { DVDocAudio.manifest(docId, v).then(function (mm) { if (mm && reader.adopt) reader.adopt(mm); }); }
          if (autostartFor(postId())) setTimeout(function () { try { reader.open(); reader.play(); } catch (e) {} }, 800);
        });
    })(0);
  }
  function presetFor(id) {
    var p = cfg('preset', '');
    if (p && typeof p === 'object') p = p[String(id)] || p['default'] || '';
    return PRESETS[String(p || '').toLowerCase()] || null;
  }

  // ── THE HERO BUTTON ─────────────────────────────────────────────────────
  var HERO_CSS_ID = 'dv-hero-css';
  var HERO_CSS = [
    '.dv-hero{display:inline-flex;flex-direction:column;align-items:flex-start;gap:4px;vertical-align:middle;margin-left:.4em;position:relative}',
    '.dv-hero .dv-reader{position:relative;overflow:hidden;font-size:13px;letter-spacing:.2em;padding:10px 20px 10px 18px;border-radius:999px;',
    '  border:1px solid rgba(var(--cy,34,211,238),.55);background:linear-gradient(135deg,rgba(var(--cy,34,211,238),.14),rgba(var(--am,255,176,84),.12));',
    '  box-shadow:0 0 0 0 rgba(var(--cy,34,211,238),.0);transition:box-shadow .25s,transform .12s,border-color .25s}',
    '.dv-hero .dv-reader:hover{border-color:rgb(var(--cy,34,211,238));box-shadow:0 0 22px rgba(var(--cy,34,211,238),.35)}',
    '.dv-hero .dv-reader:active{transform:scale(.97)}',
    '.dv-hero.ready .dv-reader{animation:dvHeroPulse 2.4s ease-in-out infinite}',
    '.dv-hero.reading .dv-reader{animation:none;border-color:rgba(var(--am,255,176,84),.8)}',
    '.dv-hero.holding .dv-reader{box-shadow:0 0 0 6px rgba(var(--am,255,176,84),.25);border-color:rgb(var(--am,255,176,84))}',
    '@keyframes dvHeroPulse{0%,100%{box-shadow:0 0 0 0 rgba(var(--cy,34,211,238),.0)}50%{box-shadow:0 0 18px 2px rgba(var(--cy,34,211,238),.28)}}',
    '.dv-hero-level{position:absolute;left:0;bottom:0;height:3px;width:0;background:linear-gradient(90deg,rgb(var(--cy,34,211,238)),rgb(var(--am,255,176,84)));pointer-events:none;transition:width .08s linear}',
    '.dv-hero-sub{font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.55);padding-left:6px;white-space:nowrap}',
    '.dv-hero-sub b{color:rgb(var(--am,255,176,84));font-weight:600}',
    '.dv-hero-sub .ok{color:rgb(var(--cy,34,211,238))}',
    '@media (prefers-reduced-motion:reduce){.dv-hero.ready .dv-reader{animation:none}}',
    '@media (max-width:640px){.dv-hero{display:flex;width:100%;margin:10px 0 0;align-items:stretch}.dv-hero .dv-reader{width:100%;justify-content:center;font-size:15px;padding:14px 20px}.dv-hero-sub{white-space:normal;padding-left:0}}',
    // the play menu
    '.dv-play-menu{position:absolute;z-index:2147482002;min-width:260px;max-width:92vw;font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);',
    '  background:rgba(6,8,16,.96);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(var(--cy,34,211,238),.34);border-radius:12px;',
    '  box-shadow:0 22px 60px rgba(0,0,0,.55);padding:8px;color:rgba(255,255,255,.85);text-align:left}',
    '.dv-play-menu[hidden]{display:none}',
    '.dv-play-menu .k{margin:6px 6px 4px;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.42)}',
    '.dv-play-menu button{appearance:none;display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;font:inherit;font-size:11px;letter-spacing:.06em;',
    '  padding:8px 10px;border-radius:8px;cursor:pointer;color:rgba(255,255,255,.85);background:transparent;border:1px solid transparent;text-align:left}',
    '.dv-play-menu button:hover{background:rgba(var(--cy,34,211,238),.10);border-color:rgba(var(--cy,34,211,238),.4)}',
    '.dv-play-menu button[aria-checked="true"]{border-color:rgb(var(--am,255,176,84));color:#fff}',
    '.dv-play-menu button small{font-size:9.5px;color:rgba(255,255,255,.5);letter-spacing:.04em}',
    '.dv-play-menu button:disabled{opacity:.45;cursor:not-allowed}',
    // the substrate band
    '.dv-substrate-band{position:relative;width:100%;height:190px;margin:12px 0 18px;border-radius:14px;overflow:hidden;',
    '  border:1px solid rgba(var(--cy,34,211,238),.22);background:radial-gradient(120% 90% at 50% 100%,rgba(var(--cy,34,211,238),.10),rgba(6,8,16,.92))}',
    '.dv-substrate-band canvas{display:block;width:100%;height:100%}',
    '.dv-substrate-band .cap{position:absolute;right:10px;bottom:8px;font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:9px;letter-spacing:.16em;color:rgba(255,255,255,.4);text-transform:uppercase}',
    '@media (max-width:640px){.dv-substrate-band{height:140px}}'
  ].join('');
  function ensureHeroCss() { if (doc.getElementById(HERO_CSS_ID)) return; var st = doc.createElement('style'); st.id = HERO_CSS_ID; st.textContent = HERO_CSS; doc.head.appendChild(st); }

  var hero = null, heroSub = null, heroLevel = null, heroRAF = 0, pythia = false, substrateOn = false;
  function voiceLabel(id) { try { var v = DVVoices.get(id); return v ? v.name : id; } catch (e) { return id; } }
  function heldFor(voiceId) { return !!(global.DVDocAudio && DVDocAudio._held && DVDocAudio._held[voiceId]); }
  function paintHero() {
    if (!hero || !reader) return;
    var s = global.listenState ? global.listenState() : null; if (!s) return;
    var v = pythia ? 'PYTHIA' : voiceLabel(s.voice);
    var note;
    if (s.playing) note = (s.mode === 'file' ? 'reading the file' : (s.voice === 'ancient' ? 'this device reads' : 'browser voice')) + ' · ' + s.part + '/' + s.parts;
    else if (s.mode === 'file') note = '<span class="ok">held · immediate</span>';
    else if (RENDER_LANE[s.voice] && autorender) note = gestured ? 'rendering on the host' : 'renders on press';
    else if (s.voice === 'ancient') note = 'this device · instant';
    else note = 'browser voice · instant';
    heroSub.innerHTML = '<b>' + esc(v) + '</b> · ' + note + ' · <span style="opacity:.7">hold for the menu</span>';
    hero.classList.toggle('ready', !s.playing && s.mode === 'file');
    hero.classList.toggle('reading', !!s.playing);
    if (s.playing && !heroRAF) heroRAF = global.requestAnimationFrame(levelTick);
  }
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  var levelBuf = null;
  function levelOf(an) {
    if (!an) return 0;
    if (!levelBuf || levelBuf.length !== an.fftSize) levelBuf = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(levelBuf);
    var sum = 0; for (var i = 0; i < levelBuf.length; i++) { var x = (levelBuf[i] - 128) / 128; sum += x * x; }
    return Math.min(1, Math.sqrt(sum / levelBuf.length) * 3.2);
  }
  function levelTick() {
    heroRAF = 0;
    var s = global.listenState ? global.listenState() : null;
    if (!s || !s.playing) { if (heroLevel) heroLevel.style.width = '0'; return; }
    if (heroLevel) heroLevel.style.width = (s.analyser ? Math.round(levelOf(s.analyser) * 100) : 0) + '%';
    heroRAF = global.requestAnimationFrame(levelTick);
  }
  function dressHero(btn) {
    if (!btn || hero) return;
    ensureHeroCss();
    hero = doc.createElement('span'); hero.className = 'dv-hero'; hero.setAttribute('data-noread', '1');
    btn.parentNode.insertBefore(hero, btn); hero.appendChild(btn);
    heroLevel = doc.createElement('i'); heroLevel.className = 'dv-hero-level'; btn.appendChild(heroLevel);
    // doc-reader repaints the button's innerHTML on every state change; put the bar back after it does
    try { new MutationObserver(function () { if (!btn.contains(heroLevel)) btn.appendChild(heroLevel); }).observe(btn, { childList: true }); } catch (e) {}
    heroSub = doc.createElement('span'); heroSub.className = 'dv-hero-sub'; heroSub.setAttribute('aria-live', 'polite'); hero.appendChild(heroSub);
    // PRESS AND HOLD opens the play menu; a plain press plays, as before
    var holdT = 0, held = false;
    var down = function (e) { held = false; hero.classList.add('holding'); clearTimeout(holdT); holdT = setTimeout(function () { held = true; hero.classList.remove('holding'); openPlayMenu(btn); try { if (global.navigator.vibrate) global.navigator.vibrate(12); } catch (x) {} }, 520); };
    var up = function () { clearTimeout(holdT); hero.classList.remove('holding'); };
    btn.addEventListener('pointerdown', down); btn.addEventListener('pointerup', up); btn.addEventListener('pointerleave', up); btn.addEventListener('pointercancel', up);
    btn.addEventListener('click', function (e) { if (held) { held = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); openPlayMenu(btn); });
    global.addEventListener('mindx:listen', paintHero);
    paintHero();
  }

  // ── THE PLAY MENU ───────────────────────────────────────────────────────
  var playMenu = null;
  function menuVoices() {
    var out = [];
    ['neural', 'jaimla', 'leaderofearth', 'ancient'].forEach(function (id) {
      var v = null; try { v = DVVoices.get(id); } catch (e) {}
      if (!v) return;
      var lane = RENDER_LANE[id] ? (heldFor(id) ? 'held · immediate' : 'renders on the host') : (id === 'ancient' ? 'this device · ' + (v.onDevice === true ? 'on-device' : v.onDevice === false ? 'network voice' : 'instant') : 'browser');
      out.push({ id: id, name: v.name, lane: lane, disabled: id === 'ancient' && !(global.DVVoices.usable && DVVoices.usable()) });
    });
    var synth = !!(global.DVVoices.usable && DVVoices.usable());
    out.push({ id: 'pythia', name: 'PYTHIA', lane: synth ? 'jaimla in the oracle chamber + ANCIENT echo from this device' : 'jaimla in the oracle chamber (no device voice to echo)', disabled: false });
    return out;
  }
  function buildPlayMenu() {
    var m = doc.createElement('div'); m.className = 'dv-play-menu'; m.hidden = true; m.setAttribute('data-noread', '1'); m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'play menu');
    doc.body.appendChild(m);
    doc.addEventListener('click', function (e) { if (!m.hidden && !m.contains(e.target) && !(hero && hero.contains(e.target))) m.hidden = true; });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') m.hidden = true; });
    return m;
  }
  function paintPlayMenu() {
    var cur = reader ? reader.voice() : 'neural';
    var rows = menuVoices().map(function (v) {
      var on = pythia ? v.id === 'pythia' : v.id === cur;
      return '<button type="button" role="menuitemradio" data-v="' + v.id + '" aria-checked="' + on + '"' + (v.disabled ? ' disabled' : '') + '><span>' + esc(v.name) + '</span><small>' + esc(v.lane) + '</small></button>';
    }).join('');
    playMenu.innerHTML = '<div class="k">voice</div>' + rows +
      '<div class="k">more</div>' +
      '<button type="button" role="menuitemcheckbox" data-a="substrate" aria-checked="' + substrateOn + '"><span>DELTAVERSE SUBSTRATE</span><small>' + (substrateOn ? 'on · breathing with the audio' : 'off') + '</small></button>' +
      '<button type="button" role="menuitem" data-a="gloss"><span>GLOSS</span><small>diagnostics, measured here</small></button>';
  }
  function openPlayMenu(btn) {
    if (!playMenu) { playMenu = buildPlayMenu(); playMenu.addEventListener('click', onPlayMenu); }
    paintPlayMenu();
    playMenu.hidden = false;
    var r = btn.getBoundingClientRect(), vw = doc.documentElement.clientWidth;
    playMenu.style.left = Math.max(10, Math.min(r.left + global.scrollX, global.scrollX + vw - playMenu.offsetWidth - 10)) + 'px';
    playMenu.style.top = (r.bottom + global.scrollY + 8) + 'px';
  }
  function onPlayMenu(e) {
    var b = e.target.closest ? e.target.closest('button') : null; if (!b || b.disabled) return;
    e.preventDefault(); e.stopPropagation();
    gestured = true;
    if (b.dataset.v) {
      if (b.dataset.v === 'pythia') setPythia(true); else { setPythia(false); if (reader) reader.voice(b.dataset.v); }
      onGesture(); if (reader && !(global.listenState && listenState().playing)) reader.play();
    } else if (b.dataset.a === 'substrate') { setSubstrate(!substrateOn); }
    else if (b.dataset.a === 'gloss') { glossToggle(); }
    playMenu.hidden = true; paintHero();
  }

  // ── PYTHIA: jaimla in the oracle chamber, ANCIENT a beat behind ─────────
  var chamber = null, echoObs = null, echoLast = null;
  function ensureChamber() {
    var s = global.listenState ? global.listenState() : null;
    if (!s) return;
    if (!s.analyser && s.ensureAudio) { try { s.ensureAudio(); } catch (e) {} s = global.listenState(); }
    var an = s && s.analyser; if (!an || chamber) return;
    try {
      var ctx = an.context, delay = ctx.createDelay(1.5), fb = ctx.createGain(), wet = ctx.createGain(), lp = ctx.createBiquadFilter();
      delay.delayTime.value = 0.21; fb.gain.value = 0.34; wet.gain.value = 0.42; lp.type = 'lowpass'; lp.frequency.value = 2400;
      an.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet); wet.connect(ctx.destination);
      chamber = { delay: delay, fb: fb, wet: wet, lp: lp, an: an };
    } catch (e) { chamber = null; }
  }
  function chamberOff() { if (!chamber) return; try { chamber.wet.gain.value = 0; chamber.an.disconnect(chamber.delay); } catch (e) {} chamber = null; }
  function echoOn() {
    if (echoObs || !contentEl || !global.DVVoices || !(DVVoices.usable && DVVoices.usable())) return;
    echoObs = new MutationObserver(function (muts) {
      var s = global.listenState ? global.listenState() : null;
      if (!pythia || !s || !s.playing || s.mode !== 'file') return;
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target;
        if (t.classList && t.classList.contains('dv-reading') && t !== echoLast) {
          echoLast = t;
          var first = (DVDocReader.sentences ? DVDocReader.sentences(t.textContent || '') : [t.textContent])[0] || '';
          if (!first) continue;
          (function (text) { setTimeout(function () { if (!pythia) return; try { var u = DVVoices.utter(text.slice(0, 220), { voice: 'ancient', rate: 0.9 }); u.volume = 0.8; global.speechSynthesis.speak(u); } catch (e) {} }, 380); })(first);
        }
      }
    });
    echoObs.observe(contentEl, { attributes: true, attributeFilter: ['class'], subtree: true });
  }
  function echoOff() { if (echoObs) { echoObs.disconnect(); echoObs = null; } try { global.speechSynthesis && global.speechSynthesis.cancel(); } catch (e) {} }
  function setPythia(on) {
    pythia = !!on;
    if (pythia) { if (reader) reader.voice('jaimla'); ensureChamber(); echoOn(); status('PYTHIA · jaimla in the oracle chamber' + (echoObs ? ' · ANCIENT echoes the first line of each block from this device' : ' · no device voice to echo')); }
    else { chamberOff(); echoOff(); }
    paintHero();
  }

  // ── THE DELTAVERSE SUBSTRATE, BREATHING WITH THE AUDIO ──────────────────
  var band = null, field = null, fieldRAF = 0, senses = { state: { audio: { active: false, level: 0, bands: [0, 0, 0, 0], inflection: 0 } } }, freqBuf = null, lastLevel = 0, subLoading = false;
  function bandsOf(an) {
    if (!freqBuf || freqBuf.length !== an.frequencyBinCount) freqBuf = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(freqBuf);
    var n = freqBuf.length, edges = [0, n * 0.03, n * 0.10, n * 0.30, n], out = [0, 0, 0, 0];
    for (var b = 0; b < 4; b++) { var a = edges[b] | 0, z = Math.max(a + 1, edges[b + 1] | 0), sum = 0; for (var i = a; i < z; i++) sum += freqBuf[i]; out[b] = sum / (z - a) / 255; }
    return out;
  }
  function fieldTick() {
    fieldRAF = 0;
    if (!field) return;
    var s = global.listenState ? global.listenState() : null;
    var an = s && s.analyser, live = !!(s && s.playing && s.mode === 'file' && an);
    var a = senses.state.audio;
    if (live) { var lv = levelOf(an); a.active = true; a.level = lv; a.bands = bandsOf(an); a.inflection = Math.max(-1, Math.min(1, (lv - lastLevel) * 6)); lastLevel = lv; }
    else { a.active = false; }
    fieldRAF = global.requestAnimationFrame(fieldTick);
  }
  function mountSubstrate() {
    if (!global.DVDeltaverse || !contentEl || band) return;
    ensureHeroCss();
    band = doc.createElement('div'); band.className = 'dv-substrate-band'; band.setAttribute('data-noread', '1'); band.setAttribute('aria-hidden', 'true');
    var cv = doc.createElement('canvas'); band.appendChild(cv);
    var cap = doc.createElement('span'); cap.className = 'cap'; cap.textContent = 'deltaverse substrate · breathing with the audio'; band.appendChild(cap);
    var fig = featuredFigure();
    if (fig && fig.parentNode && !contentEl.contains(fig)) fig.parentNode.insertBefore(band, fig.nextSibling);
    else contentEl.insertBefore(band, contentEl.firstChild);
    try {
      field = new DVDeltaverse.Field(cv, { demo: true, scale: 1.1, depth: 0.6 }).start();
      field.attachSenses(senses);
      fieldRAF = global.requestAnimationFrame(fieldTick);
    } catch (e) { band.remove(); band = null; field = null; status('the substrate could not start: ' + ((e && e.message) || e), true); }
  }
  function setSubstrate(on) {
    substrateOn = !!on;
    if (!substrateOn) { if (field) { try { field.stop(); } catch (e) {} field = null; } if (band) { band.remove(); band = null; } if (fieldRAF) { global.cancelAnimationFrame(fieldRAF); fieldRAF = 0; } return; }
    if (global.DVDeltaverse) { mountSubstrate(); return; }
    if (subLoading) return; subLoading = true;
    var sc = doc.createElement('script'); sc.src = engineRoot + '/deltaverse-substrate.js'; sc.async = true;
    sc.onload = function () { subLoading = false; if (substrateOn) mountSubstrate(); };
    sc.onerror = function () { subLoading = false; status('deltaverse-substrate.js could not be loaded from ' + engineRoot, true); };
    doc.head.appendChild(sc);
  }

  function boot() {
    if (!global.DVDocReader || !global.DVVoices) return;
    if (!isSingle()) return;
    if (!allowed()) return;
    var content = first(selectors('content', CONTENT));
    if (!content) return;
    prune(content);
    contentEl = content;
    if (global.DVDocAudio && global.DVDocAudio.resolve) global.DVDocAudio.resolve(resolver);
    if (diag) { diag.start(); diag.watchSynth(); }

    // WHERE THE STORE IS, if there is one. Set before mount(), because
    // doc-reader asks DVDocAudio for a manifest as it comes up; setting it after
    // means the first look happens against the publisher's own /audio, which is
    // empty, and the reader settles into live synthesis for the session.
    var store = cfg('audioRoot', '');
    if (store && global.DVDocAudio && global.DVDocAudio.root) {
      try { global.DVDocAudio.root(store); } catch (e) {}
    }

    // MOUNT ON THE CONTENT, NOT ON AN ANCESTOR OF IT.
    //
    // This used to walk up to the nearest element containing both the headline
    // and the body so that the button would land inside the document's own h1.
    // It did land there. It also handed the reader every node between those two
    // elements, and on a normal theme that is the site footer: the last thing it
    // read aloud on the first real install was a list of the site's own domains.
    //
    // So the root is the article body and nothing else, and the button is moved
    // to the headline afterwards. Moving a node does not disturb its listeners,
    // and the block list stays exactly the article.
    // ONE VOICE ON AN ARTICLE. The site reads in neural and offers no chooser: a visitor came for the
    // words, and an audition of the cast is the instrument's business (playdocs), not the article's.
    // The plugin can name another voice (WPReader.voice) or turn the chooser back on (WPReader.chooser).
    var preset = presetFor(postId());
    reader = global.DVDocReader.mount({
      root: content,
      doc: cfg('doc', '') || postId() || 'post',
      label: cfg('label', '') || (doc.title || 'article').split('|')[0].trim().slice(0, 40),
      voice: (preset && preset.voice) || cfg('voice', 'neural'),
      // THE CHOOSER IS ON. v1.2 pinned the site's voice; v0.0.1alpha offers the cast, and a pick
      // renders the article in that voice on the host (see THE RENDER LANE above). `chooser:false`
      // restores the pinned reading for a site that wants one voice.
      chooser: cfg('chooser', true) !== false,
      autostart: autostartFor(postId())
    });
    if (!reader) return;
    setTimeout(function () { fallbackToHeld(0); }, 1500);

    var btn = doc.getElementById('dv-listen-btn');
    var holder = btn && btn.parentNode;
    var target = placeFor(content);
    if (btn && target && !target.contains(btn)) {
      target.appendChild(btn);
      // mount() wraps the button in a <p> when it had no h1 to put it in. That
      // paragraph is now empty and would print as a blank line above the article.
      if (holder && holder !== target && holder.tagName === 'P' && !holder.textContent.trim() &&
          !holder.children.length && holder.parentNode) {
        holder.parentNode.removeChild(holder);
      }
    }

    // the first press is the gesture the render lane waits for; the panel's own voice select is a gesture too
    if (btn) btn.addEventListener('click', onGesture, true);
    var sel = reader.el && reader.el.querySelector('[data-a="voice"]');
    if (sel) sel.addEventListener('change', function () { gestured = true; }, true);
    if (cfg('gloss', true) !== false) glossButton(target && target.contains(btn) ? target : (btn && btn.parentNode));
    if (cfg('hero', true) !== false && (!preset || preset.hero !== false)) dressHero(btn);
    if (preset && preset.substrate) setSubstrate(true);
    if (preset && preset.pythia) setPythia(true);

    global.wordpressReader = reader;
    return reader;
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
  function start() {
    // LISTEN first so SHARE lands after it in the headline, then SHARE whether
    // or not the reader could mount: a page with no synthesiser can still be
    // shared.
    var after = function () { try { bootShare(); } catch (e) {} };
    if (global.DVVoices) global.DVVoices.ready().then(boot).then(after, after);
    else { boot(); after(); }
  }
  global.WordPressReader = {
    boot: boot, isSingle: isSingle, allowed: allowed, postId: postId,
    share: function () { var b = doc.getElementById('dv-share-btn') || doc.body; doShare(b); },
    shareInfo: shareInfo, shareMode: shareMode,
    contentSelectors: CONTENT, featuredSelectors: FEATURED, config: CFG,
    gloss: glossToggle, render: function (voiceId) { gestured = true; if (!reader) return null; var d = cfg('doc', '') || postId() || 'post', v = voiceId || reader.voice(); DVDocAudio.forget(d, v); return DVDocAudio.manifest(d, v).then(function (m) { if (m && reader.adopt) reader.adopt(m); return m; }); },
    menu: function () { var b = doc.getElementById('dv-listen-btn'); if (b) openPlayMenu(b); },
    pythia: setPythia, substrate: setSubstrate, presets: PRESETS,
    version: '1.4.1', label: 'v0.0.1alpha'
  };
})(typeof window !== 'undefined' ? window : this);
