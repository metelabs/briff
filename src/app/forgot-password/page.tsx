import type { Metadata } from "next";
import { headers } from "next/headers";

import { MinimalHeader } from "@/components/shell/page-container";

import { ForgotPasswordForm } from "./_client";

export const metadata: Metadata = { title: "Reset your password · Briff" };

export default async function ForgotPasswordPage() {
  // Request-time page: the form posts to a Server Action that reads env and auth.
  await headers();
  return (
    <div className="min-h-svh">
      <MinimalHeader />
      <main className="gutter mx-auto w-full max-w-[432px] pt-6 pb-20 md:pt-10">
        <ForgotPasswordForm />
      </main>
    </div>
  );
}
