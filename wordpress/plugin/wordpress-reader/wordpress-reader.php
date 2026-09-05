<?php
/**
 * Plugin Name:       wordpress.reader
 * Plugin URI:        https://github.com/Professor-Codephreak/docsreader
 * Description:       Adds a LISTEN button to your posts and reads them aloud on the page, lighting each word as it says it. No account, no API key, no audio stored on your server.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.2
 * Author:            Professor Codephreak
 * Author URI:        https://rage.pythai.net
 * License:           Apache-2.0
 * License URI:       https://www.apache.org/licenses/LICENSE-2.0
 * Text Domain:       wordpress-reader
 *
 * WHY A PLUGIN AND NOT A WIDGET.
 *
 * The reader shipped first as three script tags in a footer widget, which works
 * and needs nothing installed. What it cannot do is know anything. A widget is a
 * blob of HTML printed on every page, so the script had to infer which post it
 * was on from a body class and find the article by trying the selectors themes
 * tend to use. On the first real install that inference walked up to the nearest
 * element containing both the headline and the body, which on an ordinary theme
 * is a wrapper around the site footer -- and the reader dutifully read the
 * footer aloud.
 *
 * WordPress already knows all of it. This plugin passes the post id, the content
 * selector and the store id down to the script, so nothing is guessed. It also
 * loads only where it will be used, which a widget cannot do.
 *
 * WHAT IT SENDS ANYWHERE. Nothing. The reader runs in the visitor's browser and
 * reads the text already on the page through the browser's own speech engine. It
 * does not post your content anywhere, and it does not need to: the reason this
 * is a plugin rather than a service that fetches your site is that fetching your
 * site from outside does not work and should not be made to.
 *
 * If you point it at a rendered-audio store (Settings -> Reader), it will ask
 * that store whether it already holds a recording of this post and play the file
 * when it does. That request carries the post's store id and nothing else. With
 * no store configured, or a store that has nothing for this post, the reader
 * speaks with the browser's synthesiser and never leaves the page.
 */

if (!defined('ABSPATH')) {
    exit; // no direct access
}

define('WPREADER_VERSION', '1.0.0');
define('WPREADER_ENGINE_DEFAULT', 'https://deltaverse.pythai.net/engine/ngn');

/**
 * Defaults. `only` empty means every post; a store that is empty means the
 * live-synthesis lane only, which is the safe default because it involves no
 * third party at all.
 */
function wpreader_defaults() {
    return array(
        'engine'     => WPREADER_ENGINE_DEFAULT,
        'audio_root' => '',
        'post_types' => array('post'),
        'only'       => '',
        'content'    => '',
        'title'      => '',
        'doc_prefix' => '',
    );
}

function wpreader_opts() {
    $o = get_option('wpreader_settings', array());
    return wp_parse_args(is_array($o) ? $o : array(), wpreader_defaults());
}

/**
 * Should the reader load on the post being viewed?
 *
 * Deliberately conservative in one direction only: it is inert on archives,
 * search and the home page, because reading a list of excerpts aloud is reading
 * a table of contents. An empty allowlist means no restriction -- a misread
 * setting must not be able to switch the reader off silently.
 */
function wpreader_should_load() {
    $o = wpreader_opts();
    $types = (array) $o['post_types'];
    if (!$types || !is_singular($types)) {
        return false;
    }
    $only = wpreader_only_ids($o);
    if ($only && !in_array((int) get_the_ID(), $only, true)) {
        return false;
    }
    return true;
}

function wpreader_only_ids($o = null) {
    $o = $o ? $o : wpreader_opts();
    $raw = trim((string) $o['only']);
    if ($raw === '') {
        return array();
    }
    $ids = array();
    foreach (preg_split('/[^0-9]+/', $raw) as $n) {
        if ($n !== '') {
            $ids[] = (int) $n;
        }
    }
    return array_values(array_unique(array_filter($ids)));
}

/**
 * The store id for this post.
 *
 * Rendered audio is aligned to a post by INDEX of block, so the id has to be
 * stable across re-renders and unique across sites sharing one store. Host plus
 * post id gives both, and it is legible in a directory listing, which matters
 * the first time something is stored under the wrong name.
 */
function wpreader_doc_id($post_id) {
    $o = wpreader_opts();
    $prefix = trim((string) $o['doc_prefix']);
    if ($prefix === '') {
        $host = wp_parse_url(home_url(), PHP_URL_HOST);
        $host = $host ? $host : 'site';
        $parts = explode('.', $host);
        $prefix = sanitize_key($parts[0]);
    }
    return $prefix . '-' . (int) $post_id;
}

