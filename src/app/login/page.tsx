import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MinimalHeader } from "@/components/shell/page-container";
import { Callout } from "@/components/ui/callout";
import { getOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";

import { AuthForm } from "./_client";

export const metadata: Metadata = { title: "Sign in · Briff" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; mode?: string; reset?: string }>;
}) {
  if (await getOrgContext()) redirect("/");
  const { deleted, mode: requestedMode, reset } = await searchParams;
  const hasUsers = (await getDb().user.count()) > 0;
  const mode = hasUsers ? "sign-in" : "bootstrap";
  return (
    <div className="min-h-svh">
      <MinimalHeader />
      <main className="gutter mx-auto w-full max-w-[432px] pt-6 pb-20 md:pt-10">
        {deleted === "1" && (
          <Callout
            tone="ok"
            message="Your organisation and account were deleted."
            className="mb-6"
          />
        )}
        {reset === "1" && (
          <Callout
            tone="ok"
            message="Your password was changed. Sign in with the new one."
            className="mb-6"
          />
        )}
        <AuthForm
          mode={mode}
          allowSignup={!hasUsers || getEnv().ALLOW_SIGNUP}
          signup={requestedMode === "sign-up"}
        />
      </main>
    </div>
  );
}
