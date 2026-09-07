<?php
// Enough of WordPress to exercise the plugin's decisions. Only the functions the
// non-admin path actually calls; anything else would be inventing behaviour.
define('ABSPATH', '/wp/');
$GLOBALS['T'] = ['singular' => ['post'], 'id' => 1469, 'option' => [], 'meta' => [], 'content' => []];

function get_option($k, $d = false) { return $GLOBALS['T']['option'][$k] ?? $d; }
function wp_parse_args($a, $d) { return array_merge($d, is_array($a) ? $a : []); }
function is_singular($types = '') {
    $t = (array) $types;
    return (bool) array_intersect($t, $GLOBALS['T']['singular']);
}
function get_the_ID() { return $GLOBALS['T']['id']; }
function home_url() { return 'https://rage.pythai.net'; }
function wp_parse_url($u, $c = -1) { return parse_url($u, $c); }
function sanitize_key($k) { return preg_replace('/[^a-z0-9_\-]/', '', strtolower($k)); }
function esc_url_raw($u) { return $u; }
function untrailingslashit($s) { return rtrim($s, '/'); }
function get_post_types($a = [], $o = 'names') { return ['post' => 'post', 'page' => 'page']; }
function add_action() {} function add_filter() {} function register_setting() {}
function add_options_page() {} function get_the_title($i = 0) { return 'A title'; }
function wp_strip_all_tags($s) { return strip_tags($s); }
function wp_json_encode($v) { return json_encode($v); }
function plugin_basename($f) { return 'wordpress-reader/wordpress-reader.php'; }
function add_shortcode() {} function register_post_meta() {}
function get_post_meta($id, $k, $single = false) { return $GLOBALS['T']['meta'][$id][$k] ?? ''; }
function get_post_field($f, $id) { return $GLOBALS['T']['content'][$id] ?? ''; }
function has_shortcode($content, $tag) { return strpos($content, '[' . $tag) !== false; }
function shortcode_atts($pairs, $atts, $tag = '') { return array_merge($pairs, is_array($atts) ? $atts : []); }

// Run from wordpress/plugin/ with:
//   docker run --rm -v "$PWD:/w:ro" -w /w php:8.3-cli php tests/plugin_test.php
require '/w/wordpress-reader/wordpress-reader.php';

$fail = 0;
function is_it($label, $got, $want) {
    global $fail;
    $ok = $got === $want;
    if (!$ok) { $fail++; }
    printf("%-4s %-52s got=%-28s want=%s\n", $ok ? 'PASS' : 'FAIL', $label,
        json_encode($got), json_encode($want));
}
function reset_t() { $GLOBALS['T'] = ['singular' => ['post'], 'id' => 1469, 'option' => [], 'meta' => [], 'content' => []]; }

// defaults: every post of type post, no allowlist
is_it('loads on a single post by default', wpreader_should_load(), true);
is_it('store id from the domain', wpreader_doc_id(1469), 'rage-1469');

// an allowlist naming this post
$GLOBALS['T']['option']['wpreader_settings'] = ['only' => '1469'];
is_it('allowlist naming this post', wpreader_should_load(), true);

// an allowlist naming another
$GLOBALS['T']['option']['wpreader_settings'] = ['only' => '1502, 1600'];
is_it('allowlist naming another post', wpreader_should_load(), false);
is_it('ids parsed from loose separators', wpreader_only_ids(), [1502, 1600]);

// an empty allowlist must never mean "off"
$GLOBALS['T']['option']['wpreader_settings'] = ['only' => '   '];
is_it('empty allowlist means no restriction', wpreader_should_load(), true);

// a listing page is never read aloud
$GLOBALS['T']['singular'] = [];
$GLOBALS['T']['option']['wpreader_settings'] = [];
is_it('inert on an archive or the home page', wpreader_should_load(), false);
$GLOBALS['T']['singular'] = ['post'];

