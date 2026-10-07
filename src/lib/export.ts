import "server-only";
import { toCsv } from "./csv";

export function csvResponse(filename: string, headers: string[], rows: unknown[][]) {
  return new Response(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
