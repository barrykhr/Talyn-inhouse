const PHRASE = "Your recruiting assistant that guides, suggests and lets you decide";

/**
 * Talyn's mark, large, with the product line circling it. The ring turns slowly and stops for
 * people who prefer reduced motion (see globals.css).
 */
export function OrbitLogo({ size = 420 }: { size?: number }) {
  const r = 170;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <h2 className="sr-only">{PHRASE}</h2>
      <svg viewBox="0 0 420 420" className="motion-orbit absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <path id="talyn-orbit" d={`M 210,210 m -${r},0 a ${r},${r} 0 1,1 ${2 * r},0 a ${r},${r} 0 1,1 -${2 * r},0`} />
        </defs>
        <text className="fill-ink-2" style={{ fontSize: 17, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          <textPath href="#talyn-orbit" textLength={circumference - 2} lengthAdjust="spacing">
            {PHRASE} ·
          </textPath>
        </text>
      </svg>
      <svg viewBox="0 0 22 22" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: size * 0.38, height: size * 0.38 }} role="img" aria-label="Talyn">
        <rect width="22" height="22" rx="6" fill="#17171a" />
        <path d="M6 7h10M11 7v9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="16" cy="15.5" r="1.8" fill="#d9541e" />
      </svg>
    </div>
  );
}
