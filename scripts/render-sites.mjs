#!/usr/bin/env node
/*
 * render-sites.mjs — render the audio of many pages, in one voice or many, and hand back a standalone
 * player with the measurements beside every file.
 *
 * WHAT IT DOES. For each URL it asks the render host to ingest the page into blocks (the host's own
 * fetch guard applies — it will refuse what a browser could not read), then asks for a render of those
 * blocks in each voice you name. The host keys renders by (voice, text), so a page rendered before is
 * served from its store and the ledger says `cached: true`. Two modes, which are the same loop:
 *
 *   single voice, single read     node render-sites.mjs https://rage.pythai.net/some-article/
 *   many voices, many reads       node render-sites.mjs --voices neural,jaimla,leaderofearth sites.txt
 *
 * "read" is one document. A file of URLs (one per line, # comments) is many reads. `--voices` is the
 * cast to render each read in. Nothing is transcoded, nothing is re-encoded: what the host measured
 * is what is written down — realtime factor, synthesis seconds, audio seconds, bytes, blocks, words —
 * and that is the FEEDBACK the player shows beside each file, so the person who installs it can see
 * what a voice costs before they pick it.
 *
 * WHAT IT WRITES (under --out, default ./renders)
 *   ledger.json                    every render: url, voice, key, seconds, bytes, rtf, cached, engine
 *   <slug>/<voice>.json            the host's manifest for that read in that voice (urls absolute)
 *   <slug>/playlist.m3u            one line per voice, the audio URL — plays in any player
 *   player.html                    the standalone player: pick a read, pick a voice, listen; the
 *                                  feedback table under it is the ledger, nothing more
 *
 * EASY TO INSTALL. The output is static: copy the directory anywhere (a docroot, IPFS, a USB stick)
 * and player.html works, because the audio it points at is served by the render host with the
 * CORS headers the host already sends to pythai.net surfaces, and everything else is inline.
 *
 * Zero dependencies. Node 18+. The host is any docsplayer (--host, default deltaverse.pythai.net).
 *
 *   --host URL        render host (default https://deltaverse.pythai.net)
 *   --voices a,b,c    voices to render (default neural) — see GET /docsplayer/voices
 *   --out DIR         output directory (default ./renders)
 *   --formats a,b     opus (default); add vorbis or wav where the host offers them
 *   --concurrency N   parallel renders (default 1 — the host is a small box and queues anyway)
 *   --dry             ingest and plan, render nothing
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = { host: 'https://deltaverse.pythai.net', voices: ['neural'], out: './renders', formats: ['opus'], concurrency: 1, dry: false };
const inputs = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--host') opt.host = args[++i];
  else if (a === '--voices') opt.voices = args[++i].split(',').map(s => s.trim()).filter(Boolean);
  else if (a === '--out') opt.out = args[++i];
  else if (a === '--formats') opt.formats = args[++i].split(',').map(s => s.trim()).filter(Boolean);
  else if (a === '--concurrency') opt.concurrency = Math.max(1, parseInt(args[++i], 10) || 1);
  else if (a === '--dry') opt.dry = true;
  else if (a === '-h' || a === '--help') { console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0]); process.exit(0); }
  else inputs.push(a);
}
if (!inputs.length) { console.error('give at least one URL, or a file of URLs. --help for the rest.'); process.exit(2); }
opt.host = opt.host.replace(/\/+$/, '');

// URLs, or files of URLs: a line that is not a URL is read as a file
const reads = [];
for (const inp of inputs) {
  if (/^https?:\/\//i.test(inp)) reads.push(inp);
  else if (existsSync(inp)) {
    for (const line of readFileSync(inp, 'utf8').split(/\r?\n/)) {
      const t = line.trim(); if (!t || t.startsWith('#')) continue;
      if (/^https?:\/\//i.test(t)) reads.push(t); else console.warn('skipped (not a URL): ' + t);
    }
  } else console.warn('skipped (neither URL nor file): ' + inp);
}
if (!reads.length) { console.error('nothing to read.'); process.exit(2); }

const slug = u => { try { const x = new URL(u); return (x.host + x.pathname).replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80) || 'page'; } catch { return 'page'; } };
const abs = u => (/^https?:/i.test(u) ? u : opt.host + u);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { throw new Error('HTTP ' + r.status + ' and not JSON: ' + t.slice(0, 120)); } };

async function ingest(url) {
  const r = await fetch(opt.host + '/docsplayer/ingest?url=' + encodeURIComponent(url), { headers: { Accept: 'application/json' } });
  const j = await json(r);
  if (!r.ok) throw new Error(j.detail || j.error || ('ingest HTTP ' + r.status));
  const blocks = (j.blocks || []).map(b => ({ text: String(b.text || ''), tag: b.tag || 'p' })).filter(b => b.text.trim());
  if (!blocks.length) throw new Error('the host found no readable blocks on this page');
  return { title: j.title || url, blocks, words: blocks.reduce((a, b) => a + (b.text.match(/\S+/g) || []).length, 0) };
}
async function settle(r) {
  const j = await json(r);
  if (r.status === 202 || (j && j.queued)) return awaitJob(j.job, j.key);
  if (!r.ok) throw new Error(j.detail || j.error || ('render HTTP ' + r.status));
  return j;
}
async function awaitJob(job, key) {
  const t0 = Date.now(); let last = '';
  for (;;) {
    const r = await fetch(opt.host + '/docsplayer/progress?job=' + encodeURIComponent(job), { cache: 'no-store' }).catch(() => null);
    const d = r && r.ok ? await r.json().catch(() => null) : null;
    if (d) {
      const line = `${d.state}${d.blocksTotal ? ' ' + (d.blocksDone || 0) + '/' + d.blocksTotal : ''}${d.rtf ? ' ' + d.rtf.toFixed(2) + 'x' : ''}${d.eta != null ? ' eta ' + Math.round(d.eta) + 's' : ''}`;
      if (line !== last) { process.stdout.write('    ' + line + '\n'); last = line; }
      if (d.state === 'done') { const m = await fetch(opt.host + '/docsplayer/render/' + key); return json(m); }
      if (d.state === 'failed') throw new Error(d.error || 'the render failed on the host');
    }
    if (Date.now() - t0 > 60 * 60 * 1000) throw new Error('gave up after an hour');
    await sleep(1500);
  }
}
async function render(url, title, blocks, voice) {
  const job = 'rs_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const r = await fetch(opt.host + '/docsplayer/render', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title, voice, formats: opt.formats, blocks, job }),
  });
  if (r.status === 429) throw new Error('the host asked this address to slow down (429) — try again in a few minutes');
  return settle(r);
}

const outDir = resolve(opt.out); mkdirSync(outDir, { recursive: true });
const ledgerPath = join(outDir, 'ledger.json');
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : { host: opt.host, renders: [] };
function record(row) {
  ledger.renders = ledger.renders.filter(x => !(x.url === row.url && x.voice === row.voice));
  ledger.renders.push(row);
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
}

const plan = [];
console.log(`render-sites · host ${opt.host} · ${reads.length} read(s) × ${opt.voices.length} voice(s)${opt.dry ? ' · DRY' : ''}\n`);
for (const url of reads) {
  process.stdout.write(`▸ ${url}\n`);
  let doc;
  try { doc = await ingest(url); } catch (e) { console.error('  ingest failed: ' + e.message); record({ url, voice: '*', error: e.message, at: new Date().toISOString() }); continue; }
  console.log(`  ${doc.blocks.length} blocks · ${doc.words} words · "${doc.title.slice(0, 60)}"`);
  const dir = join(outDir, slug(url)); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'blocks.json'), JSON.stringify({ url, title: doc.title, blocks: doc.blocks }, null, 2));
  for (const voice of opt.voices) plan.push({ url, voice, doc, dir });
}
if (opt.dry) { console.log(`\nplanned ${plan.length} render(s); nothing rendered.`); process.exit(0); }

let idx = 0, active = 0, failures = 0;
await new Promise(done => {
  const next = () => {
    if (idx >= plan.length && active === 0) return done();
    while (active < opt.concurrency && idx < plan.length) {
      const p = plan[idx++]; active++;
      (async () => {
        console.log(`\n▸ ${slug(p.url)} · ${p.voice}`);
        try {
          const m = await render(p.url, p.doc.title, p.doc.blocks, p.voice);
          const part = (m.parts && m.parts[0]) || {};
          const row = { url: p.url, title: p.doc.title, voice: m.voice || p.voice, voiceName: m.voiceName || p.voice, key: m.key,
            audio: abs(part.url || m.download || ''), seconds: m.seconds, bytes: m.bytes || part.bytes, blocks: m.blocks, words: m.words || p.doc.words,
            renderSeconds: m.renderSeconds ?? null, realtimeFactor: m.realtimeFactor ?? null, cached: !!m.cached, engine: m.engine || '', at: new Date().toISOString() };
          m.parts = (m.parts || []).map(x => Object.assign({}, x, { url: abs(x.url) }));
          writeFileSync(join(p.dir, p.voice + '.json'), JSON.stringify(m, null, 2));
          record(row);
          console.log(`  ✓ ${Math.round(row.seconds)} s · ${Math.round((row.bytes || 0) / 1024)} KB · ${row.realtimeFactor != null ? row.realtimeFactor + '× measured' : 'rate not reported'}${row.cached ? ' · from the store' : ''}`);
        } catch (e) { failures++; console.error('  ✗ ' + e.message); record({ url: p.url, voice: p.voice, error: e.message, at: new Date().toISOString() }); }
        active--; next();
      })();
    }
  };
  next();
});

// playlists + the standalone player
const byUrl = new Map();
for (const r of ledger.renders) { if (r.error) continue; if (!byUrl.has(r.url)) byUrl.set(r.url, []); byUrl.get(r.url).push(r); }
for (const [url, rows] of byUrl) {
  const dir = join(outDir, slug(url)); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'playlist.m3u'), '#EXTM3U\n' + rows.map(r => `#EXTINF:${Math.round(r.seconds || 0)},${r.title} — ${r.voiceName}\n${r.audio}`).join('\n') + '\n');
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const data = JSON.stringify([...byUrl].map(([url, rows]) => ({ url, title: rows[0].title, slug: slug(url), voices: rows })));
const player = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>render-sites player</title>
<style>
:root{--ink:#e6edf3;--dim:#8a93a2;--gold:#e3b341;--bg:#0a0e16}
body{margin:0;background:var(--bg);color:var(--ink);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
main{max-width:920px;margin:0 auto;padding:22px 16px}
h1{font-size:15px;letter-spacing:.18em;color:var(--gold);font-weight:600;margin:0 0 6px}
p.note{color:var(--dim);margin:0 0 16px;line-height:1.5}
select,button{font:inherit;background:#0f1522;color:var(--ink);border:1px solid #2a3140;border-radius:8px;padding:7px 10px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0}
audio{width:100%;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #1f2633}th{color:var(--dim);font-weight:500;letter-spacing:.12em;font-size:10px}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.on td{color:var(--gold)}
.foot{color:var(--dim);font-size:11px;margin-top:18px;line-height:1.5}
</style></head><body><main>
<h1>RENDER-SITES · STANDALONE PLAYER</h1>
<p class="note">Pick a read, pick a voice, listen. The table is the feedback: every figure is what the render host measured for that file — realtime factor, synthesis time, audio length, size — nothing here is estimated by this page.</p>
<div class="row"><label>read <select id="read"></select></label><label>voice <select id="voice"></select></label><a id="dl" download>download</a></div>
<audio id="au" controls preload="metadata"></audio>
<table><thead><tr><th>voice</th><th>engine</th><th class="num">audio s</th><th class="num">synth s</th><th class="num">rtf ×</th><th class="num">KB</th><th class="num">blocks</th><th class="num">words</th><th>store</th></tr></thead><tbody id="tb"></tbody></table>
<p class="foot">Generated by docsreader/scripts/render-sites.mjs against ${esc(opt.host)} on ${new Date().toISOString()}. Audio is served by the host; this file is static and can be copied anywhere.</p>
</main>
<script>
var DATA=${data.replace(/</g, '\\u003c')};
var read=document.getElementById('read'),voice=document.getElementById('voice'),au=document.getElementById('au'),tb=document.getElementById('tb'),dl=document.getElementById('dl');
DATA.forEach(function(d,i){var o=document.createElement('option');o.value=i;o.textContent=d.title;read.appendChild(o);});
function paint(){var d=DATA[+read.value]||DATA[0];if(!d)return;voice.innerHTML='';d.voices.forEach(function(v,i){var o=document.createElement('option');o.value=i;o.textContent=v.voiceName||v.voice;voice.appendChild(o);});pick();}
function pick(){var d=DATA[+read.value]||DATA[0],v=d.voices[+voice.value]||d.voices[0];if(!v)return;au.src=v.audio;dl.href=v.audio;tb.innerHTML=d.voices.map(function(x){return '<tr class="'+(x===v?'on':'')+'"><td>'+x.voiceName+'</td><td>'+(x.engine||'')+'</td><td class="num">'+Math.round(x.seconds||0)+'</td><td class="num">'+(x.renderSeconds!=null?Math.round(x.renderSeconds):'—')+'</td><td class="num">'+(x.realtimeFactor!=null?x.realtimeFactor:'—')+'</td><td class="num">'+Math.round((x.bytes||0)/1024)+'</td><td class="num">'+(x.blocks||'')+'</td><td class="num">'+(x.words||'')+'</td><td>'+(x.cached?'held':'rendered')+'</td></tr>';}).join('');}
read.addEventListener('change',paint);voice.addEventListener('change',pick);paint();
</script></body></html>`;
writeFileSync(join(outDir, 'player.html'), player);
console.log(`\n${ledger.renders.filter(r => !r.error).length} render(s) in the ledger, ${failures} failure(s) this run → ${outDir}/player.html`);
process.exit(failures ? 1 : 0);
