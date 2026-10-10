// Browser-side PDF compression: pdf.js renders each page to a canvas, the
// canvas is encoded as JPEG, and StreamingPdfWriter assembles the result.
// Only one page is held as pixels at a time.

import { StreamingPdfWriter } from './pdf-writer.js';

export const PRESETS = {
  low:    { dpi: 72,  jpegQuality: 0.50 },
  medium: { dpi: 120, jpegQuality: 0.65 },
  high:   { dpi: 200, jpegQuality: 0.75 },
};

const isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Compress a PDF by re-rendering every page as a JPEG.
 *
 * @param {ArrayBuffer|Uint8Array} data  input PDF
 * @param {object} opts
 * @param {object} opts.pdfjs            the pdf.js module (pdfjs-dist), worker already configured
 * @param {number} [opts.dpi=120]        render resolution in true dots per inch
 * @param {number} [opts.jpegQuality=0.65]
 * @param {number} [opts.maxCanvasPixels] per-page pixel budget; defaults to 4 Mpx on touch
 *                                        devices (mobile Safari memory limits), 16 Mpx otherwise
 * @param {(page:number, total:number) => void} [opts.onProgress]
 * @returns {Promise<{blob: Blob, pages: number, inputBytes: number, outputBytes: number, ratio: number}>}
 *          ratio > 0 means smaller; ratio <= 0 means the result is not worth keeping
 */
export async function compressPdf(data, opts) {
  const { pdfjs, dpi = PRESETS.medium.dpi, jpegQuality = PRESETS.medium.jpegQuality, onProgress } = opts;
  const maxCanvasPixels = opts.maxCanvasPixels ?? (isTouch ? 4_000_000 : 16_000_000);
  const inputBytes = data.byteLength;

  // pdf.js viewport scale 1 = 72 px per inch (one pixel per PDF point).
  const scale = dpi / 72;
  const doc = await pdfjs.getDocument({ data }).promise;
  const writer = new StreamingPdfWriter();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      onProgress?.(i, doc.numPages);
      const page = await doc.getPage(i);
      const size = page.getViewport({ scale: 1 });
      const px = size.width * size.height * scale * scale;
      const s = px > maxCanvasPixels ? scale * Math.sqrt(maxCanvasPixels / px) : scale;
      const viewport = page.getViewport({ scale: s });

      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      // JPEG has no alpha: paint white first so transparent areas don't turn black.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;

      const jpeg = new Uint8Array(await (await toJpeg(canvas, jpegQuality)).arrayBuffer());
      writer.addPage(size.width, size.height, canvas.width, canvas.height, jpeg);
      page.cleanup();
    }
  } finally {
    canvas.width = canvas.height = 0;
    await doc.destroy();
  }

  const blob = new Blob(writer.finish(), { type: 'application/pdf' });
  return { blob, pages: writer.pages.length, inputBytes, outputBytes: blob.size, ratio: 1 - blob.size / inputBytes };
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), 'image/jpeg', quality));
}
