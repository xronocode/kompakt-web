// Minimal streaming PDF writer for image-only documents.
//
// Every page is one JPEG drawn over the full page. The writer emits four object
// kinds (catalog, page tree, page + content stream, image XObject), records each
// object's byte offset for the xref table, and keeps the output as a list of
// chunks so nothing is ever concatenated into one large buffer.

const enc = new TextEncoder();

export class StreamingPdfWriter {
  constructor() {
    this.chunks = [];
    this.pos = 0;
    this.offsets = {};
    this.pages = [];
    this.nextObj = 3; // 1 = catalog, 2 = page tree (written last)
    this._str('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    this._open(1);
    this._str('<< /Type /Catalog /Pages 2 0 R >>');
    this._close();
  }

  _str(s) { this._bytes(enc.encode(s)); }
  _bytes(b) {
    const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
    this.chunks.push(u8);
    this.pos += u8.length;
  }
  _open(n) { this.offsets[n] = this.pos; this._str(`${n} 0 obj\n`); }
  _close() { this._str('\nendobj\n'); }
  _stream(dict, data) {
    this._str(`${dict.slice(0, -2)} /Length ${data.length} >>\nstream\n`);
    this._bytes(data);
    this._str('\nendstream');
  }

  /**
   * Append a page.
   * @param {number} widthPt  page width in PDF points (1/72 in) — keeps the paper size
   * @param {number} heightPt page height in PDF points
   * @param {number} widthPx  JPEG width in pixels
   * @param {number} heightPx JPEG height in pixels
   * @param {Uint8Array} jpeg baseline or progressive JPEG bytes (RGB)
   */
  addPage(widthPt, heightPt, widthPx, heightPx, jpeg) {
    const page = this.nextObj, content = page + 1, image = page + 2;
    this.nextObj += 3;
    this.pages.push(page);
    const w = widthPt.toFixed(2), h = heightPt.toFixed(2);

    this._open(page);
    this._str(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${content} 0 R /Resources << /XObject << /Im ${image} 0 R >> >> >>`);
    this._close();

    this._open(content);
    this._stream('<< >>', enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im Do Q`));
    this._close();

    this._open(image);
    this._stream(`<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>`, jpeg);
    this._close();
  }

  /** Write the page tree, xref and trailer; return the finished PDF. */
  finish() {
    this._open(2);
    this._str(`<< /Type /Pages /Kids [${this.pages.map(n => `${n} 0 R`).join(' ')}] /Count ${this.pages.length} >>`);
    this._close();
    const xref = this.pos;
    let table = `xref\n0 ${this.nextObj}\n0000000000 65535 f \n`;
    for (let i = 1; i < this.nextObj; i++) table += `${String(this.offsets[i]).padStart(10, '0')} 00000 n \n`;
    this._str(`${table}trailer\n<< /Size ${this.nextObj} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return this.chunks;
  }
}