add_action('wp_enqueue_scripts', 'wpreader_enqueue');
function wpreader_enqueue() {
    if (!wpreader_should_load()) {
        return;
    }
    $o = wpreader_opts();
    $engine = untrailingslashit(esc_url_raw($o['engine']));
    if (!$engine) {
        return;
    }

    // ORDER IS LOAD ORDER, and it is not decoration. voices.js defines the cast,
    // doc-reader.js is the player, doc-audio.js is the optional file lane, and
    // wordpress-reader.js is the part that knows it is inside WordPress. Each
    // depends on the one before it, so they are declared as dependencies rather
    // than merely enqueued in sequence -- a footer/defer decision elsewhere
    // could otherwise reorder them.
    wp_enqueue_script('dv-voices', $engine . '/voices.js', array(), WPREADER_VERSION, true);
    wp_enqueue_script('dv-doc-reader', $engine . '/doc-reader.js', array('dv-voices'), WPREADER_VERSION, true);

    $deps = array('dv-doc-reader');
    if (trim((string) $o['audio_root']) !== '') {
        wp_enqueue_script('dv-doc-audio', $engine . '/doc-audio.js', array('dv-voices'), WPREADER_VERSION, true);
        $deps[] = 'dv-doc-audio';
    }
    wp_enqueue_script('wp-reader', $engine . '/wordpress-reader.js', $deps, WPREADER_VERSION, true);

    $post_id = (int) get_the_ID();
    $config = array(
        'post'      => $post_id,
        'doc'       => wpreader_doc_id($post_id),
        'label'     => wp_strip_all_tags(get_the_title($post_id)),
        'only'      => wpreader_only_ids($o),
        'content'   => (string) $o['content'],
        'title'     => (string) $o['title'],
        'audioRoot' => untrailingslashit(esc_url_raw((string) $o['audio_root'])),
    );

    // Printed BEFORE the scripts that read it. wp_add_inline_script with
    // 'before' on the first handle guarantees that regardless of where the
    // scripts end up in the document.
    wp_add_inline_script(
        'dv-voices',
        'window.WPReader = ' . wp_json_encode($config) . ';' .
        ($config['audioRoot'] ? 'window.DV_AUDIO_ROOT = ' . wp_json_encode($config['audioRoot']) . ';' : ''),
        'before'
    );
}

/* ── settings ─────────────────────────────────────────────────────────────── */

add_action('admin_menu', 'wpreader_menu');
function wpreader_menu() {
    add_options_page(
        __('Reader', 'wordpress-reader'),
        __('Reader', 'wordpress-reader'),
        'manage_options',
        'wordpress-reader',
        'wpreader_settings_page'
    );
}

add_action('admin_init', 'wpreader_register');
function wpreader_register() {
    register_setting('wpreader', 'wpreader_settings', array(
        'sanitize_callback' => 'wpreader_sanitize',
        'default'           => wpreader_defaults(),
    ));
}

function wpreader_sanitize($in) {
    $d = wpreader_defaults();
    $out = array();
    $out['engine']     = esc_url_raw(trim((string) (isset($in['engine']) ? $in['engine'] : $d['engine'])));
    $out['audio_root'] = esc_url_raw(trim((string) (isset($in['audio_root']) ? $in['audio_root'] : '')));
    $out['only']       = trim((string) (isset($in['only']) ? $in['only'] : ''));
    $out['content']    = trim((string) (isset($in['content']) ? $in['content'] : ''));
    $out['title']      = trim((string) (isset($in['title']) ? $in['title'] : ''));
    $out['doc_prefix'] = sanitize_key((string) (isset($in['doc_prefix']) ? $in['doc_prefix'] : ''));

    $types = isset($in['post_types']) && is_array($in['post_types']) ? $in['post_types'] : array();
    $out['post_types'] = array_values(array_intersect(
        array_map('sanitize_key', $types),
        array_keys(get_post_types(array('public' => true), 'names'))
    ));
    if (!$out['post_types']) {
        $out['post_types'] = array('post');   // no post types selected reads as a mistake, not as "off"
    }
    if (!$out['engine']) {
        $out['engine'] = $d['engine'];
    }
    return $out;
}

