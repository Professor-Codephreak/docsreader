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

  function boot() {
    if (!global.DVDocReader || !global.DVVoices) return;
    if (!isSingle()) return;
    if (!allowed()) return;
    var content = first(selectors('content', CONTENT));
    if (!content) return;
    prune(content);

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
    var reader = global.DVDocReader.mount({
      root: content,
      doc: cfg('doc', '') || postId() || 'post',
      label: cfg('label', '') || (doc.title || 'article').split('|')[0].trim().slice(0, 40),
      voice: cfg('voice', 'neural'),
      chooser: cfg('chooser', false) === true
    });
    if (!reader) return;

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
    contentSelectors: CONTENT, featuredSelectors: FEATURED, config: CFG, version: '1.2.1'
  };
})(typeof window !== 'undefined' ? window : this);
