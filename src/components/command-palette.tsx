"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { quickSearch, type SearchHit } from "@/server/search-actions";

type Item = { key: string; label: string; hint: string; href: string; group: string };

const COMMANDS: Item[] = [
  { key: "c-home", label: "Go to Home", hint: "G then H", href: "/home", group: "Go to" },
  { key: "c-integrations", label: "Go to integrations", hint: "", href: "/integrations", group: "Go to" },
  { key: "c-guide", label: "Open the guide", hint: "", href: "/guide", group: "Go to" },
  { key: "c-queue", label: "Go to full review queue", hint: "G then Q", href: "/queue", group: "Go to" },
  { key: "c-discover", label: "Go to Discover", hint: "G then D", href: "/discover", group: "Go to" },
  { key: "c-interviews", label: "Go to interviews", hint: "G then I", href: "/interviews", group: "Go to" },
  { key: "c-roles", label: "Go to roles", hint: "G then R", href: "/roles", group: "Go to" },
  { key: "c-cands", label: "Go to candidates", hint: "G then C", href: "/candidates", group: "Go to" },
  { key: "c-newrole", label: "New role from a job description", hint: "", href: "/roles/new", group: "Create" },
  { key: "c-newcand", label: "New candidate from a CV", hint: "", href: "/candidates/new", group: "Create" },
  { key: "c-import", label: "Import or export CSV", hint: "", href: "/import", group: "Go to" },
  { key: "c-settings", label: "Settings", hint: "", href: "/settings", group: "Go to" },
];

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/** ⌘K / Ctrl+K command palette and G-sequence shortcuts for fast, keyboard-first navigation. */
export function CommandPalette() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  const open = () => {
    setQ("");
    setActive(0);
    dialog.current?.showModal();
    setTimeout(() => input.current?.focus(), 0);
    // Show recent roles and candidates immediately.
    setLoading(true);
    quickSearch("")
      .then(setHits)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else open();
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || dialog.current?.open) return;
      if (e.key === "g") g = Date.now();
      else if (Date.now() - g < 900 && (e.key === "r" || e.key === "c" || e.key === "q" || e.key === "d" || e.key === "i" || e.key === "h")) {
        g = 0;
        router.push(e.key === "r" ? "/roles" : e.key === "c" ? "/candidates" : e.key === "d" ? "/discover" : e.key === "i" ? "/interviews" : e.key === "h" ? "/home" : "/queue");
      }
    };
    const onOpen = () => open();
    window.addEventListener("keydown", onKey);
    window.addEventListener("talyn:command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("talyn:command-palette", onOpen);
    };
  }, [router]);

  useEffect(() => {
    if (!dialog.current?.open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await quickSearch(q);
        if (!cancelled) setHits(r);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const commands = COMMANDS.filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));
  const items: Item[] = [
    ...hits.map((h) => ({ key: h.kind + h.id, label: h.title, hint: h.subtitle, href: h.href, group: h.kind === "role" ? "Roles" : "Candidates" })),
    ...commands,
  ];
  const go = (it: Item | undefined) => {
    if (!it) return;
    dialog.current?.close();
    router.push(it.href);
  };

  let lastGroup = "";
  return (
    <dialog
      ref={dialog}
      aria-label="Command palette"
      className="mx-auto mt-[12vh] w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl"
      onClick={(e) => e.target === dialog.current && dialog.current?.close()}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 focus-within:bg-[#fdfcfa]">
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden className="text-faint">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(items[active]);
            }
          }}
          placeholder="Search roles and candidates, or jump to…"
          aria-label="Search"
          aria-controls="palette-list"
          aria-activedescendant={items[active] ? `palette-${items[active].key}` : undefined}
          className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint focus-visible:outline-none"
        />
        {loading && <span className="activity-dot h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />}
        <kbd>esc</kbd>
      </div>
      <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
        {items.length === 0 && !loading && <li className="px-3 py-6 text-center text-[13px] text-muted">No matches</li>}
        {items.map((it, i) => {
          const header = it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          return (
            <li key={it.key} role="presentation">
              {header && <div className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-faint">{header}</div>}
              <div
                id={`palette-${it.key}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(it)}
                className={clsx("flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-[14px]", i === active && "bg-sunken")}
              >
                <span className="truncate">{it.label}</span>
                {it.hint && <span className="shrink-0 truncate text-[12px] text-muted">{it.hint}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}

export function OpenPaletteButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("talyn:command-palette"))}
      className="flex w-full items-center justify-between rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[13px] text-muted hover:border-line-strong hover:text-ink"
    >
      <span>Search or jump to…</span>
      <kbd>⌘K</kbd>
    </button>
  );
}
