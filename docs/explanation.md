# Explanation

Why the reader is shaped the way it is. Every section here is a decision that
went the other way first.

## A voice is a selection, not a multiplier

The reader has a reference voice, `neural`, and other voices stated as ratios on
it — ×1.08 rate, ×1.08 pitch. That is a good design for *variation*, and it is
the wrong design for *identity*, which took a female voice to discover.

Jaimla was `rate 0.94, pitch 0.92` on neural: a shade slower, a shade lower. She
was also, therefore, a male voice pitched down and filed under a woman's name.
**Pitch is not gender.** Lowering a male voice drags its formants down with it and
produces a larger man; raising one produces a man in falsetto. Neither is a
woman, because what carries a voice's gender is the resonance of the instrument
and not the frequency it is driven at — and a multiplier cannot change the
instrument.

So there are two *saved* voices now, each holding its own record, and the
derivations hang off them. Jaimla asks the platform for a female voice by name;
where the page is rendered ahead, she is a female model. The measured difference
is the point: 183.8 Hz against neural's 94.6, where the old ratio version came
out at about 87 — *lower* than the voice it was supposed to differ from.

## The reference has no knob, not even one set to 1.0

`neural` is not edited, only derived from. Doing that properly means the
reference carries no tuning parameter at all — the renderer invokes piper with no
scaling flag, not with a flag set to a neutral value.

This is a fussy distinction that earns its keep. A `length_scale: 1.0` sitting in
neural's record is an invitation: it is 1.0 today and 0.98 the day someone decides
the reference reads a little fast, and at that moment every voice in the realm
has quietly moved, because they are all ratios on it. A field that exists will
eventually be set.

The reader also, deliberately, does **not** restore the last-used voice from
`localStorage`. Auditioning OVERLORD once used to make it the voice of the realm
on that machine forever. An audition is not a preference.

## Falling back into silence is not a fallback

The reader plays a rendered file when one exists and speaks with the browser's
synthesiser when one does not. The obvious error handler — if the file fails,
fall back to live synthesis — is wrong on exactly the machines that matter most.

A headless Linux box exposes `speechSynthesis` and enumerates **zero voices**.
Every utterance is dropped in silence, with no error. So "fall back to live" on
such a machine is a guaranteed silence, announced by a pause button claiming to
be playing — and it is precisely the machine that most needs the rendered file,
because it cannot synthesise anything at all.

Degrading from something that failed once to something that *cannot work* is
strictly worse than staying put and saying so. The reader now checks whether live
synthesis is possible before treating it as a destination, and where it is not,
it stops and explains rather than pretending.

The general rule: **never show a state the machine cannot be in.** A pause glyph
means audio is advancing. If nothing can advance, it must not be a pause glyph.

## Counting ticks is not measuring time

Voice enumeration is asynchronous everywhere and slow in places, so the reader
waits for it before starting. That wait was written as "20 ticks of a 100 ms
interval", which is two seconds — in a focused tab.

Chrome throttles timers in a hidden tab to roughly 1 Hz, and in a fully
backgrounded one to once a minute. Measured on a hidden page: a 100 ms interval
ticked every 947 ms. The two-second budget became twenty seconds, and could
become twenty-one minutes. Because every caller puts its whole bootstrap inside
that promise, the page rendered *nothing* for the duration — no controls, no
button, nothing to click. Opening the page in a background tab was enough to
trigger it.

A deadline must be wall-clock. Throttling can then delay when you *notice* the
deadline has passed; it can no longer multiply the deadline itself.

## An `<audio>` element cannot make anything louder

Its `volume` is an attenuator: it clamps at 1.0. This matters because ANCIENT is
a whisper by design and stays the quietest voice in the cast even after loudness
normalisation, so the deck has to be able to *amplify* — which means a Web Audio
gain stage, which means a graph. Gain reaches 400%, and everything above 100% is
the graph's work.

The taper is squared rather than linear, because loudness is not linear in the
ear: a linear knob spends most of its travel in the region where nothing much
changes.

## Two faces, one machine

The instrument deck owns no state. The plain controls are the truth; the knobs
read and write the same values through the same functions. That is what stops a
knob and its slider disagreeing — and they *did* disagree, for a subtler reason
than duplication.

