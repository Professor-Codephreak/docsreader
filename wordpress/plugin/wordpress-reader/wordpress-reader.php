<?php
/**
 * Plugin Name:       wordpress.reader
 * Plugin URI:        https://github.com/Professor-Codephreak/docsreader
 * Description:       Adds LISTEN and SHARE to your articles: reads them aloud on the page, lighting each word as it says it, and shares the article with its own image. No account, no API key, no audio stored on your server.
 * Version:           1.2.0
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
 * HOW LISTEN GETS ONTO AN ARTICLE. Three ways, and they compose:
 *
 *   1. Settings -> Reader -> "Where it appears": EVERY article of the chosen
 *      post types (the default), or ONLY articles you switch on.
 *   2. The LISTEN box in the editor sidebar of each post: Default / On / Off.
 *      On adds the reader to that one article whatever the site setting says;
 *      Off removes it from that one article whatever the site setting says.
 *   3. The [listen] shortcode, which puts the button exactly where you type it
 *      and switches the reader on for that article by itself.
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

define('WPREADER_VERSION', '1.2.0');
define('WPREADER_ENGINE_DEFAULT', 'https://deltaverse.pythai.net/engine/ngn');
define('WPREADER_META', '_wpreader');   // per-post switch: '' (default) | 'on' | 'off'

/**
 * Defaults. `mode` all means every post of the chosen types; `only` empty means
 * no allowlist; a store that is empty means the live-synthesis lane only, which
 * is the safe default because it involves no third party at all.
 */
function wpreader_defaults() {
    return array(
        'engine'     => WPREADER_ENGINE_DEFAULT,
        'audio_root' => '',
        'post_types' => array('post'),
        'mode'       => 'all',        // all | marked
        'only'       => '',
        'content'    => '',
        'title'      => '',
        'doc_prefix' => '',
        // SHARE, from the image. On by default: it is a link the visitor opens
        // or the browser's own share sheet, and it sends nothing itself.
        'share'      => 1,
        // Where the LISTEN button lands when no [listen] shortcode says otherwise.
        'place'      => 'headline',   // headline | top | bottom
    );
}

function wpreader_opts() {
    $o = get_option('wpreader_settings', array());
    return wp_parse_args(is_array($o) ? $o : array(), wpreader_defaults());
}

/**
 * The per-post switch, normalised to '', 'on' or 'off'.
 */
function wpreader_post_switch($post_id) {
    $v = (string) get_post_meta((int) $post_id, WPREADER_META, true);
    return ($v === 'on' || $v === 'off') ? $v : '';
}

/**
 * Does this post's content carry [listen]? A shortcode is the author saying
 * "here", which is the clearest possible opt-in.
 */
function wpreader_has_shortcode($post_id) {
    $content = (string) get_post_field('post_content', (int) $post_id);
    return $content !== '' && function_exists('has_shortcode') && has_shortcode($content, 'listen');
}

/**
 * Should the reader load on the post being viewed?
 *
 * Deliberately conservative in one direction only: it is inert on archives,
 * search and the home page, because reading a list of excerpts aloud is reading
 * a table of contents. On a single post the decision is, in order:
 *
 *   the post's own switch (Off wins over everything, On wins over the rest)
 *   a [listen] shortcode in the content         -> on
 *   the allowlist, when one is set               -> on if listed
 *   the site mode: all -> on, marked -> off
 *
 * An empty allowlist means no restriction -- a misread setting must not be
 * able to switch the reader off silently.
 */
