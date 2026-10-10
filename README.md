# kompakt-web

**Compress PDFs entirely in the browser — no upload, no server, works offline.**

`kompakt-web` is the engine behind the free web compressor at **[kompakt.xronocode.com/compress](https://kompakt.xronocode.com/compress)**, extracted into a small, dependency-free MIT library with tests and a reproducible benchmark against Ghostscript.

```
PDF file ──► pdf.js renders page N ──► <canvas> ──► canvas.toBlob('image/jpeg', q) ──► streaming PDF writer ──► smaller PDF
```

- **Under 200 lines, comments included**, no runtime dependencies except [pdf.js](https://mozilla.github.io/pdf.js/) (which you provide).
- **Private by construction** — the file is read with the File API and never leaves the tab. No network requests besides loading pdf.js itself.
- **One page in memory at a time** — a hand-written streaming writer appends JPEG chunks to a `Blob` instead of building a document tree.
- **Keeps the original page size** (Letter stays Letter, A4 stays A4) and writes **structurally valid PDFs** (checked with `pdfinfo`, Ghostscript and pdf.js).
- **Mobile-safe** — a per-page pixel budget (4 Mpx on touch devices) keeps mobile Safari from reloading the tab.
- **Honest about where it loses** — on text/vector PDFs the output is bigger; the API tells you, and the benchmark shows it.
- Tested with **pdf.js 4.4, 5.4 and 6.4**.

> **This is not a new algorithm.** Rasterize-and-re-encode is the standard way to compress PDFs client-side, and other open-source tools use it too (see [Prior art](#prior-art)). What this repo offers is a small, auditable implementation, presets with true dpi, and numbers you can reproduce — including the cases where Ghostscript is the better tool.

---

## Contents

- [Quick start](#quick-start)
- [API](#api)
- [Choosing a preset](#choosing-a-preset)
- [How it works](#how-it-works)
- [Measured results](#measured-results)
- [Browser vs Ghostscript: when to use which](#browser-vs-ghostscript-when-to-use-which)
- [Limitations](#limitations)
- [Compatibility](#compatibility)
- [Privacy](#privacy)
- [Development](#development)
- [Bugs this benchmark caught in production](#bugs-this-benchmark-caught-in-production)
- [FAQ](#faq)
- [Prior art](#prior-art)
- [Related](#related)

---

## Quick start

### In a page, no build step

```html
<input type="file" id="file" accept=".pdf,application/pdf">
<script type="module">
  import * as pdfjs from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
  import { compressPdf, PRESETS } from 'https://cdn.jsdelivr.net/gh/xronocode/kompakt-web@main/src/compress.js';
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';

  document.getElementById('file').onchange = async (e) => {
    const file = e.target.files[0];
    const result = await compressPdf(await file.arrayBuffer(), { pdfjs, ...PRESETS.medium });
    if (result.ratio <= 0) return alert('Already compact — keep the original.');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(result.blob),
      download: file.name.replace(/\.pdf$/i, '') + '_compressed.pdf',
    });
    a.click();
  };
</script>
```

### With a bundler

The package is not on npm yet; install it from GitHub:

```sh
npm install pdfjs-dist github:xronocode/kompakt-web
```

```js
import * as pdfjs from 'pdfjs-dist';
import { compressPdf, PRESETS } from 'kompakt-web';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

const result = await compressPdf(await file.arrayBuffer(), {
  pdfjs,
  ...PRESETS.medium,
  onProgress: (page, total) => console.log(`page ${page}/${total}`),
});
```

### Try the demo

```sh
git clone https://github.com/xronocode/kompakt-web && cd kompakt-web
npm run demo            # python3 -m http.server 8080
open http://localhost:8080/demo/
```

---

## API

### `compressPdf(data, options) → Promise<Result>`

Re-renders every page as a JPEG and returns a new PDF. Browser-only (needs a DOM `<canvas>`).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `pdfjs` | module | **required** | The pdf.js module (`pdfjs-dist` 4.x–6.x) with `GlobalWorkerOptions.workerSrc` set. |
| `dpi` | number | `120` | Render resolution in **true** dots per inch of the original page. |
| `jpegQuality` | number | `0.65` | JPEG quality, `(0, 1]`, passed to `canvas.toBlob`. |
| `maxCanvasPixels` | number | 4 000 000 on touch devices, 16 000 000 otherwise | Per-page pixel budget. Pages above it render at a proportionally lower dpi. |
| `password` | string | — | Password for encrypted PDFs. A wrong/missing password rejects with pdf.js’ `PasswordException`. |
| `signal` | `AbortSignal` | — | Checked before each page; aborting rejects with an `AbortError`. |
| `onProgress` | `(page, total) => void` | — | Called before each page is rendered. |

`data` is an `ArrayBuffer` or `Uint8Array`. pdf.js may transfer (detach) an `ArrayBuffer` to its worker — pass a copy (`data.slice(0)`) if you need the original afterwards.

**Result**

| Field | Meaning |
|---|---|
| `blob` | The compressed PDF (`application/pdf`). |
| `pages` | Number of pages written. |
| `inputBytes`, `outputBytes` | Sizes before and after. |
| `ratio` | `1 − outputBytes / inputBytes`. **`> 0` = smaller. `<= 0` = keep the original** (typical for text/vector PDFs). |

**Errors**: invalid options throw `TypeError`/`RangeError`; unreadable PDFs reject with pdf.js errors (`InvalidPDFException`, `PasswordException`, …); `canvas.toBlob` returning `null` (canvas too large for the device) rejects with an `Error`.

### `PRESETS`

```js
PRESETS.low     // { dpi: 72,  jpegQuality: 0.50 }
PRESETS.medium  // { dpi: 120, jpegQuality: 0.65 }
PRESETS.high    // { dpi: 200, jpegQuality: 0.75 }
```

### `MAX_CANVAS_PIXELS`

`{ touch: 4_000_000, desktop: 16_000_000 }` — the defaults for `maxCanvasPixels`.

### `StreamingPdfWriter` (`kompakt-web/writer`)

The writer is usable on its own — e.g. to turn camera captures or rendered slides into a PDF, in the browser or in Node.

```js
import { StreamingPdfWriter } from 'kompakt-web/writer';

const w = new StreamingPdfWriter();
w.addPage(612, 792, jpegWidthPx, jpegHeightPx, jpegBytes);  // page size in points, image size in pixels
const pdf = new Blob(w.finish(), { type: 'application/pdf' });
```

| Member | Meaning |
|---|---|
| `addPage(widthPt, heightPt, widthPx, heightPx, jpeg)` | Append a page that shows one RGB JPEG scaled to the full page. Points are 1/72 inch. |
| `finish() → Uint8Array[]` | Write page tree, xref and trailer; returns chunks for `new Blob(...)`. Throws if there are no pages or if called twice. |
| `pageCount` | Pages added so far. |

The JPEG must be 3-component (RGB) — which is what `canvas.toBlob('image/jpeg')` produces. Grayscale or CMYK JPEGs would need a different `/ColorSpace`.

---

## Choosing a preset

| Preset | dpi | JPEG q | Letter page in pixels | Use it for |
|---|---|---|---|---|
| `low` | 72 | 0.50 | 612 × 792 | Hitting a hard size limit (portal uploads, 10 MB mail servers). Check the smallest text afterwards. |
| `medium` | 120 | 0.65 | 1020 × 1320 | Anything read on a screen. The default. |
| `high` | 200 | 0.75 | 1700 × 2200 | Printing, or documents people will zoom into. |

Side-by-side crops of each preset: **[PDF compression vs quality](https://kompakt.xronocode.com/guides/pdf-compression-quality)**.

---

## How it works

### Pipeline

1. **Parse and render** — pdf.js opens the file and renders one page at a time onto a canvas at `dpi / 72` scale (a pdf.js viewport at scale 1 is 72 px per inch: one pixel per PDF point).
2. **Pixel budget** — if `width × height` would exceed `maxCanvasPixels`, the scale is reduced by `√(budget / pixels)` for that page only.
3. **Paint white, then render** — JPEG has no alpha channel, so transparent page areas would otherwise come out black.
4. **Encode** — `canvas.toBlob('image/jpeg', quality)` uses the browser’s native encoder.
5. **Write** — the JPEG bytes go straight into the output as a `/DCTDecode` image; no decoding or re-encoding happens in JS.
6. **Release** — `page.cleanup()`, and the canvas backing store is freed (`width = height = 0`) when done, rather than waiting for GC.

### The writer

The output only ever contains one kind of page — a full-bleed image — so the writer needs four object types:

```
1 0 obj  Catalog            << /Type /Catalog /Pages 2 0 R >>
2 0 obj  Page tree          << /Type /Pages /Kids [3 0 R 6 0 R …] /Count N >>   ← written last
3 0 obj  Page               << /Type /Page /MediaBox [0 0 612.00 792.00] /Contents 4 0 R
                               /Resources << /XObject << /Im 5 0 R >> >> >>
4 0 obj  Content stream     q 612.00 0 0 792.00 0 0 cm /Im Do Q       (scale unit image to page, draw)
5 0 obj  Image XObject      << /Subtype /Image /Width 1020 /Height 1320 /ColorSpace /DeviceRGB
                               /BitsPerComponent 8 /Filter /DCTDecode /Length … >> stream <JPEG> endstream
…  three objects per page …
xref / trailer / startxref
```

It tracks the byte offset of every object as it writes, emits the cross-reference table at the end, and returns the chunks; `new Blob(chunks)` assembles them without one large copy.

### Why not pdf-lib?

The first production version used [pdf-lib](https://pdf-lib.js.org/). It works, but it builds the whole document as an object graph and serializes at the end — fine for 20 pages, wasteful for hundreds of 200 dpi pages on a phone. Since every output page is the same trivial structure, a ~90-line writer is simpler, smaller and streams.

### Memory model

Peak memory ≈ input file + pdf.js’ parsed structures + **one** rendered page (`4 bytes × pixels`, e.g. ~5.4 MB for a Letter page at 120 dpi) + the output so far. It does not grow with page count beyond the output itself.

---

## Measured results

Reproduce with `npm run corpus && npm run bench` (needs Google Chrome, Ghostscript and poppler’s `pdftotext`). Numbers below: Chrome on a Mac, Ghostscript 10.07 using the presets of the [kompakt desktop app](https://github.com/xronocode/kompakt) (`/screen`, `/ebook`, `/printer`). Sizes in binary units (1 MB = 1,048,576 bytes).

The synthetic test set (generated by `bench/make-corpus.mjs`):

- **Text report** — 20 pages of typed text, tables and vector charts.
- **Scanned document** — 6 pages rasterized at 300 dpi grayscale with paper noise and slight skew.
- **Photo deck** — 8 widescreen slides with full-bleed photographs (Unsplash via picsum.photos).

| Test file | Original | Preset | kompakt-web | Ghostscript |
|---|---|---|---|---|
| Scanned document, 6 pp | 2.9 MB | low | **86 KB (−97%)** | 116 KB (−96%) |
| | | medium | **256 KB (−92%)** | 328 KB (−89%) |
| | | high | **737 KB (−76%)** | 2.9 MB (0%) |
| Photo deck, 8 slides | 4.0 MB | low | **412 KB (−90%)** | 684 KB (−83%) |
| | | medium | **1.4 MB (−66%)** | 3.8 MB (−5%) |
| | | high | 3.9 MB (−3%) | 4.0 MB (−1%) |
| Text report, 20 pp | 96 KB | low / medium / high | bigger → keep original | **86 KB (−11%)**, text kept |

On a public **245-page, mostly-text technical report (22.6 MB)** — not redistributed here — kompakt-web reached **−41% at low** and produced a *larger* file at medium and high, while Ghostscript reached **−83% (low)** and **−66% (medium)** and kept all 70,329 words extractable. Browser time on that file was ~10 s; Ghostscript ~96 s.

Scan noise is random, so a fresh corpus can differ by about ±1 percentage point. Drop your own PDFs into `bench/corpus/` to measure them too.

---

## Browser vs Ghostscript: when to use which

| Your PDF is mostly… | kompakt-web (browser) | Ghostscript (desktop) |
|---|---|---|
| Scans | ✅ large reduction | ✅ large reduction |
| Photos / slides | ✅ large reduction | ✅ at `/screen`, little at `/ebook` |
| Typed text, tables, charts | ❌ gets bigger | ✅ modest reduction, text kept |
| Large because of embedded fonts | ⚠️ fonts gone, but so is text | ✅ subsets fonts, keeps text |
| Confidential, must not leave the device | ✅ no upload | ✅ local, but needs an install |

Rule of thumb: **if you can’t select the text, compress it in the browser; if you can and need to keep it, use Ghostscript.**

---

## Limitations

- **Text becomes pixels.** The output can’t be selected, searched or copied, and screen readers can’t read it.
- **Text/vector PDFs usually get bigger.** Always check `result.ratio`.
- **JPEG only.** Browsers can’t encode JBIG2 or CCITT G4 (ideal for black-and-white scans), and PDF can’t embed WebP.
- **Everything is flattened** — form fields, links, annotations, bookmarks/outline, and the text layer are not carried over; metadata (title, author) is not copied.
- **Pages larger than the pixel budget** are rendered at a lower dpi than requested (e.g. Letter at `high` on a phone ≈ 200 dpi → 1700 × 2200 = 3.7 Mpx fits; A3 at `high` on a phone renders at ~144 dpi).
- **Single-threaded rendering** — pages are processed sequentially on the main thread’s canvas (pdf.js parsing runs in its worker).

---

## Compatibility

| | Status |
|---|---|
| pdf.js | Tested with **4.4.168, 5.4.296, 6.4.299** (`npm run test:browser`). 6.x removed `PDFDocumentProxy.destroy()`; cleanup uses the loading task, which works on all three. |
| Chrome / Chromium | Tested (headless and desktop). |
| Safari (macOS / iOS), Firefox | Expected to work — only standard canvas, Blob and ES module APIs are used — but not covered by automated tests yet. The production site runs the same pipeline on iOS Safari. |
| Node.js | The **writer** works in Node (see tests). `compressPdf` needs a DOM canvas. |

---

## Privacy

- No network access during compression. The only requests are for the pdf.js module and worker (from your own server or a CDN of your choice).
- Verify it yourself: open DevTools → Network, clear the log, compress a file — no new requests appear. Or disconnect from the network after the page has loaded.

---

## Development

```sh
npm install
npm test               # writer unit tests (node:test, pdf.js legacy build)
npm run corpus         # build bench/corpus/*.pdf (downloads 8 photos from picsum.photos)
npm run test:browser   # compressPdf in headless Chrome against pdf.js 4, 5, 6
npm run bench          # browser vs Ghostscript → bench/results.md
npm run demo           # serve the repo; open /demo/
```

Set `CHROME=/path/to/chrome` if Chrome is not in the default macOS location.

```
src/pdf-writer.js        StreamingPdfWriter — the PDF writer (no dependencies)
src/compress.js          compressPdf(), PRESETS, MAX_CANVAS_PIXELS
demo/index.html          minimal page using the library from source
test/writer.test.mjs     xref offsets, stream termination, header bytes, guards, page sizes via pdf.js
test/pdfjs-compat.mjs    end-to-end run against several pdf.js versions
bench/make-corpus.mjs    synthetic test set generator
bench/run.mjs            benchmark vs Ghostscript, writes results.md / results.json
```

---

## Bugs this benchmark caught in production

Building the benchmark for this repo turned up three bugs in the live web compressor; all are fixed here and in production (10 October 2026):

1. **dpi labels were overstated.** The scale was `dpi / 96` (CSS pixels) instead of `dpi / 72` (PDF points): “150 dpi” rendered at 112, “300” at 225, “72” at 54. Presets are now true 72 / 120 / 200 dpi.
2. **The page size changed.** The image size in pixels was written as the page size in points: a Letter page came out as 13.3 × 17.2 in at medium and 6.4 × 8.3 in at low.
3. **Malformed output.** A missing newline produced `endstreamendobj`; viewers repaired it silently, strict tools reported syntax errors.

The full story: **[How kompakt compresses PDFs inside your browser](https://kompakt.xronocode.com/guides/how-browser-pdf-compression-works)**.

---

## FAQ

**Why does my PDF get bigger?**
It is mostly text or vector graphics. A typed page is a few kilobytes of drawing instructions; the same page as a picture is tens of kilobytes. Keep the original, or use Ghostscript.

**Can it keep the text selectable?**
No — that would require an OCR or text-layer pass. Use Ghostscript to compress without rasterizing.

**Why not WebP or AVIF?**
PDF can embed JPEG (`DCTDecode`) and JPEG 2000 (`JPXDecode`), not WebP or AVIF, and browsers can’t encode JPEG 2000.

**Can I run it in a Web Worker?**
Not as-is — it uses a DOM canvas. An `OffscreenCanvas` port is possible (pdf.js supports it); contributions welcome.

**Is there a size limit?**
Only the browser’s memory. The production site accepts files up to ~1 GB.

---

## Prior art

Other open-source, client-side PDF compressors using the same rasterize-and-re-encode idea:

- [PDFoss](https://github.com/Er4nant/pdfoss) — static site, pdf.js + pdf-lib.
- [pdfcevir](https://dev.to/trixterx102byte/i-built-a-pdf-toolkit-that-runs-100-in-the-browser-no-server-no-uploads-4ai2) — browser PDF toolkit.
- [ShrinkRay](https://www.producthunt.com/p/shrinkray-3/shrinkray-3) — multi-format compressor, pdf.js + pdf-lib for PDFs.

There are also browser builds of Ghostscript compiled to WebAssembly, which keep text but bring an AGPL license and a much larger download.

---

## Related

- **[kompakt.xronocode.com/compress](https://kompakt.xronocode.com/compress)** — the hosted web compressor (PWA, works offline).
- **[kompakt](https://github.com/xronocode/kompakt)** — desktop CLI (Ghostscript-based) for macOS, Windows and Linux.
- **Guides:** [Why is my PDF so large?](https://kompakt.xronocode.com/guides/why-is-my-pdf-so-large) · [PDF compression vs quality](https://kompakt.xronocode.com/guides/pdf-compression-quality) · [Make a PDF small enough to email](https://kompakt.xronocode.com/guides/compress-pdf-for-email)

## License

MIT © 2026 Mikhail Yevdokimov