// a post type that is not selected
$GLOBALS['T']['option']['wpreader_settings'] = ['post_types' => ['page']];
is_it('inert on a type that is not selected', wpreader_should_load(), false);

// ── the per-article switch ──
reset_t();
$GLOBALS['T']['meta'][1469]['_wpreader'] = 'off';
is_it('Off on the article wins over "every article"', wpreader_should_load(), false);
$GLOBALS['T']['option']['wpreader_settings'] = ['only' => '1469'];
is_it('Off on the article wins over the allowlist', wpreader_should_load(), false);

reset_t();
$GLOBALS['T']['option']['wpreader_settings'] = ['mode' => 'marked'];
is_it('"only articles I switch on": unmarked is off', wpreader_should_load(), false);
$GLOBALS['T']['meta'][1469]['_wpreader'] = 'on';
is_it('"only articles I switch on": On is on', wpreader_should_load(), true);
$GLOBALS['T']['meta'][1469]['_wpreader'] = '';
$GLOBALS['T']['content'][1469] = 'Some prose. [listen] More prose.';
is_it('a [listen] shortcode switches the article on', wpreader_should_load(), true);
$GLOBALS['T']['meta'][1469]['_wpreader'] = 'off';
is_it('Off still wins over a shortcode', wpreader_should_load(), false);

reset_t();
$GLOBALS['T']['option']['wpreader_settings'] = ['only' => '1502'];
$GLOBALS['T']['meta'][1469]['_wpreader'] = 'on';
is_it('On on the article wins over an allowlist that omits it', wpreader_should_load(), true);
$GLOBALS['T']['meta'][1469]['_wpreader'] = 'garbage';
is_it('an unknown switch value reads as default', wpreader_post_switch(1469), '');
is_it('the switch sanitiser keeps on/off only', wpreader_sanitize_switch(' ON '), 'on');
is_it('the switch sanitiser drops anything else', wpreader_sanitize_switch('maybe'), '');

// the shortcode prints an inert slot
is_it('[listen] prints the slot', wpreader_shortcode([]), '<span class="wp-reader-listen" data-noread="1"></span>');
is_it('[listen share="yes"] asks for SHARE too', wpreader_shortcode(['share' => 'yes']), '<span class="wp-reader-listen" data-noread="1" data-share="1"></span>');

// sanitising
reset_t();
$s = wpreader_sanitize(['engine' => '', 'post_types' => [], 'only' => 'x12y, 13', 'doc_prefix' => 'RAGE!!', 'mode' => 'weird', 'place' => 'sideways']);
is_it('blank engine falls back to the default', $s['engine'], WPREADER_ENGINE_DEFAULT);
is_it('no post types selected is not "off"', $s['post_types'], ['post']);
is_it('junk post types are dropped', wpreader_sanitize(['post_types' => ['post', 'nope']])['post_types'], ['post']);
is_it('prefix is sanitised to a key', $s['doc_prefix'], 'rage');
is_it('an unknown mode reads as "all"', $s['mode'], 'all');
is_it('an unknown place reads as "headline"', $s['place'], 'headline');
is_it('"marked" mode is kept', wpreader_sanitize(['mode' => 'marked'])['mode'], 'marked');
is_it('"bottom" place is kept', wpreader_sanitize(['place' => 'bottom'])['place'], 'bottom');

// SHARE: on by default, off only when the saved form leaves the box unticked
$GLOBALS['T']['option']['wpreader_settings'] = [];
is_it('share is on by default', wpreader_opts()['share'], 1);
is_it('an unticked share box saves as off', wpreader_sanitize(['engine' => 'x'])['share'], 0);
is_it('a ticked share box saves as on', wpreader_sanitize(['share' => '1'])['share'], 1);
$GLOBALS['T']['option']['wpreader_settings'] = ['share' => 0];
is_it('a saved off stays off', wpreader_opts()['share'], 0);

printf("\n%s\n", $fail ? "$fail FAILED" : 'all passed');
exit($fail ? 1 : 0);
