"use client";

// Last-resort boundary (e.g. the app shell itself failed). Plain markup: the app's styles may not be loaded.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1rem", textAlign: "center", color: "#17171a", background: "#f6f5f1" }}>
        <h1 style={{ fontSize: 18 }}>Talyn couldn&apos;t load</h1>
        <p style={{ fontSize: 13, color: "#5f5d57" }}>The server didn&apos;t respond as expected. Nothing was changed.</p>
        <button onClick={reset} style={{ marginTop: 16, padding: "8px 14px", borderRadius: 8, border: 0, background: "#17171a", color: "#fff", cursor: "pointer" }}>
          Try again
        </button>
        {error.digest && <p style={{ marginTop: 16, fontSize: 11, color: "#9b988f" }}>Reference: {error.digest}</p>}
      </body>
    </html>
  );
}
