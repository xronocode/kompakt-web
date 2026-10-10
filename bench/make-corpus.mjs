// Build the synthetic test set used in the published measurements:
//   A-text-report.pdf  20 pages of typed text, tables, vector charts
//   B-scanned-doc.pdf  6 pages rasterized at 300 dpi grayscale with noise + skew
//   C-photo-deck.pdf   8 widescreen slides with full-bleed photos (Unsplash via picsum.photos)
// Requires Google Chrome and Ghostscript. Run: node bench/make-corpus.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const B = new URL('.', import.meta.url).pathname;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(B + 'corpus', { recursive: true });
fs.mkdirSync(B + 'img', { recursive: true });
const PHOTO_IDS = [1015, 1018, 1025, 1036, 1043, 1050, 1069, 1074];
for (const [i, id] of PHOTO_IDS.entries()) {
  const f = `${B}img/p${i + 1}.jpg`;
  if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(await (await fetch(`https://picsum.photos/id/${id}/2400/1600.jpg`)).arrayBuffer()));
}
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage();
// A: 10-page text report with a table and a vector chart
const para = 'Quarterly operations review. Throughput rose while incident volume fell; the main driver was automated routing of low-risk tickets and a shorter on-call escalation path. ';
let html = '<style>body{font:11pt Georgia,serif;margin:0}h1{font:bold 20pt Arial}h2{font:bold 14pt Arial;margin-top:18pt}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;font:9pt Arial}</style>';
for (let s = 1; s <= 10; s++) {
  html += `<h1>Section ${s}. Operations report</h1>` + `<p>${para.repeat(6)}</p>`.repeat(3);
  html += '<table><tr><th>Metric</th><th>Q1</th><th>Q2</th><th>Q3</th></tr>' + Array.from({length:8},(_,i)=>`<tr><td>Metric ${i+1}</td><td>${(i*13)%97}</td><td>${(i*29)%97}</td><td>${(i*41)%97}</td></tr>`).join('') + '</table>';
  html += `<svg width="600" height="160">${Array.from({length:12},(_,i)=>`<rect x="${i*48+10}" y="${150-((i*37+s*11)%130)}" width="30" height="${(i*37+s*11)%130}" fill="#4a6fa5"/>`).join('')}</svg>`;
  html += `<p>${para.repeat(5)}</p><div style="page-break-after:always"></div>`;
}
await p.setContent(html); await p.pdf({ path: `${B}corpus/A-text-report.pdf`, format: 'Letter', margin: { top: '0.8in', bottom: '0.8in', left: '0.9in', right: '0.9in' } });
// B: "scanned" document — first 6 pages of A rasterized at 300 dpi grayscale, slight skew + paper noise
execSync(`gs -q -sDEVICE=pnggray -r300 -dFirstPage=1 -dLastPage=6 -o ${B}img/scan-%d.png ${B}corpus/A-text-report.pdf`);
const scans = [];
for (let i = 1; i <= 6; i++) {
  await p.setViewportSize({ width: 2550, height: 3300 });
  await p.setContent(`<body style="margin:0"><canvas id=c width=2550 height=3300></canvas><script>
    const c=document.getElementById('c').getContext('2d');const im=new Image();im.src='data:image/png;base64,${fs.readFileSync(`${B}img/scan-${i}.png`).toString('base64')}';
    im.onload=()=>{c.fillStyle='#f4f1ea';c.fillRect(0,0,2550,3300);c.save();c.translate(1275,1650);c.rotate(${(i%3-1)*0.004});c.drawImage(im,-1275,-1650);c.restore();
      const d=c.getImageData(0,0,2550,3300);for(let k=0;k<d.data.length;k+=4){const n=(Math.random()-.5)*28;d.data[k]+=n;d.data[k+1]+=n;d.data[k+2]+=n;}c.putImageData(d,0,0);window.done=1};
  </script></body>`);
  await p.waitForFunction(() => window.done);
  scans.push(await p.evaluate(() => document.getElementById('c').toDataURL('image/jpeg', 0.92)));
}
await p.setViewportSize({ width: 1280, height: 900 });
await p.setContent('<style>@page{size:Letter;margin:0}body{margin:0}img{width:8.5in;height:11in;display:block}</style>' + scans.map(s => `<img src="${s}">`).join(''));
await p.pdf({ path: `${B}corpus/B-scanned-doc.pdf`, width: '8.5in', height: '11in', printBackground: true });
// C: 8-slide photo deck, 16:9
const imgs = fs.readdirSync(`${B}img`).filter(f => /^p\d+\.jpg$/.test(f)).sort();
await p.setContent('<style>@page{size:13.333in 7.5in;margin:0}body{margin:0;font-family:Arial}.s{width:13.333in;height:7.5in;position:relative;overflow:hidden;page-break-after:always}.s img{width:100%;height:100%;object-fit:cover}.s h2{position:absolute;left:.6in;bottom:.5in;color:#fff;font-size:34pt;text-shadow:0 2px 8px #000;margin:0}</style>' + imgs.map((f,i)=>`<div class=s><img src="data:image/jpeg;base64,${fs.readFileSync(`${B}img/${f}`).toString('base64')}"><h2>Slide ${i+1}: field visit</h2></div>`).join(''));
await p.pdf({ path: `${B}corpus/C-photo-deck.pdf`, width: '13.333in', height: '7.5in', printBackground: true });
await b.close();
