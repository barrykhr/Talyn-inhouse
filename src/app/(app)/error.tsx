"use client";

import Link from "next/link";
import { Button, buttonClass } from "@/components/ui";

/** Route error: says what happened, that nothing changed, and how to recover. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-lg font-semibold">This page couldn&apos;t load</h1>
      <p className="mt-1 text-[13px] text-muted">
        Talyn hit an error while loading it — often a database or provider timeout. Your data hasn&apos;t been changed.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Link href="/home" className={buttonClass("secondary")}>
          Go to Home
        </Link>
      </div>
      {error.digest && <p className="mt-4 text-[11.5px] text-faint">Reference: {error.digest}</p>}
    </div>
  );
}
