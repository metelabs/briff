import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MinimalHeader } from "@/components/shell/page-container";
import { getOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";

import { AuthForm } from "./_client";

export const metadata: Metadata = { title: "Sign in · Briff" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (await getOrgContext()) redirect("/");
  const { mode: requestedMode } = await searchParams;
  const hasUsers = (await getDb().user.count()) > 0;
  const mode = hasUsers ? "sign-in" : "bootstrap";
  return (
    <div className="min-h-svh">
      <MinimalHeader />
      <main className="gutter mx-auto w-full max-w-[432px] pt-6 pb-20 md:pt-10">
        <AuthForm
          mode={mode}
          allowSignup={!hasUsers || getEnv().ALLOW_SIGNUP}
          signup={requestedMode === "sign-up"}
        />
      </main>
    </div>
  );
}
