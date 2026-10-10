// Structural test for StreamingPdfWriter: build a 2-page PDF from a tiny JPEG,
// then check that pdf.js parses it, pages keep their point size, and the xref
// offsets point at the right objects.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { StreamingPdfWriter } from '../src/pdf-writer.js';

// 8×8 white JPEG.
const JPEG = new Uint8Array(readFileSync(new URL('./fixtures/white-8x8.jpg', import.meta.url)));

function build() {
  const w = new StreamingPdfWriter();
  w.addPage(612, 792, 8, 8, JPEG);   // Letter
  w.addPage(960, 540, 8, 8, JPEG);   // 16:9 slide
  return Buffer.concat(w.finish().map(c => Buffer.from(c)));
}

test('xref offsets point at "N 0 obj"', () => {
  const pdf = build();
  const text = pdf.toString('latin1');
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const rows = text.slice(startxref).split('\n').slice(3).filter(l => /^\d{10} 00000 n $/.test(l));
  rows.forEach((row, i) => {
    const off = Number(row.slice(0, 10));
    assert.equal(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`);
  });
});

test('every stream is terminated by "endstream" on its own before "endobj"', () => {
  const text = build().toString('latin1');
  assert.ok(!text.includes('endstreamendobj'));
  assert.equal((text.match(/\nendstream\nendobj\n/g) || []).length, 4);
});

test('pdf.js parses the file and keeps page sizes in points', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(build()) }).promise;
  assert.equal(doc.numPages, 2);
  const v1 = (await doc.getPage(1)).getViewport({ scale: 1 });
  const v2 = (await doc.getPage(2)).getViewport({ scale: 1 });
  assert.deepEqual([v1.width, v1.height], [612, 792]);
  assert.deepEqual([v2.width, v2.height], [960, 540]);
  await doc.destroy();
});
