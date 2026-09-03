#!/usr/bin/env bash
# install_voices.sh — put mindX's own espeak-ng voice variants where espeak-ng looks.
#
# espeak-ng resolves "en-gb+leaderofearth" by reading <data>/voices/!v/leaderofearth.
# It only ever looks inside its own data directory, so a variant living in this repo is
# invisible until it is copied there. This script does that copy and then PROVES it
# worked by synthesising with the variant — an install that is not verified is a guess.
#
#   sudo mindx_backend_service/voices/install_voices.sh
#
# Idempotent. Re-run after editing a variant file; espeak-ng reads them at synth time,
# so no service restart is needed for a voice change (the mindX service caches nothing
# about voices except rendered audio, which is keyed by voice and so simply misses).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/espeak-ng/!v"
BSRC="$HERE/espeak-ng/voices"          # full voice files (accents), not variants
[ -d "$SRC" ] || { echo "no variants at $SRC" >&2; exit 1; }

BIN="$(command -v espeak-ng || command -v espeak || true)"
[ -n "$BIN" ] || { echo "espeak-ng is not installed (apt install espeak-ng)" >&2; exit 1; }

# Ask espeak-ng where its data lives rather than guessing a distro path.
DATA=""
for d in /usr/share/espeak-ng-data /usr/lib/x86_64-linux-gnu/espeak-ng-data \
         /usr/local/share/espeak-ng-data "${ESPEAK_DATA_PATH:-}"; do
  [ -n "$d" ] && [ -d "$d/voices" ] && { DATA="$d"; break; }
done
[ -n "$DATA" ] || { echo "could not locate espeak-ng-data; set ESPEAK_DATA_PATH" >&2; exit 1; }

