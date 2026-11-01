import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AuthForm } from "@/app/login/_client";
import { MinimalHeader } from "@/components/shell/page-container";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { getSessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { shortDate } from "@/lib/format";
import { normalizeEmail } from "@/lib/invite-token";
import { findInviteByToken, memberRole } from "@/lib/members";
import { cn } from "@/lib/utils";

import { JoinButton, SignOutForInviteButton } from "./_client";

// The token is in the path: keep it out of Referer headers sent to other sites.
export const metadata: Metadata = { title: "Invite · Briff", referrer: "no-referrer" };

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh">
      <MinimalHeader />
      <main className="gutter mx-auto w-full max-w-[432px] pt-6 pb-20 md:pt-10">{children}</main>
    </div>
  );
}

function Message({
  title,
  lead,
  children,
}: {
  title: string;
  lead: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Shell>
      <h1 className="type-page rise mb-2 [font-size:clamp(28px,6vw,36px)]">{title}</h1>
      <div className="text-fg-muted rise mb-6 text-[15px] [--i:1]">{lead}</div>
      <div className="rise grid gap-3 [--i:2]">{children}</div>
    </Shell>
  );
}

const homeLink = cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full");

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  // The session read comes first: it reads the request headers, so the page is never prerendered.
  const user = await getSessionUser();
  const { token } = await params;
  const db = getDb();
  const invite = await findInviteByToken(db, token);

  if (!invite) {
    return (
      <Message
        title="This invite link does not work"
        lead="It may be mistyped or cut off, or a newer invite replaced it. Ask the person who invited you to send it again."
      >
        <Link href="/" className={homeLink}>
          Go to Briff
        </Link>
      </Message>
    );
  }

  if (user && (await memberRole(db, invite.orgId, user.userId))) {
    return (
      <Message
        title="You are already a member"
        lead={
          <>
            Your account <b className="text-fg font-medium">{user.email}</b> already belongs to{" "}
            <b className="text-fg font-medium">{invite.orgName}</b>. Pick it in the account menu
            under your initials.
          </>
        }
      >
        <Link href="/" className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}>
          Open Briff
        </Link>
      </Message>
    );
  }

  if (invite.status !== "pending") {
    const copy = {
      expired: {
        title: "This invite has expired",
        lead: `Invites work for 7 days; this one ended on ${shortDate(invite.expiresAt)}. Ask ${invite.inviterName ?? "an owner of " + invite.orgName} for a new one.`,
      },
      revoked: {
        title: "This invite was revoked",
        lead: `An owner of ${invite.orgName} took it back. Ask them for a new invite if you should still join.`,
      },
      accepted: {
        title: "This invite was already used",
        lead: `Each invite works once. If you accepted it, sign in with ${invite.email}; otherwise ask an owner of ${invite.orgName} for a new one.`,
      },
    }[invite.status];
    return (
      <Message title={copy.title} lead={copy.lead}>
        <Link href="/" className={homeLink}>
          Go to Briff
        </Link>
      </Message>
    );
  }

  if (user && normalizeEmail(user.email) !== invite.email) {
    return (
      <Message
        title={`Join ${invite.orgName}`}
        lead="This invite is for a different email address than the one you are signed in with."
      >
        <Callout
          tone="warn"
          message={`The invite is for ${invite.email}. You are signed in as ${user.email}.`}
        >
          Sign out, then sign in or create an account with {invite.email}. Or ask for an invite to{" "}
          {user.email}.
        </Callout>
        <SignOutForInviteButton token={token} />
      </Message>
    );
  }

  if (user) {
    return (
      <Message
        title={`Join ${invite.orgName}`}
        lead={
          <>
            {invite.inviterName ?? "An owner"} invited you as{" "}
            {invite.role === "owner" ? "an owner" : "a member"}. You get its bulletins and security
            alerts at <b className="text-fg font-medium">{user.email}</b>, next to the organisations
            you already have.
          </>
        }
      >
        <JoinButton token={token} orgName={invite.orgName} />
      </Message>
    );
  }

  // Signed out: an invite is a way in even when sign-ups are closed.
  const hasAccount = (await db.user.count({ where: { email: invite.email } })) > 0;
  return (
    <Shell>
      <AuthForm
        mode="sign-in"
        allowSignup
        signup={!hasAccount}
        invite={{
          token,
          email: invite.email,
          orgName: invite.orgName,
          inviterName: invite.inviterName,
        }}
      />
    </Shell>
  );
}
