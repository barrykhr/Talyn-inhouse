/** Role workspace skeleton: header, the Applicants · Discover · Shortlist tabs, then rows. */
export default function RoleLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading role workspace">
      <div className="h-7 w-64 rounded-lg bg-sunken" />
      <div className="mt-2 h-4 w-48 rounded bg-sunken" />
      <div className="mb-5 mt-6 flex gap-4 border-b border-line pb-2">
        {[88, 80, 76, 64, 104].map((w, i) => (
          <div key={i} className="h-5 rounded bg-sunken" style={{ width: w }} />
        ))}
      </div>
      <div className="mb-4 h-9 rounded-lg bg-sunken" />
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-[var(--radius-card)] bg-sunken" />
        ))}
      </div>
    </div>
  );
}
