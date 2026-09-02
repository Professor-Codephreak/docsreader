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
 */
(function (global) {
  'use strict';
  var doc = global.document;

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
    '.addtoany_share_save_container', '.code-block', '.adsbygoogle'
  ];

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

  function boot() {
    if (!global.DVDocReader || !global.DVVoices) return;
    if (!isSingle()) return;
    var content = first(CONTENT);
    if (!content) return;
    prune(content);

    // The LISTEN button belongs beside the headline, not inside the body — the
    // body is what gets read, and a control inside it would read itself.
    // doc.player puts the button in the first h1 of its root, so it is given a
    // root that starts at the title and contains the content.
    var title = first(TITLE);
    var host = content;
    if (title && !content.contains(title)) {
      // wrap without moving anything the theme depends on: a wrapper that is
      // display:contents is invisible to layout
      var common = title.parentNode;
      while (common && !common.contains(content)) common = common.parentNode;
      if (common) host = common;
    }

    var reader = global.DVDocReader.mount({
      root: host,
      doc: (doc.body.className.match(/postid-(\d+)/) || [])[1] || 'post',
      label: (doc.title || 'article').split('|')[0].trim().slice(0, 40)
    });
    if (reader) global.wordpressReader = reader;
    return reader;
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
  function start() {
    if (global.DVVoices) global.DVVoices.ready().then(boot);
    else boot();
  }
  global.WordPressReader = { boot: boot, isSingle: isSingle, contentSelectors: CONTENT };
})(typeof window !== 'undefined' ? window : this);