DEST="$DATA/voices/!v"
mkdir -p "$DEST"
n=0
for f in "$SRC"/*; do
  [ -f "$f" ] || continue
  install -m 0644 "$f" "$DEST/$(basename "$f")"
  echo "installed $(basename "$f") -> $DEST/"
  n=$((n+1))
done
echo "$n variant(s) installed into $DATA"

# Full voice files — the ones that may redefine phonemes.
#
# A !v/ variant may NOT: espeak-ng parses `replace` in a variant file and then
# silently ignores it (verified: en-gb+rtest is byte-identical to en-gb). An
# accent therefore has to be a whole voice, and whole voices live one level up,
# in <data>/voices/<dir>/. That is where en-earth goes.
BDEST="$DATA/voices/mindx"
bn=0
if [ -d "$BSRC" ]; then
  mkdir -p "$BDEST"
  for f in "$BSRC"/*; do
    [ -f "$f" ] || continue
    install -m 0644 "$f" "$BDEST/$(basename "$f")"
    echo "installed voice $(basename "$f") -> $BDEST/"
    bn=$((bn+1))
  done
  echo "$bn voice(s) installed into $BDEST"
fi

# Verify by DIFFERENCE, not by success.
#
# A variant that espeak-ng cannot find is not an error and is not silence: it renders
# the BASE voice, unmodified. So "it produced a WAV" proves nothing. The only honest
# check is to synthesise the base and the base+variant and require them to DIFFER.
#
# This caught a real one: `en-gb+leaderofearth` was byte-identical to `en-gb`, because
# en-gb is itself an alias/variant of en and espeak-ng silently drops a variant stacked
# on another variant. en-gb-x-rp (real RP) accepts it. Never use en-gb as a variant base.
echo
fail=0
for f in "$SRC"/*; do
  v="$(basename "$f")"
  # the base the variant declares: the `language <code>` line that is not `language variant`
  base="$(awk '$1=="language" && $2!="variant" {print $2; exit}' "$f")"
  base="${base:-en-us}"
  bw="$(mktemp)"; vw="$(mktemp)"
  "$BIN" -v "$base"     --stdout "mindX voice check, $v." > "$bw" 2>/dev/null || true
  "$BIN" -v "$base+$v"  --stdout "mindX voice check, $v." > "$vw" 2>/dev/null || true
  if [ ! -s "$vw" ] || [ "$(stat -c %s "$vw")" -lt 45 ]; then
    echo "FAIL $base+$v  produced no audio" >&2; fail=1
  elif cmp -s "$bw" "$vw"; then
    echo "FAIL $base+$v  IDENTICAL to base '$base' — the variant is being ignored." >&2
    echo "     (if base is en-gb, use en-gb-x-rp: a variant cannot stack on an alias)" >&2
    fail=1
  else
    echo "OK   $base+$v  differs from base ($(stat -c %s "$bw") vs $(stat -c %s "$vw") bytes)"
  fi
  rm -f "$bw" "$vw"
done

# Verify the full voices by PHONEMES, and check every word survives.
#
# Two traps, both hit for real while building en-earth:
#
#  1. `phonemes en-wi` imports the West Indies phoneme TABLE, not en-029's own
#     replace rules — those live in the voice file. Inheriting the table alone
#     silently lost TH-stopping: en-earth said "DIs" where en-029 says "dIs".
#
#  2. A replace whose TARGET is not in the table does not fail and does not
#     no-op: it DELETES the phoneme. `replace 00 i: @i` passed a naive
#     difference check and left "three" as [T*], a word with no vowel in it.
#
# So the check is: the phoneme stream must differ from the plain table base
# (the rules fired), the word count must be unchanged, and every word must
# still contain a vowel (nothing was eaten).
if [ "$bn" -gt 0 ]; then
  echo
  PROBE="this thing three sure thought talk bird nurse run love milk little happy about better nature square fleece kit dress trap"
  NW="$(echo $PROBE | wc -w)"
  for f in "$BSRC"/*; do
    [ -f "$f" ] || continue
    v="$(awk '$1=="language" {print $2; exit}' "$f")"
    tbl="$(awk '$1=="phonemes" {print $2; exit}' "$f")"
    if ! "$BIN" --voices 2>/dev/null | awk '{print $5}' | grep -qx "mindx/$(basename "$f")"; then
      echo "FAIL voice $v  espeak-ng does not list it (bad 'language' line?)" >&2; fail=1; continue
    fi
    out="$(echo "$PROBE" | "$BIN" -v "$v" -x -q 2>/dev/null | tr -s ' ')"
    ref="$(echo "$PROBE" | "$BIN" -v "${tbl:-en}" -x -q 2>/dev/null | tr -s ' ')"
    n="$(echo $out | wc -w)"
    novowel=0
    for tok in $out; do echo "$tok" | grep -qE '[iIEaAuUV03O@eo]' || novowel=$((novowel+1)); done
    # SCHWA COLLAPSE. A voice whose dictionary or phoneme table does not resolve
    # does not error and does not fall silent — it returns EVERY word as `@@@_::`,
    # schwas with the length marks still attached. That passes the word count
    # (each blob is a token) and passes the nucleus check (@ IS a vowel), so both
    # existing traps are blind to it. Caught in the wild: `phonemes en-gb-scotland`
    # names a VOICE, not a table, and en-druid shipped saying nothing at all.
    schwa=0
    for tok in $out; do echo "$tok" | grep -qE '^[@_:'"'"']+$' && schwa=$((schwa+1)); done
    if [ "$out" == "$ref" ]; then
      echo "FAIL voice $v  phonemes IDENTICAL to table '$tbl' — no replace rule fired." >&2; fail=1
    elif [ "$n" != "$NW" ]; then
      echo "FAIL voice $v  word count $n != $NW — a replace target is not in the table." >&2; fail=1
    elif [ "$novowel" != "0" ]; then
      echo "FAIL voice $v  $novowel word(s) lost their vowel — a replace ATE a nucleus." >&2; fail=1
    elif [ "$schwa" -gt 2 ]; then
      echo "FAIL voice $v  $schwa word(s) are schwa-only — the phoneme table or dictionary" >&2
      echo "     did not resolve. \`phonemes\` takes a TABLE (en, en-wi), not a voice name." >&2; fail=1
    else
      echo "OK   voice $v  differs from table '$tbl', $n/$NW words intact, all nuclei present"
    fi
  done
fi
exit $fail
