"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/queue", label: "Queue" },
  { href: "/roles", label: "Roles" },
  { href: "/discover", label: "Discover" },
  { href: "/interviews", label: "Interviews" },
  { href: "/candidates", label: "Candidates" },
  { href: "/import", label: "Import & export" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:px-3 md:pb-0">
      {items.map((i) => {
        const active = path === i.href || path.startsWith(i.href + "/");
        return (
          <Link
            key={i.href}
            href={i.href}
            className={clsx(
              "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13.5px] font-medium transition-colors",
              active ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:bg-sunken hover:text-ink",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
