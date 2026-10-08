import "server-only";

// Vercel caps request bodies at ~4.5 MB, so uploads stay under 4 MB.
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;

export type ExtractedResume = { pages: string[]; mimeType: string; ext: string };

const PDF_MAGIC = "%PDF-";
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/**
 * Extracts resume text per page. File type is decided from magic bytes, not the
 * client-supplied name or MIME type. DOCX and TXT have no reliable page concept,
 * so they are returned as a single "page".
 */
export async function extractResume(fileName: string, data: Buffer): Promise<ExtractedResume> {
  if (data.length === 0) throw new Error("The file is empty.");
  if (data.length > MAX_RESUME_BYTES) throw new Error("Resume files must be 4 MB or smaller.");

  if (data.subarray(0, 5).toString("latin1") === PDF_MAGIC) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map(normalize);
    return { pages, mimeType: "application/pdf", ext: "pdf" };
  }

  if (ZIP_MAGIC.every((b, i) => data[i] === b) && /\.docx$/i.test(fileName)) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: data });
    return {
      pages: [normalize(value)],
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ext: "docx",
    };
  }

  if (/\.(txt|md)$/i.test(fileName)) {
    const text = data.toString("utf8");
    if (text.includes("\u0000")) throw new Error("This doesn't look like a text file.");
    return { pages: [normalize(text)], mimeType: "text/plain", ext: "txt" };
  }

  throw new Error("Unsupported file. Upload a PDF, DOCX or TXT resume.");
}

export function normalize(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
