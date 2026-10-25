import "server-only";

import { cookies } from "next/headers";

import { parseTheme, THEME_COOKIE, type Theme } from "@/lib/theme";

export async function readTheme(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
