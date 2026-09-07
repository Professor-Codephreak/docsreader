=== wordpress.reader ===
Contributors: professorcodephreak
Tags: accessibility, text to speech, audio, listen, read aloud, share
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.2
Stable tag: 1.2.0
License: Apache-2.0
License URI: https://www.apache.org/licenses/LICENSE-2.0

Adds LISTEN and SHARE to your articles: reads them aloud on the page, lighting each word as it says it, and shares the article with its own image.

== Description ==

A reader that speaks the article it is already inside. Press LISTEN and a small
player opens and starts reading in the same gesture, marking each word as it is
spoken so you can follow, look away, and find your place again. While it reads,
the same button says STOP.

It runs entirely in the visitor's browser, using the speech engine their device
already has. There is no account, no API key, no audio stored on your server and
no request to anywhere. Your content is not uploaded, because it does not have to
be: the text is in the page, which is where a reader should be looking.

**The player.** A timeline you can take hold of and drag to any point; an
oscilloscope showing the audio that is actually playing; a labelled DOWNLOAD
button; a voice chooser; a rate slider; and the article as a track list, with
the row being read showing every word as it is said. The player can be dragged
anywhere on the screen by any quiet part of it, resized from its corner, and
remembers where you left it.

**Optional rendered audio.** If you point the plugin at an audio store that
already holds a recording of a post, it plays that file instead: it starts
instantly, seeks to the second, shows on the scope, and downloads. When nothing
has been rendered for a post, or no store is configured, it speaks with the
browser's own engine. The player always says which of the two it is doing, and
it never draws a waveform for a signal it cannot see.

**Share, from the image.** Beside LISTEN there is SHARE, and the featured
image carries the same control in its corner. It shares the card your site
already declares for social networks (the Open Graph title, description and
image), so what the reader is handed is what the network will render. On a
phone the image file travels with the link through the device's own share
sheet; elsewhere a small menu offers X, Facebook, LinkedIn, Reddit, Pinterest,
Telegram, WhatsApp, email, copy link and save image, with the card previewed
above them. The plugin sends nothing itself. Turn it off in Settings -> Reader.

= Adding LISTEN to an article =

1. With **Every article** selected in Settings -> Reader (the default), every
   published article of the chosen post types already has it. Open one and look
   beside the headline.
2. To choose article by article, select **Only articles I switch on**, then in
   the editor sidebar of each article set the **LISTEN** box to *On*.
3. To put the button at an exact spot, type `[listen]` into the text where you
   want it. That also switches the reader on for that article.

*Off* in an article's LISTEN box always wins, so one article can be excluded
whatever the site setting says. "Only these posts" (post IDs) is a quick way to
try it on a single article first.

= Why this is a plugin and not a snippet =

The same reader also runs from four script tags in a footer widget, and that
version works. What it cannot do is know anything: it has to infer which post it
is on from a CSS class and find the article by trying the selectors themes tend
to use. On its first real install that inference reached past the article and the
reader read the site footer aloud.

WordPress already knows the post ID, the content element and the title. This
plugin hands the reader all three, and loads it only on pages where it will be
used.

== Installation ==

1. Download `wordpress-reader.zip`.
2. In your WordPress admin go to **Plugins -> Add New Plugin -> Upload Plugin**,
   choose the zip, **Install Now**, then **Activate**.
3. Open **Settings -> Reader**. The defaults put LISTEN beside the headline of
   every post. Nothing else is required.
4. Open any post. The LISTEN button is beside the headline; press it.

The reader's scripts load from `https://deltaverse.pythai.net/engine/ngn/` by
default. Change **Script source** if you host copies yourself.

== Frequently Asked Questions ==

= Does it send my content anywhere? =

No. The reader speaks text that is already on the page, using the browser's own
speech engine. Nothing is uploaded and nothing is stored.

If you configure a rendered-audio store, the browser asks that store whether it
holds a recording of the post. That request carries the post's store id and
nothing else, and it is only made when you have set a store.

= How do I add LISTEN to one particular article? =

Open the article in the editor and set the LISTEN box in the sidebar to On, or
type `[listen]` where you want the button. Either works whatever the site
setting says.

= How do I keep it off one article? =

Set that article's LISTEN box to Off.

= Why is there no LISTEN button on my archive or home page? =

By design. Reading a page of excerpts aloud is reading a table of contents. The
reader appears on single posts only.

= The button is missing, or it reads the wrong part of the page =

Your theme names its article element something the reader does not try. Put the
right selectors into Settings -> Reader under "Theme selectors" -- usually
`.entry-content` and `h1.entry-title`.

= The player is in the way =

Drag it by any part that is not a control, or by the grip in its title bar.
Double-click the title bar to send it back to the corner. The shrink button
folds it to a bar.

= Does it need JavaScript? =

Yes. Without it, the page is exactly as it was: nothing is added and nothing
breaks.

= Which voices are available? =

Whatever the visitor's browser offers, plus the named voices the reader defines
on top of them. The default is the same on every visit rather than remembered,
because auditioning a voice is not choosing one.

== Screenshots ==

1. The LISTEN button beside the headline.
2. The player open, reading, with the current word lit and the scope live.
3. The LISTEN box in the editor sidebar.
4. Settings -> Reader.

== Changelog ==

= 1.2.0 =
* The per-article switch: a LISTEN box (Default / On / Off) in the editor sidebar of every post type the reader is enabled for.
* The `[listen]` shortcode places the button exactly where it is typed and switches the reader on for that article. `[listen share="yes"]` brings SHARE along.
* Settings -> Reader: "Where it appears" (every article, or only articles switched on), "Button position" (headline, above the text, below the text), and an "Adding LISTEN to an article" panel.
* The player, from the engine: a draggable timeline that seeks to the second on rendered audio and to the block on live synthesis; an oscilloscope on the playing signal (and a flat, labelled line when there is no signal to tap); a labelled DOWNLOAD button; drag from anywhere that is not a control, with the position remembered; the voice description text is gone.

= 1.1.0 =
* SHARE, from the image: a button beside LISTEN and one in the corner of the featured image, sharing the page's own Open Graph card. The device share sheet carries the image file where the platform allows; otherwise a menu of networks, copy link and save image.
* Settings -> Reader gains a "Share button" switch (on by default).

= 1.0.0 =
* First release.
* Post ID allowlist, so a first install can cover one article.
* Optional rendered-audio store, with the browser's own engine as the fallback.
* Signature and provenance blocks inside the content are skipped rather than read.

== Upgrade Notice ==

= 1.2.0 =
Adds the per-article LISTEN box and the [listen] shortcode. Existing settings are kept; nothing switches off.

= 1.1.0 =
Adds the SHARE button. Nothing else changes; switch it off in Settings -> Reader if you do not want it.

= 1.0.0 =
First release.
