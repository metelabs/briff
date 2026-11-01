import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { MinimalHeader } from "@/components/shell/page-container";
import { buttonVariants } from "@/components/ui/button";

import { ResetPasswordForm } from "./_client";

export const metadata: Metadata = { title: "Choose a new password · Briff" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  await headers();
  const { token, error } = await searchParams;
  return (
    <div className="min-h-svh">
      <MinimalHeader />
      <main className="gutter mx-auto w-full max-w-[432px] pt-6 pb-20 md:pt-10">
        {token && !error ? (
          <ResetPasswordForm token={token} />
        ) : (
          <>
            <h1 className="type-page rise mb-2 [font-size:clamp(28px,6vw,36px)]">
              This link does not work
            </h1>
            <p className="text-fg-muted rise mb-6 text-[15px] [--i:1]">
              Reset links work once and expire after one hour. Ask for a new one.
            </p>
            <Link
              href="/forgot-password"
              className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })}
            >
              Send a new link
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
