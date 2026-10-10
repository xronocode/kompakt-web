// Minimal streaming PDF writer for image-only documents.
//
// Every page is one JPEG drawn over the full page. The writer emits four object
// kinds (catalog, page tree, page + content stream, image XObject), records each
// object's byte offset for the xref table, and keeps the output as a list of
// chunks so nothing is ever concatenated into one large buffer.
//
// Object layout: 1 = catalog, 2 = page tree (written last, once all page
// numbers are known), then three objects per page: page, content, image.

const enc = new TextEncoder();

// "%PDF-1.4" plus a comment of four bytes >= 0x80, which tells transfer tools
// the file is binary (PDF 32000-1:2008, 7.5.2). Written as raw bytes: passing
// these characters through TextEncoder would UTF-8-encode them into eight bytes.
const HEADER = Uint8Array.of(...enc.encode('%PDF-1.4\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a);

export class StreamingPdfWriter {
  constructor() {
    this.chunks = [];
    this.pos = 0;
    this.offsets = [];
    this.pages = [];
    this.nextObj = 3;
    this.finished = false;
    this._bytes(HEADER);
    this._object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  }

  get pageCount() { return this.pages.length; }

  /**
   * Append a page.
   * @param {number} widthPt  page width in PDF points (1/72 in) — keeps the paper size
   * @param {number} heightPt page height in PDF points
   * @param {number} widthPx  JPEG width in pixels
   * @param {number} heightPx JPEG height in pixels
   * @param {Uint8Array} jpeg 3-component (RGB) JPEG bytes, e.g. from canvas.toBlob('image/jpeg')
   */
  addPage(widthPt, heightPt, widthPx, heightPx, jpeg) {
    if (this.finished) throw new Error('StreamingPdfWriter: addPage() after finish()');
    const page = this.nextObj, content = page + 1, image = page + 2;
    this.nextObj += 3;
    this.pages.push(page);
    const w = widthPt.toFixed(2), h = heightPt.toFixed(2);

    this._object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${content} 0 R /Resources << /XObject << /Im ${image} 0 R >> >> >>`);
    // Scale the unit-square image to the full page and draw it.
    this._streamObject(content, '', enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im Do Q`));
    this._streamObject(image, `/Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, jpeg);
  }

  /**
   * Write the page tree, xref table and trailer.
   * @returns {Uint8Array[]} chunks — pass to `new Blob(chunks, { type: 'application/pdf' })`
   */
  finish() {
    if (this.finished) throw new Error('StreamingPdfWriter: finish() called twice');
    if (!this.pages.length) throw new Error('StreamingPdfWriter: a PDF needs at least one page');
    this.finished = true;
    this._object(2, `<< /Type /Pages /Kids [${this.pages.map(n => `${n} 0 R`).join(' ')}] /Count ${this.pages.length} >>`);

    const xref = this.pos;
    // Each xref entry is exactly 20 bytes: 10-digit offset, space, 5-digit generation, space, type, space, LF.
    let table = `xref\n0 ${this.nextObj}\n0000000000 65535 f \n`;
    for (let i = 1; i < this.nextObj; i++) table += `${String(this.offsets[i]).padStart(10, '0')} 00000 n \n`;
    this._str(`${table}trailer\n<< /Size ${this.nextObj} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return this.chunks;
  }

  _str(s) { this._bytes(enc.encode(s)); }

  _bytes(u8) {
    this.chunks.push(u8);
    this.pos += u8.byteLength;
  }

  _object(n, body) {
    this.offsets[n] = this.pos;
    this._str(`${n} 0 obj\n${body}\nendobj\n`);
  }

  // A stream object: dictionary entries + /Length, then the raw bytes.
  // "endstream" must sit on its own line before "endobj".
  _streamObject(n, entries, data) {
    this.offsets[n] = this.pos;
    this._str(`${n} 0 obj\n<< ${entries}${entries ? ' ' : ''}/Length ${data.byteLength} >>\nstream\n`);
    this._bytes(data);
    this._str('\nendstream\nendobj\n');
  }
}
