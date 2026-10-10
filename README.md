# kompakt-web

Compress PDFs **entirely in the browser** — no upload, no server, works offline. This is the engine behind [kompakt.xronocode.com/compress](https://kompakt.xronocode.com/compress), extracted as a small MIT library with a reproducible benchmark.

```
PDF ──► pdf.js renders page N ──► <canvas> ──► canvas.toBlob('image/jpeg') ──► streaming PDF writer ──► PDF
```

- **~150 lines**, no runtime dependencies besides [pdf.js](https://mozilla.github.io/pdf.js/).
- **One page in memory at a time**: the writer streams JPEG chunks into a `Blob` instead of building a document tree.
- **Keeps the original page size** (Letter stays Letter) and writes PDFs that pass `pdfinfo` and Ghostscript cleanly.
- **Mobile-safe**: caps the per-page canvas at 4 Mpx on touch devices, where mobile Safari reloads tabs that run out of memory.

## This is not a new algorithm

Rasterize-and-re-encode is the standard way to compress PDFs client-side; [several](https://github.com/Er4nant/pdfoss) open-source tools do the same. What this repo adds is a small, dependency-free writer, honest presets, and **numbers you can reproduce** — including the cases where this approach loses.

## Usage

```js
import * as pdfjs from 'pdfjs-dist';
import { compressPdf, PRESETS } from 'kompakt-web';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const result = await compressPdf(await file.arrayBuffer(), {
  pdfjs,
  ...PRESETS.medium,                       // { dpi: 120, jpegQuality: 0.65 }
  onProgress: (page, total) => console.log(`${page}/${total}`),
});

if (result.ratio > 0) download(result.blob); // smaller
else keepOriginal();                         // text/vector PDFs usually get bigger
```

| Preset | Resolution | JPEG quality | Letter page |
|---|---|---|---|
| `low` | 72 dpi | 0.50 | 612 × 792 px |
| `medium` | 120 dpi | 0.65 | 1020 × 1320 px |
| `high` | 200 dpi | 0.75 | 1700 × 2200 px |

Try it locally: `npm run demo`, then open <http://localhost:8080/demo/>.

## Measured results

`npm run corpus && npm run bench` — Chrome on a Mac, Ghostscript 10.07 with the presets the kompakt desktop app uses (`/screen`, `/ebook`, `/printer`). Sizes in binary units.

| Test file | Original | Preset | Browser (this library) | Ghostscript | Text kept |
|---|---|---|---|---|---|
| Scanned document, 6 pp, 300 dpi | 2.9 MB | low | **86 KB (−97%)** | 116 KB (−96%) | — |
| | | medium | **256 KB (−92%)** | 328 KB (−89%) | — |
| | | high | **737 KB (−76%)** | 2.9 MB (0%) | — |
| Photo deck, 8 slides | 4.0 MB | low | **412 KB (−90%)** | 684 KB (−83%) | GS only |
| | | medium | **1.4 MB (−66%)** | 3.8 MB (−5%) | GS only |
| | | high | 3.9 MB (−3%) | 4.0 MB (−1%) | GS only |
| Text report, 20 pp | 96 KB | any | bigger — keep original | **86 KB (−11%)** | GS only |

On a public 245-page, mostly-text report (22.6 MB) the browser reached −41% at low and grew the file at medium; Ghostscript reached −83% / −66% and kept all 70,329 words searchable. Details and side-by-side crops: [PDF compression vs quality](https://kompakt.xronocode.com/guides/pdf-compression-quality).

## Limitations — read before using

- **Text becomes pixels.** The output can't be selected, searched, or read by screen readers.
- **Text/vector PDFs get bigger.** Check `result.ratio` and keep the original when it is `<= 0`.
- **JPEG only.** Browsers can't encode JBIG2/CCITT (ideal for black-and-white scans), and PDF can't embed WebP.
- **Forms, links and annotations are flattened.**

If you need text preserved, use Ghostscript (the [kompakt desktop app](https://github.com/xronocode/kompakt) wraps it).

## How it works

The writer emits four object kinds — catalog, page tree, page with a one-line content stream (`q W 0 0 H 0 0 cm /Im Do Q`), and a `/DCTDecode` image XObject — and records each object's byte offset for the xref table. Full write-up, including three bugs our own benchmark found in the production version: [How kompakt compresses PDFs inside your browser](https://kompakt.xronocode.com/guides/how-browser-pdf-compression-works).

## Tests

`npm test` builds a two-page PDF and checks xref offsets, stream termination, and that pdf.js reads back the original page sizes.

## License

MIT © Mikhail Yevdokimov