The knob is continuous; the slider has a step of 0.02 from 0.6. A knob value of
1.25 is not on that grid, so the browser silently snapped the slider to a
neighbour while the stored value kept 1.25. The fix is to let the input be the
authority on what its own value can be: assign, then read back.

## A ratio cannot be measured against a claim

The octave under OVERLORD was first built by halving the body voice's `pitch`
parameter — 82 to 41 — on the strength of a sweep showing that parameter maps to
frequency almost linearly. That sweep ran at the default speaking rate. At this
voice's rate the map bends at the bottom: 82 measures 80.8 Hz and 41 measures
34.3 Hz, which is 1.24 octaves, not one. A fifth of an octave flat, shipped under
the word "exactly".

The interval is now searched for rather than assumed: render a probe, halve the
measured frequency, and binary-search the parameter until it lands there. It
reports the error it actually achieved — −22 cents, the granularity limit of an
integer parameter — instead of the error it intended.

The habit generalises. **A claim about a measurable quantity should carry the
measurement**, and where the measurement is awkward the claim is usually wrong.

## A layer in the intelligibility band is a second speaker

LEADER was meant to be "a slowed neural with leader overtones on it". I built it by
mixing an espeak voice onto the reference at 700–3200 Hz — and you heard two people.

That band is where speech is made *intelligible*. Anything with energy there forms words,
and anything that forms words is a speaker, however quiet you make it. So I moved it to
150–620 Hz, out of the way — and it stopped forming words and became a drone, which is
worse: now it was a second presence with nothing to say.

The mistake was the whole approach. Two voices saying the same thing is UNISON, and
unison is a real effect — it is what OVERLORD is built from, deliberately, because two
people speaking together is a sound with no single owner. It is not *character*. A leader
does not arrive with an accompanist.

What a broadcast desk does to a real presenter is the answer: cut where the voice is
muddy, lift where the words are, leave the rest alone. **One speaker, shaped.** LEADER is
the reference at pitch 0.88 and speed 0.92 with four bands — +2.5 dB of chest, −3.5 dB
through the 260–520 Hz mud that makes a low voice *heavy* rather than *deep*, +4 dB across
the consonant band, −2 dB of sibilance — and it measures deeper, cleaner and more present
at **0.0% WER**, the same as the reference. A voice that insists by being clearer rather
than louder.

The rule that generalises: **a layer inside the intelligibility band is a second speaker
no matter how quiet; outside it, it is a timbre no matter how loud.** If you want
character rather than company, shape the one voice you have.

## Two implementations of one thing will differ, and you will not hear it coming

The DeltaVerse audio store was supposed to be a clone of what mindX renders. It had
matching parameters — same model, same length-scale, same rate — and it still did not
sound the same, because two things differed that are not parameters:

- **The synthesiser call.** Each side shelled out to piper itself: same binary, same
  flags, two implementations. They had already drifted once over exactly that.
- **The encoder.** mindX writes through the system libsndfile via ctypes; the store used
  `opusenc --bitrate 24`. Two encoders at 24 kbps do not leave the same artefacts, and at
  that bitrate the artefacts ARE the character.

No amount of agreeing on numbers closes that, because the numbers were never what
differed. The fix was to stop agreeing and start *calling*: the store is produced BY
docspeech's engine and encoder, and is a caller of the definition rather than a copy of
it. Both sides now report the same two strings, which is the check —
`piper:en_GB-alan-medium · libsndfile:opus`.

The same lesson arrived a third time in the standalone player, which kept its own table
of voices: OVERLORD as an espeak mix, LEADER as plain espeak, H.A.L on the wrong base.
Every entry was true when written and none was true a day later. **A copy of a definition
is a definition that will be wrong; the only question is when.**

## Text, not markup, crosses a trust boundary

When the reader ingests another page, nothing of that page's markup enters this
one. The response is parsed by `DOMParser`, which builds an inert document with
no browsing context — its scripts never run and its images never load — and only
*text* is taken out of it, rebuilt locally with `textContent` under a tag name
chosen from a fixed list.

Sanitising markup is a filter, and filters are lost: someone adds a feature, an
attribute slips through, and the boundary is gone without anyone noticing.
Extracting text is a boundary you cannot lose, because there is no path by which
markup could arrive.

The same instinct rules out the proxy that would make cross-origin reading work.
A server that fetches any URL it is handed is an open relay into everything it
can reach, including its own private network. The reader says it cannot read a
host instead.
