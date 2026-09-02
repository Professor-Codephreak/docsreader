// Build the substrate instrument rack island → ../static/substrate_rack.js
// (committed artifact, served at /static/substrate_rack.js — the VPS never
// needs node; rebuild locally only when the rack changes).
import { build } from 'esbuild'

const TARGETS = [
  ['src/substrate_rack.jsx', '../static/substrate_rack.js'],
  ['src/audio_rack.jsx', '../static/audio_rack.js'],
]

for (const [entry, outfile] of TARGETS) {
const result = await build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2019'],
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile,
  logLevel: 'info',
  metafile: true,
})

const out = Object.entries(result.metafile.outputs)[0]
console.log(`built ${out[0]} — ${(out[1].bytes / 1024).toFixed(1)} KB`)
}
