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
 * INSTALLING IT ON WORDPRESS. Load it from a custom_html widget in a footer
 * region, NOT from post content: WordPress runs `wpautop` over post bodies and
 * that mangles <script>. One widget, sitewide, and every article gets a LISTEN
 * button. No plugin, no theme edit, no build step.
 *
 *   <script src="https://deltaverse.pythai.net/engine/ngn/voices.js"></script>
 *   <script src="https://deltaverse.pythai.net/engine/ngn/doc-reader.js"></script>
 *   <script src="https://deltaverse.pythai.net/engine/ngn/wordpress-reader.js"></script>
 *
 * It is inert on anything that is not a single article, and it degrades to
 * nothing if the synthesiser is missing.
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
    var reader = global.DVDocReader.mount({
      root: content,
      doc: cfg('doc', '') || postId() || 'post',
      label: cfg('label', '') || (doc.title || 'article').split('|')[0].trim().slice(0, 40)
    });
    if (!reader) return;

    var btn = doc.getElementById('dv-listen-btn');
    var title = first(selectors('title', TITLE));
    if (btn && title && !title.contains(btn)) {
      var holder = btn.parentNode;
      title.appendChild(btn);
      // mount() wraps the button in a <p> when it had no h1 to put it in. That
      // paragraph is now empty and would print as a blank line above the article.
      if (holder && holder !== title && holder.tagName === 'P' && !holder.textContent.trim() &&
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
    if (global.DVVoices) global.DVVoices.ready().then(boot);
    else boot();
  }
  global.WordPressReader = {
    boot: boot, isSingle: isSingle, allowed: allowed, postId: postId,
    contentSelectors: CONTENT, config: CFG
  };
})(typeof window !== 'undefined' ? window : this);
