import Link from "next/link";
import { redirect } from "next/navigation";

import { MinimalHeader } from "@/components/shell/page-container";
import { buttonVariants } from "@/components/ui/button";
import { getOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { cn } from "@/lib/utils";

import { AuthForm } from "./_client";
import { type AuthRoute, authView } from "./signup-state";

/** The body of /login and /signup: one form, the route decides sign-in or sign-up. */
export async function AuthPage({ route }: { route: AuthRoute }) {
  if (await getOrgContext()) redirect("/");
  const hasUsers = (await getDb().user.count()) > 0;
  const allowSignup = getEnv().ALLOW_SIGNUP;
  const view = authView(route, hasUsers, allowSignup);
  return (
    <div className="min-h-svh">
      <MinimalHeader />
      <main className="gutter mx-auto w-full max-w-[432px] pt-6 pb-20 md:pt-10">
        {view.kind === "form" ? (
          <AuthForm mode={view.mode} allowSignup={!hasUsers || allowSignup} signup={view.signup} />
        ) : (
          <>
            <h1 className="type-page rise mb-2 [font-size:clamp(28px,6vw,36px)]">
              Sign-ups are closed
            </h1>
            <p className="text-fg-muted rise mb-6 text-[15px] [--i:1]">
              Sign-ups are closed on this instance. To get an account, ask the operator who runs it.
              If you were invited, open the link in the invite email.
            </p>
            <Link
              href="/login"
              className={cn(
                buttonVariants({ variant: "secondary", size: "lg" }),
                "rise w-full [--i:2]"
              )}
            >
              Sign in
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