function wpreader_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    $o = wpreader_opts();
    $public = get_post_types(array('public' => true), 'objects');
    ?>
    <div class="wrap">
      <h1><?php esc_html_e('wordpress.reader', 'wordpress-reader'); ?></h1>
      <p><?php esc_html_e('Adds a LISTEN button to your posts and reads them aloud in the visitor\'s browser. Nothing is uploaded and no key is required.', 'wordpress-reader'); ?></p>
      <form method="post" action="options.php">
        <?php settings_fields('wpreader'); ?>
        <table class="form-table" role="presentation">
          <tr>
            <th scope="row"><label for="wpreader-engine"><?php esc_html_e('Script source', 'wordpress-reader'); ?></label></th>
            <td>
              <input id="wpreader-engine" name="wpreader_settings[engine]" type="url" class="regular-text code"
                     value="<?php echo esc_attr($o['engine']); ?>">
              <p class="description"><?php esc_html_e('Where the reader files are served from. Leave as the default unless you host them yourself.', 'wordpress-reader'); ?></p>
            </td>
          </tr>
          <tr>
            <th scope="row"><?php esc_html_e('Show on', 'wordpress-reader'); ?></th>
            <td>
              <?php foreach ($public as $t) : ?>
                <label style="margin-right:1em">
                  <input type="checkbox" name="wpreader_settings[post_types][]" value="<?php echo esc_attr($t->name); ?>"
                    <?php checked(in_array($t->name, (array) $o['post_types'], true)); ?>>
                  <?php echo esc_html($t->labels->name); ?>
                </label>
              <?php endforeach; ?>
              <p class="description"><?php esc_html_e('Single items only. Archives, search results and the home page are always left alone.', 'wordpress-reader'); ?></p>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="wpreader-only"><?php esc_html_e('Only these posts', 'wordpress-reader'); ?></label></th>
            <td>
              <input id="wpreader-only" name="wpreader_settings[only]" type="text" class="regular-text code"
                     value="<?php echo esc_attr($o['only']); ?>" placeholder="1469, 1502">
              <p class="description"><?php esc_html_e('Post IDs, comma separated. Use this to try the reader on one article before turning it on everywhere. Empty means every post of the types above.', 'wordpress-reader'); ?></p>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="wpreader-audio"><?php esc_html_e('Rendered audio store', 'wordpress-reader'); ?></label></th>
            <td>
              <input id="wpreader-audio" name="wpreader_settings[audio_root]" type="url" class="regular-text code"
                     value="<?php echo esc_attr($o['audio_root']); ?>" placeholder="https://deltaverse.pythai.net/audio">
              <p class="description"><?php esc_html_e('Optional. If a recording of a post exists there, the reader plays the file, which can be seeked and downloaded. Leave empty to use only the browser\'s own speech engine, which involves no third party.', 'wordpress-reader'); ?></p>
            </td>
          </tr>
          <tr>
            <th scope="row"><?php esc_html_e('Theme selectors', 'wordpress-reader'); ?></th>
            <td>
              <p>
                <input name="wpreader_settings[content]" type="text" class="regular-text code"
                       value="<?php echo esc_attr($o['content']); ?>" placeholder=".entry-content">
                <label><?php esc_html_e('article body', 'wordpress-reader'); ?></label>
              </p>
              <p>
                <input name="wpreader_settings[title]" type="text" class="regular-text code"
                       value="<?php echo esc_attr($o['title']); ?>" placeholder="h1.entry-title">
                <label><?php esc_html_e('headline', 'wordpress-reader'); ?></label>
              </p>
              <p class="description"><?php esc_html_e('Only needed if your theme names these something unusual. Left empty, the reader tries the selectors themes normally use.', 'wordpress-reader'); ?></p>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="wpreader-prefix"><?php esc_html_e('Store prefix', 'wordpress-reader'); ?></label></th>
            <td>
              <input id="wpreader-prefix" name="wpreader_settings[doc_prefix]" type="text" class="regular-text code"
                     value="<?php echo esc_attr($o['doc_prefix']); ?>"
                     placeholder="<?php echo esc_attr(wpreader_doc_id(0)); ?>">
              <p class="description"><?php esc_html_e('Names this site inside a shared audio store. Defaults to the first part of your domain.', 'wordpress-reader'); ?></p>
            </td>
          </tr>
        </table>
        <?php submit_button(); ?>
      </form>
    </div>
    <?php
}

/* ── a link to the settings from the plugin list ──────────────────────────── */

add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'wpreader_action_links');
function wpreader_action_links($links) {
    $url = admin_url('options-general.php?page=wordpress-reader');
    array_unshift($links, '<a href="' . esc_url($url) . '">' . esc_html__('Settings', 'wordpress-reader') . '</a>');
    return $links;
}
