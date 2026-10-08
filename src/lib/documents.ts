import "server-only";

// Text extraction for uploaded JDs and CVs. File type is decided from the file's
// bytes, never from the client-supplied name or MIME type. Failures are reported
// with a specific, recruiter-facing reason; nothing is ever "successfully" parsed
// unless readable text was actually found.

export const PARSER_VERSION = "text-v2 (unpdf, mammoth)";
// Vercel caps request bodies at ~4.5 MB, so uploads stay under 4 MB.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MIN_TEXT_CHARS = 80;

export type ParsedDocument = { pages: string[]; mimeType: string; ext: "pdf" | "docx" | "txt"; parserVersion: string };

export type ParseErrorCode = "empty" | "too_large" | "password" | "corrupted" | "scanned" | "legacy_doc" | "unsupported" | "unreadable";

export class DocumentParseError extends Error {
  constructor(
    public code: ParseErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<ParseErrorCode, string> = {
  empty: "The file is empty.",
  too_large: "Files must be 4 MB or smaller.",
  password: "This PDF is password-protected, so its text can't be read. Remove the password and upload it again, or enter the details manually.",
  corrupted: "This file appears to be damaged or incomplete and couldn't be opened. Try exporting it again, or enter the details manually.",
  scanned:
    "No selectable text was found — this looks like a scanned image or photo. Upload a text-based PDF or DOCX, paste the text, or enter the details manually.",
  legacy_doc: "Old Word (.doc) files aren't supported. Save it as .docx or PDF and upload again, or enter the details manually.",
  unsupported: "Unsupported file type. Upload a PDF or DOCX (or TXT), or enter the details manually.",
  unreadable: "The file couldn't be read. Try a different export of the document, or enter the details manually.",
};

const fail = (code: ParseErrorCode): never => {
  throw new DocumentParseError(code, MESSAGES[code]);
};

const PDF_MAGIC = "%PDF-";
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // legacy .doc (and other OLE files)

export async function parseDocument(fileName: string, data: Buffer, opts: { allowText?: boolean } = {}): Promise<ParsedDocument> {
  if (data.length === 0) fail("empty");
  if (data.length > MAX_UPLOAD_BYTES) fail("too_large");

  let pages: string[] | null = null;
  let mimeType = "";
  let ext: ParsedDocument["ext"] = "txt";

  if (data.subarray(0, 5).toString("latin1") === PDF_MAGIC) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    try {
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await extractText(pdf, { mergePages: false });
      pages = (Array.isArray(text) ? text : [text]).map(normalize);
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      if (name === "PasswordException") fail("password");
      if (name === "InvalidPDFException" || name === "FormatError") fail("corrupted");
      fail("unreadable");
    }
    mimeType = "application/pdf";
    ext = "pdf";
  } else if (OLE_MAGIC.every((b, i) => data[i] === b)) {
    fail("legacy_doc");
  } else if (ZIP_MAGIC.every((b, i) => data[i] === b)) {
    if (!/\.docx$/i.test(fileName)) fail("unsupported");
    const mammoth = await import("mammoth");
    try {
      const { value } = await mammoth.extractRawText({ buffer: data });
      pages = [normalize(value)];
    } catch {
      fail("corrupted");
    }
    mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    ext = "docx";
  } else if (opts.allowText !== false && /\.(txt|md)$/i.test(fileName)) {
    const text = data.toString("utf8");
    if (text.includes("\u0000")) fail("unsupported");
    pages = [normalize(text)];
    mimeType = "text/plain";
    ext = "txt";
  } else {
    fail("unsupported");
  }

  if (!pages || pages.join("").replace(/\s/g, "").length < MIN_TEXT_CHARS) fail("scanned");
  return { pages: pages!, mimeType, ext, parserVersion: PARSER_VERSION };
}

export function normalize(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
