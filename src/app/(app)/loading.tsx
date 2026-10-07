export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-56 rounded-lg bg-sunken" />
      <div className="h-4 w-80 rounded bg-sunken" />
      <div className="grid gap-3 pt-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-[var(--radius-card)] bg-sunken" />
        ))}
      </div>
    </div>
  );
}