function wpreader_should_load() {
    $o = wpreader_opts();
    $types = (array) $o['post_types'];
    if (!$types || !is_singular($types)) {
        return false;
    }
    $id = (int) get_the_ID();
    $sw = wpreader_post_switch($id);
    if ($sw === 'off') {
        return false;
    }
    if ($sw === 'on') {
        return true;
    }
    if (wpreader_has_shortcode($id)) {
        return true;
    }
    $only = wpreader_only_ids($o);
    if ($only) {
        return in_array($id, $only, true);
    }
    return $o['mode'] !== 'marked';
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
    // wordpress-reader.js is the part that knows it is inside WordPress. They are
    // declared as dependencies rather than merely enqueued in sequence -- a
    // footer/defer decision elsewhere could otherwise reorder them.
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
        // The share card is read from the page's own og:* tags by the script;
        // the option only says whether the buttons exist at all.
        'share'     => (bool) $o['share'],
        'place'     => (string) $o['place'],
        'version'   => WPREADER_VERSION,
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

/* ── the [listen] shortcode ───────────────────────────────────────────────── */

/**
 * [listen] prints an empty slot; the script moves the LISTEN button into it
 * when the page loads. The slot is inert without the script, so a page that
 * has JavaScript off shows exactly nothing where the shortcode was.
 *
 *   [listen]              the button, here
 *   [listen share="yes"]  the button and SHARE, here
 */
add_shortcode('listen', 'wpreader_shortcode');
function wpreader_shortcode($atts) {
    $a = shortcode_atts(array('share' => ''), $atts, 'listen');
    $share = in_array(strtolower((string) $a['share']), array('1', 'yes', 'true', 'on'), true);
    return '<span class="wp-reader-listen" data-noread="1"' . ($share ? ' data-share="1"' : '') . '></span>';
}

/* ── the per-post switch: a box in the editor sidebar ────────────────────── */

add_action('init', 'wpreader_register_meta');
function wpreader_register_meta() {
    $o = wpreader_opts();
    foreach ((array) $o['post_types'] as $type) {
        register_post_meta($type, WPREADER_META, array(
            'type'              => 'string',
            'single'            => true,
            'default'           => '',
            'show_in_rest'      => true,
            'sanitize_callback' => 'wpreader_sanitize_switch',
            'auth_callback'     => function () { return current_user_can('edit_posts'); },
        ));
    }
}

function wpreader_sanitize_switch($v) {
    $v = strtolower(trim((string) $v));
    return ($v === 'on' || $v === 'off') ? $v : '';
}

add_action('add_meta_boxes', 'wpreader_meta_box');
function wpreader_meta_box() {
    $o = wpreader_opts();
    foreach ((array) $o['post_types'] as $type) {
        add_meta_box('wpreader-switch', __('LISTEN', 'wordpress-reader'), 'wpreader_meta_box_html', $type, 'side', 'default');
    }
}

function wpreader_meta_box_html($post) {
    $o  = wpreader_opts();
    $sw = wpreader_post_switch($post->ID);
    $site_default = ($o['mode'] === 'marked')
        ? __('off (the site setting is "only articles I switch on")', 'wordpress-reader')
        : __('on (the site setting is "every article")', 'wordpress-reader');
    if (wpreader_only_ids($o)) {
        $site_default = __('only the listed post IDs (Settings -> Reader)', 'wordpress-reader');
    }
    wp_nonce_field('wpreader_switch', 'wpreader_switch_nonce');
    ?>
    <p style="margin:0 0 6px"><?php esc_html_e('Read this article aloud with a LISTEN button:', 'wordpress-reader'); ?></p>
    <p style="margin:0">
      <label><input type="radio" name="wpreader_switch" value="" <?php checked($sw, ''); ?>> <?php esc_html_e('Default', 'wordpress-reader'); ?>
        <span class="description" style="display:block;margin:0 0 6px 22px"><?php echo esc_html($site_default); ?></span></label>
      <label><input type="radio" name="wpreader_switch" value="on" <?php checked($sw, 'on'); ?>> <?php esc_html_e('On', 'wordpress-reader'); ?></label><br>
      <label><input type="radio" name="wpreader_switch" value="off" <?php checked($sw, 'off'); ?>> <?php esc_html_e('Off', 'wordpress-reader'); ?></label>
    </p>
    <p class="description" style="margin:8px 0 0"><?php esc_html_e('Or type [listen] anywhere in the text to put the button exactly there.', 'wordpress-reader'); ?></p>
    <?php
}

add_action('save_post', 'wpreader_save_switch', 10, 2);
function wpreader_save_switch($post_id, $post) {
    if (!isset($_POST['wpreader_switch_nonce'])) {
        return;   // the block editor saves the meta over REST; the classic form posts it here
    }
    if (!wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['wpreader_switch_nonce'])), 'wpreader_switch')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }
    $v = wpreader_sanitize_switch(isset($_POST['wpreader_switch']) ? wp_unslash($_POST['wpreader_switch']) : '');
    if ($v === '') {
        delete_post_meta($post_id, WPREADER_META);
    } else {
        update_post_meta($post_id, WPREADER_META, $v);
    }
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
    $out['mode']       = (isset($in['mode']) && $in['mode'] === 'marked') ? 'marked' : 'all';
    $out['only']       = trim((string) (isset($in['only']) ? $in['only'] : ''));
    $out['content']    = trim((string) (isset($in['content']) ? $in['content'] : ''));
    $out['title']      = trim((string) (isset($in['title']) ? $in['title'] : ''));
    $out['doc_prefix'] = sanitize_key((string) (isset($in['doc_prefix']) ? $in['doc_prefix'] : ''));
    $place             = isset($in['place']) ? (string) $in['place'] : 'headline';
    $out['place']      = in_array($place, array('headline', 'top', 'bottom'), true) ? $place : 'headline';
    // A checkbox that is not ticked is absent from the form, so absent means off
    // here -- but only here. A site that never saved the settings keeps the
    // default, which is on.
    $out['share']      = empty($in['share']) ? 0 : 1;

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
      <p><?php esc_html_e('Adds a LISTEN button to your articles and reads them aloud in the visitor\'s browser. Nothing is uploaded and no key is required.', 'wordpress-reader'); ?></p>

      <div style="max-width:720px;margin:12px 0 18px;padding:12px 16px;border-left:4px solid #2271b1;background:#fff">
        <p style="margin:0 0 6px"><strong><?php esc_html_e('Adding LISTEN to an article', 'wordpress-reader'); ?></strong></p>
        <ol style="margin:0 0 0 18px">
          <li><?php esc_html_e('With "Every article" selected below, every published article of the chosen types already has it. Open one and look beside the headline.', 'wordpress-reader'); ?></li>
          <li><?php esc_html_e('To choose article by article, select "Only articles I switch on", then in the editor sidebar of each article set the LISTEN box to On.', 'wordpress-reader'); ?></li>
          <li><?php esc_html_e('To put the button at an exact spot, type [listen] into the text where you want it. That also switches the reader on for that article.', 'wordpress-reader'); ?></li>
        </ol>
        <p style="margin:6px 0 0" class="description"><?php esc_html_e('Off in an article\'s LISTEN box always wins, so one article can be excluded whatever the site setting says.', 'wordpress-reader'); ?></p>
      </div>

      <form method="post" action="options.php">
        <?php settings_fields('wpreader'); ?>
        <table class="form-table" role="presentation">
          <tr>
            <th scope="row"><?php esc_html_e('Where it appears', 'wordpress-reader'); ?></th>
            <td>
              <label><input type="radio" name="wpreader_settings[mode]" value="all" <?php checked($o['mode'] !== 'marked'); ?>>
                <?php esc_html_e('Every article of the types below', 'wordpress-reader'); ?></label><br>
              <label><input type="radio" name="wpreader_settings[mode]" value="marked" <?php checked($o['mode'] === 'marked'); ?>>
                <?php esc_html_e('Only articles I switch on (the LISTEN box in the editor, or a [listen] shortcode)', 'wordpress-reader'); ?></label>
              <p class="description"><?php esc_html_e('Single articles only, either way. Archives, search results and the home page are always left alone.', 'wordpress-reader'); ?></p>
            </td>
          </tr>
          <tr>
            <th scope="row"><?php esc_html_e('Post types', 'wordpress-reader'); ?></th>
            <td>
              <?php foreach ($public as $t) : ?>
                <label style="margin-right:1em">
                  <input type="checkbox" name="wpreader_settings[post_types][]" value="<?php echo esc_attr($t->name); ?>"
                    <?php checked(in_array($t->name, (array) $o['post_types'], true)); ?>>
                  <?php echo esc_html($t->labels->name); ?>
                </label>
              <?php endforeach; ?>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="wpreader-only"><?php esc_html_e('Only these posts', 'wordpress-reader'); ?></label></th>
            <td>
              <input id="wpreader-only" name="wpreader_settings[only]" type="text" class="regular-text code"
                     value="<?php echo esc_attr($o['only']); ?>" placeholder="1469, 1502">
              <p class="description"><?php esc_html_e('Post IDs, comma separated. A quick way to try the reader on one article before turning it on everywhere. Empty means no restriction. An article switched On in its editor box is always included.', 'wordpress-reader'); ?></p>
            </td>
          </tr>
          <tr>
            <th scope="row"><?php esc_html_e('Button position', 'wordpress-reader'); ?></th>
            <td>
              <select name="wpreader_settings[place]">
                <option value="headline" <?php selected($o['place'], 'headline'); ?>><?php esc_html_e('Beside the headline', 'wordpress-reader'); ?></option>
                <option value="top" <?php selected($o['place'], 'top'); ?>><?php esc_html_e('Above the article text', 'wordpress-reader'); ?></option>
                <option value="bottom" <?php selected($o['place'], 'bottom'); ?>><?php esc_html_e('Below the article text', 'wordpress-reader'); ?></option>
              </select>
              <p class="description"><?php esc_html_e('A [listen] shortcode in the text overrides this for that article.', 'wordpress-reader'); ?></p>
            </td>
          </tr>
          <tr>
            <th scope="row"><?php esc_html_e('Share button', 'wordpress-reader'); ?></th>
            <td>
              <label>
                <input name="wpreader_settings[share]" type="checkbox" value="1" <?php checked(!empty($o['share'])); ?>>
                <?php esc_html_e('Add a SHARE button beside LISTEN, and one in the corner of the featured image', 'wordpress-reader'); ?>
              </label>
              <p class="description"><?php esc_html_e('Shares the article with its own card: the title, description and image your site already declares for social networks. On a phone the image travels with the link through the device\'s share sheet; elsewhere a small menu offers the networks, copy link and save image. Nothing is sent by the plugin itself.', 'wordpress-reader'); ?></p>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="wpreader-audio"><?php esc_html_e('Rendered audio store', 'wordpress-reader'); ?></label></th>
            <td>
              <input id="wpreader-audio" name="wpreader_settings[audio_root]" type="url" class="regular-text code"
                     value="<?php echo esc_attr($o['audio_root']); ?>" placeholder="https://deltaverse.pythai.net/audio">
              <p class="description"><?php esc_html_e('Optional. If a recording of a post exists there, the reader plays the file, which can be seeked and downloaded and is shown on the oscilloscope. Leave empty to use only the browser\'s own speech engine, which involves no third party. A store only answers hosts it has been told about, so this needs the store operator to allow your domain.', 'wordpress-reader'); ?></p>
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
            <th scope="row"><label for="wpreader-engine"><?php esc_html_e('Script source', 'wordpress-reader'); ?></label></th>
            <td>
              <input id="wpreader-engine" name="wpreader_settings[engine]" type="url" class="regular-text code"
                     value="<?php echo esc_attr($o['engine']); ?>">
              <p class="description"><?php esc_html_e('Where the reader files are served from. Leave as the default unless you host them yourself.', 'wordpress-reader'); ?></p>
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
