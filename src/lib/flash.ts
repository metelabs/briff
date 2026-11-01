// One-shot messages carried by a redirect's query (`/settings?verified=1`, `/login?reset=1`).
// `<FlashToast />` shows the message as a toast once and strips these params from the URL,
// so a refresh does not repeat it.

export type FlashKind = "ok" | "error";

export interface Flash {
  kind: FlashKind;
  message: string;
  /** Query params to remove after the toast. */
  strip: string[];
}

/** Better Auth's `error=` codes on the email verification / change-email callback. */
export const LINK_ERRORS: Record<string, string> = {
  USER_NOT_FOUND: "This link was already used. Your email change is done if you opened it before.",
  TOKEN_EXPIRED: "This link expired. Request a new one.",
  INVALID_TOKEN: "This link is not valid. Request a new one.",
  INVALID_USER:
    "This link belongs to another account. Sign in with that account and open it again.",
};

export const LINK_ERROR_FALLBACK = "That link did not work. Request a new one.";

interface Rule {
  path: string;
  param: string;
  value: string;
  flash: (params: URLSearchParams) => Omit<Flash, "strip">;
  /** Extra params that belong to this redirect. */
  with?: string[];
}

const RULES: Rule[] = [
  {
    path: "/settings",
    param: "verified",
    value: "1",
    with: ["error"],
    flash: (params) => {
      const error = params.get("error");
      if (error) return { kind: "error", message: LINK_ERRORS[error] ?? LINK_ERROR_FALLBACK };
      return { kind: "ok", message: "Your email address is verified." };
    },
  },
  {
    path: "/settings",
    param: "password",
    value: "changed",
    flash: () => ({ kind: "ok", message: "Password changed. Other devices were signed out." }),
  },
  {
    path: "/login",
    param: "reset",
    value: "1",
    flash: () => ({ kind: "ok", message: "Your password was changed. Sign in with the new one." }),
  },
  {
    path: "/login",
    param: "deleted",
    value: "1",
    flash: () => ({ kind: "ok", message: "Your organisation and account were deleted." }),
  },
];

/** The first flash this URL carries, or null. One URL never yields two messages. */
export function flashFor(pathname: string, params: URLSearchParams): Flash | null {
  for (const rule of RULES) {
    if (rule.path !== pathname || params.get(rule.param) !== rule.value) continue;
    return { ...rule.flash(params), strip: [rule.param, ...(rule.with ?? [])] };
  }
  return null;
}

/** `pathname?rest#hash` with the flash params removed. */
export function strippedUrl(
  pathname: string,
  params: URLSearchParams,
  strip: string[],
  hash = ""
): string {
  const next = new URLSearchParams(params);
  for (const key of strip) next.delete(key);
  const query = next.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

/**
 * What `<FlashToast />` does for the current URL. `shownKey` is the URL it last toasted: the
 * same URL re-rendering stays silent, and a URL without a flash clears the key so the same
 * redirect later (a second password change in the tab) toasts again.
 */
export function flashStep(
  pathname: string,
  params: URLSearchParams,
  shownKey: string | null
): { show: Flash; key: string } | { show: null; key: string | null } {
  const flash = flashFor(pathname, params);
  if (!flash) return { show: null, key: null };
  const key = `${pathname}?${params.toString()}`;
  return key === shownKey ? { show: null, key } : { show: flash, key };
}
