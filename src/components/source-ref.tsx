// Shows where an extracted fact or criterion came from: document, page, section, and
// whether the quoted text was actually found in the document.
export function SourceRef({
  doc,
  quote,
  page,
  section,
  verified,
  extractor,
}: {
  doc: string;
  quote: string | null;
  page?: number | null;
  section?: string | null;
  verified?: boolean;
  extractor?: string | null;
}) {
  if (!quote) return <span className="text-[11.5px] text-faint">No source excerpt{extractor ? ` · ${extractorLabel(extractor)}` : ""}</span>;
  return (
    <details className="group text-[11.5px]">
      <summary className="cursor-pointer list-none text-muted hover:text-ink">
        <span className="underline-offset-2 group-open:underline">
          {doc}
          {page ? ` · p.${page}` : ""}
          {section ? ` · ${section}` : ""}
        </span>{" "}
        {verified ? <span className="text-ok">✓ found in document</span> : <span className="text-warn">⚠ not found verbatim — verify</span>}
        {extractor && <span className="text-faint"> · {extractorLabel(extractor)}</span>}
      </summary>
      <p className="quote mt-1 border-l-2 border-line-strong pl-2 text-ink-2">“{quote}”</p>
    </details>
  );
}

export function extractorLabel(extractor: string) {
  if (extractor.startsWith("ai:")) return `AI (${extractor.split(":")[2]?.split("/")[0] ?? "model"})`;
  if (extractor.includes("contact-regex")) return "contact parser (not AI)";
  return "basic parser (not AI)";
}
