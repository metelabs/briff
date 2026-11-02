import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthPage } from "./auth-page";

export const metadata: Metadata = { title: "Sign in · Briff" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  // Older links and emails opened the sign-up form with this query.
  if ((await searchParams).mode === "sign-up") redirect("/signup");
  return <AuthPage route="login" />;
}
