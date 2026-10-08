export type ActionState = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string>; redirectTo?: string } | undefined;

/**
 * Success result that tells the client form to navigate. Used instead of redirect() for
 * actions submitted through <ActionForm>/<ActionButton>, which navigate explicitly.
 * Don't call revalidatePath() before returning it: that re-renders the current page under
 * the form (racing the navigation). Destination pages are dynamic and always load fresh.
 */
export function goTo(path: string): ActionState {
  return { ok: true, redirectTo: path };
}

export function str(fd: FormData, key: string, max = 500): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function optStr(fd: FormData, key: string, max = 500): string | null {
  const v = str(fd, key, max);
  return v ? v : null;
}
