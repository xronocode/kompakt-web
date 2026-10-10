// Browser-side PDF compression: pdf.js renders each page to a canvas, the
// canvas is encoded as JPEG, and StreamingPdfWriter assembles the result.
// Only one page is held as pixels at a time. Browser-only (needs a DOM canvas).

import { StreamingPdfWriter } from './pdf-writer.js';

/** Presets used by kompakt.xronocode.com. `dpi` is true dots per inch of the original page. */
export const PRESETS = Object.freeze({
  low:    Object.freeze({ dpi: 72,  jpegQuality: 0.50 }),
  medium: Object.freeze({ dpi: 120, jpegQuality: 0.65 }),
  high:   Object.freeze({ dpi: 200, jpegQuality: 0.75 }),
});

/** Per-page pixel budgets. Mobile Safari reloads tabs whose canvases exhaust memory. */
export const MAX_CANVAS_PIXELS = Object.freeze({ touch: 4_000_000, desktop: 16_000_000 });

const isTouch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Compress a PDF by re-rendering every page as a JPEG.
 *
 * @param {ArrayBuffer|Uint8Array} data  input PDF. pdf.js may transfer (detach) an ArrayBuffer
 *                                        to its worker — pass a copy if you need it afterwards.
 * @param {object} opts
 * @param {object} opts.pdfjs            the pdf.js module (pdfjs-dist 4.x–6.x) with workerSrc configured
 * @param {number} [opts.dpi=120]        render resolution, true dots per inch
 * @param {number} [opts.jpegQuality=0.65] 0..1, passed to canvas.toBlob
 * @param {number} [opts.maxCanvasPixels] per-page pixel budget; default 4 Mpx on touch devices, 16 Mpx otherwise.
 *                                        Pages above it are rendered at a proportionally lower dpi.
 * @param {string} [opts.password]       for encrypted PDFs
 * @param {AbortSignal} [opts.signal]    abort between pages
 * @param {(page: number, total: number) => void} [opts.onProgress] called before each page renders
 * @returns {Promise<{blob: Blob, pages: number, inputBytes: number, outputBytes: number, ratio: number}>}
 *          `ratio` = 1 − output/input: > 0 means smaller; <= 0 means keep the original.
 */
export async function compressPdf(data, opts) {
  const {
    pdfjs,
    dpi = PRESETS.medium.dpi,
    jpegQuality = PRESETS.medium.jpegQuality,
    maxCanvasPixels = isTouch() ? MAX_CANVAS_PIXELS.touch : MAX_CANVAS_PIXELS.desktop,
    password,
    signal,
    onProgress,
  } = opts ?? {};
  if (!pdfjs?.getDocument) throw new TypeError('compressPdf: opts.pdfjs must be the pdf.js module');
  if (!(dpi > 0)) throw new RangeError('compressPdf: dpi must be > 0');
  if (!(jpegQuality > 0 && jpegQuality <= 1)) throw new RangeError('compressPdf: jpegQuality must be in (0, 1]');
  signal?.throwIfAborted();

  const inputBytes = data.byteLength;
  // pdf.js viewport scale 1 = 72 px per inch (one pixel per PDF point), so dpi / 72 is true dpi.
  const scale = dpi / 72;
  const task = pdfjs.getDocument({ data, password });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const writer = new StreamingPdfWriter();

  try {
    const doc = await task.promise;
    for (let i = 1; i <= doc.numPages; i++) {
      signal?.throwIfAborted();
      onProgress?.(i, doc.numPages);
      const page = await doc.getPage(i);
      const size = page.getViewport({ scale: 1 }); // page size in points
      const pixels = size.width * size.height * scale * scale;
      const s = pixels > maxCanvasPixels ? scale * Math.sqrt(maxCanvasPixels / pixels) : scale;
      const viewport = page.getViewport({ scale: s });

      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      // JPEG has no alpha: paint white so transparent page areas don't turn black.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;

      const jpeg = new Uint8Array(await (await toJpeg(canvas, jpegQuality)).arrayBuffer());
      writer.addPage(size.width, size.height, canvas.width, canvas.height, jpeg);
      page.cleanup();
    }
  } finally {
    canvas.width = canvas.height = 0; // release the backing store now, not at GC time
    await task.destroy();            // works on pdf.js 4–6 (PDFDocumentProxy.destroy was removed in 6)
  }

  const blob = new Blob(writer.finish(), { type: 'application/pdf' });
  return { blob, pages: writer.pageCount, inputBytes, outputBytes: blob.size, ratio: 1 - blob.size / inputBytes };
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null (canvas too large?)'))), 'image/jpeg', quality));
}
