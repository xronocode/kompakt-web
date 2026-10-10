// Measure kompakt-web against Ghostscript on every PDF in bench/corpus/.
//
// Browser side: the demo page in headless Chrome, at each preset.
// Ghostscript side: pdfwrite with /screen, /ebook, /printer.
// Also records whether text is still extractable (pdftotext word count).
//
// Requires Google Chrome, Ghostscript and poppler (pdftotext).
// Run: node bench/make-corpus.mjs && node bench/run.mjs  (add your own PDFs to bench/corpus/ too)

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname;
const B = path.join(ROOT, 'bench');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PRESETS = [['low', 'screen'], ['medium', 'ebook'], ['high', 'printer']];
fs.mkdirSync(path.join(B, 'out'), { recursive: true });

const words = f => Number(execSync(`pdftotext -q "${f}" - | wc -w`).toString().trim());
const kb = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
const pct = (a, b) => `${b < a ? '−' : '+'}${Math.abs(Math.round((1 - b / a) * 100))}%`;

// Static server for the demo page (module imports need http://).
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
}).listen(0);
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const files = fs.readdirSync(path.join(B, 'corpus')).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
const rows = [];
const browser = await chromium.launch({ executablePath: CHROME });

for (const f of files) {
  const src = path.join(B, 'corpus', f), size = fs.statSync(src).size;
  for (const [q, gsPreset] of PRESETS) {
    // Browser
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/demo/index.html`);
    await page.check(`input[name=q][value=${q}]`);
    const t0 = Date.now();
    await page.setInputFiles('#file', src);
    await page.waitForFunction(() => /→|Error/.test(document.getElementById('out').textContent), null, { timeout: 1_800_000 });
    const sec = (Date.now() - t0) / 1000;
    let web = null;
    if (await page.isVisible('#dl')) {
      const out = path.join(B, 'out', `${f}.web-${q}.pdf`);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
      await dl.saveAs(out);
      web = { bytes: fs.statSync(out).size, sec, words: words(out) };
    }
    await ctx.close();

    // Ghostscript
    const gsOut = path.join(B, 'out', `${f}.gs-${q}.pdf`), g0 = Date.now();
    execSync(`gs -q -dNOPAUSE -dBATCH -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/${gsPreset} -sOutputFile="${gsOut}" "${src}"`);
    const gs = { bytes: fs.statSync(gsOut).size, sec: (Date.now() - g0) / 1000, words: words(gsOut) };

    rows.push({ file: f, size, words: words(src), q, web, gs });
    console.log(f, q, web ? kb(web.bytes) : 'bigger', '|', kb(gs.bytes));
  }
}
await browser.close();
server.close();

let md = '| File | Original | Preset | Browser | Ghostscript | Text kept (GS) |\n|---|---|---|---|---|---|\n';
for (const r of rows) {
  md += `| ${r.file} | ${kb(r.size)} | ${r.q} | ${r.web ? `${kb(r.web.bytes)} (${pct(r.size, r.web.bytes)}), ${r.web.sec.toFixed(1)}s` : 'bigger — keep original'} | ${kb(r.gs.bytes)} (${pct(r.size, r.gs.bytes)}), ${r.gs.sec.toFixed(1)}s | ${r.gs.words}/${r.words} words |\n`;
}
fs.writeFileSync(path.join(B, 'results.md'), md);
fs.writeFileSync(path.join(B, 'results.json'), JSON.stringify(rows, null, 1));
console.log('\n' + md);
