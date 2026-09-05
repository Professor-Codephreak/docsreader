=== wordpress.reader ===
Contributors: professorcodephreak
Tags: accessibility, text to speech, audio, listen, read aloud
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.2
Stable tag: 1.0.0
License: Apache-2.0
License URI: https://www.apache.org/licenses/LICENSE-2.0

Adds a LISTEN button to your posts and reads them aloud on the page, lighting each word as it says it.

== Description ==

A reader that speaks the article it is already inside. Press LISTEN and a small
panel opens and starts reading in the same gesture, marking each word as it is
spoken so you can follow, look away, and find your place again.

It runs entirely in the visitor's browser, using the speech engine their device
already has. There is no account, no API key, no audio stored on your server and
no request to anywhere. Your content is not uploaded, because it does not have to
be: the text is in the page, which is where a reader should be looking.

**Optional rendered audio.** If you point the plugin at an audio store that
already holds a recording of a post, it will play that file instead: it starts
instantly, seeks, scrubs, and can be downloaded. When nothing has been rendered
for a post, or no store is configured, it speaks with the browser's own engine.
The reader always says which of the two it is doing.

**Try it on one article first.** Put a post ID in "Only these posts" and the
reader appears there and nowhere else. Clear the field to enable it everywhere.
An empty field means no restriction, so a half-finished setting cannot quietly
switch the reader off.

= Why this is a plugin and not a snippet =

The same reader also runs from three script tags in a footer widget, and that
version works. What it cannot do is know anything: it has to infer which post it
is on from a CSS class and find the article by trying the selectors themes tend
to use. On its first real install that inference reached past the article and the
reader read the site footer aloud.

WordPress already knows the post ID, the content element and the title. This
plugin hands the reader all three, and loads it only on pages where it will be
used.

== Installation ==

1. Plugins -> Add New -> Upload Plugin, choose the .zip, Install Now, Activate.
2. Settings -> Reader.
3. Optional: put one post ID in "Only these posts" to try it on a single article.
4. Open that post. The LISTEN button appears beside the headline.

== Frequently Asked Questions ==

= Does it send my content anywhere? =

No. The reader speaks text that is already on the page, using the browser's own
speech engine. Nothing is uploaded and nothing is stored.

If you configure a rendered-audio store, the browser asks that store whether it
holds a recording of the post. That request carries the post's store id and
nothing else, and it is only made when you have set a store.

= Why is there no LISTEN button on my archive or home page? =

By design. Reading a page of excerpts aloud is reading a table of contents. The
reader appears on single posts only.

= The button is missing, or it reads the wrong part of the page =

Your theme names its article element something the reader does not try. Put the
right selectors into Settings -> Reader under "Theme selectors" -- usually
`.entry-content` and `h1.entry-title`.

= Does it need JavaScript? =

Yes. Without it, the page is exactly as it was: nothing is added and nothing
breaks.

= Which voices are available? =

Whatever the visitor's browser offers, plus the named voices the reader defines
on top of them. The default is the same on every visit rather than remembered,
because auditioning a voice is not choosing one.

== Screenshots ==

1. The LISTEN button beside the headline.
2. The panel open, reading, with the current word lit.
3. Settings -> Reader.

== Changelog ==

= 1.0.0 =
* First release.
* Post ID allowlist, so a first install can cover one article.
* Optional rendered-audio store, with the browser's own engine as the fallback.
* Signature and provenance blocks inside the content are skipped rather than read.

== Upgrade Notice ==

= 1.0.0 =
First release.
