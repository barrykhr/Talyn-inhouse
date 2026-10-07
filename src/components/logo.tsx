export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <rect width="22" height="22" rx="6" fill="#17171a" />
        <path d="M6 7h10M11 7v9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="16" cy="15.5" r="1.8" fill="#d9541e" />
      </svg>
      {!compact && (
        <span className="leading-none">
          <span className="text-[15px] font-semibold tracking-tight">Talyn</span>
          <span className="ml-1.5 text-[12px] font-medium text-muted">In-house TA</span>
        </span>
      )}
    </span>
  );
}
