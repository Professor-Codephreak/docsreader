<?php
// Enough of WordPress to exercise the plugin's decisions. Only the functions the
// non-admin path actually calls; anything else would be inventing behaviour.
define('ABSPATH', '/wp/');
$GLOBALS['T'] = ['singular' => ['post'], 'id' => 1469, 'option' => []];

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

// Run from wordpress/plugin/ with:
//   docker run --rm -v "$PWD:/w:ro" -w /w php:8.3-cli php tests/plugin_test.php
require '/w/wordpress-reader/wordpress-reader.php';

$fail = 0;
function is_it($label, $got, $want) {
    global $fail;
    $ok = $got === $want;
    if (!$ok) { $fail++; }
    printf("%-4s %-46s got=%-28s want=%s\n", $ok ? 'PASS' : 'FAIL', $label,
        json_encode($got), json_encode($want));
}

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

// sanitising
$s = wpreader_sanitize(['engine' => '', 'post_types' => [], 'only' => 'x12y, 13', 'doc_prefix' => 'RAGE!!']);
is_it('blank engine falls back to the default', $s['engine'], WPREADER_ENGINE_DEFAULT);
is_it('no post types selected is not "off"', $s['post_types'], ['post']);
is_it('junk post types are dropped', wpreader_sanitize(['post_types' => ['post', 'nope']])['post_types'], ['post']);
is_it('prefix is sanitised to a key', $s['doc_prefix'], 'rage');

exit($fail ? 1 : 0);
