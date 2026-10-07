"use client";

import { Button } from "@/components/ui";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 text-[13px] text-muted">The page couldn&apos;t be loaded. Your data has not been changed.</p>
      <Button className="mt-5" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
