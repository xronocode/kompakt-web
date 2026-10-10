import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
// Run compressPdf() in headless Chrome against several pdf.js majors (loaded from jsDelivr).
// Needs bench/corpus/B-scanned-doc.pdf (npm run corpus). Run: npm run test:browser
import { chromium } from 'playwright-core';
const ROOT = new URL('..', import.meta.url).pathname;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let failed = 0;
const srv = http.createServer((q, r) => { const f = path.join(ROOT, new URL(q.url,'http://x').pathname); if (!fs.existsSync(f)||fs.statSync(f).isDirectory()) return r.writeHead(404).end(); r.writeHead(200,{'content-type': f.endsWith('.html')?'text/html':'text/javascript'}).end(fs.readFileSync(f)); }).listen(0);
const O = 'http://127.0.0.1:' + srv.address().port;
const b = await chromium.launch({ executablePath: CHROME });
for (const v of ['4.4.168', '5.4.296', '6.4.299']) {
  const p = await b.newPage();
  await p.goto(O + '/demo/index.html');
  const res = await p.evaluate(async ([v, pdfB64]) => {
    const pdfjs = await import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/build/pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/build/pdf.worker.min.mjs`;
    const { compressPdf } = await import('/src/compress.js');
    const data = Uint8Array.from(atob(pdfB64), c => c.charCodeAt(0));
    try { const r = await compressPdf(data, { pdfjs, dpi: 120, jpegQuality: 0.65 }); return { ok: true, pages: r.pages, out: r.outputBytes, ratio: r.ratio.toFixed(2) }; }
    catch (e) { return { ok: false, err: String(e) }; }
  }, [v, fs.readFileSync(ROOT + 'bench/corpus/B-scanned-doc.pdf').toString('base64')]);
  if (!res.ok) failed++;
  console.log(res.ok ? 'ok  ' : 'FAIL', 'pdfjs-dist@' + v, JSON.stringify(res));
  await p.close();
}
await b.close(); srv.close();
process.exit(failed ? 1 : 0);
