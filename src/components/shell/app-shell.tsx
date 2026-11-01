import type { ReactNode } from "react";

import type { OrgContext } from "@/lib/auth/session";
import { isCloud } from "@/lib/env";
import { isInstanceAdmin, listUserOrgs } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { hasUnseenAlerts } from "@/lib/member-state";
import { loadStreamScope, repoScope } from "@/lib/stream-scope";
import { readTheme } from "@/lib/theme-cookie";

import { ConnectSheetProvider } from "./connect-sheet";
import type { NavHref } from "./nav";
import { PageContainer } from "./page-container";
import { SiteFooter } from "./site-footer";
import { TopBar } from "./top-bar";
import { VerifyEmailBanner } from "./verify-email-banner";

/**
 * One shell for every signed-in page (DESIGN.md §2): sticky top bar with the pill nav,
 * Connect repos, the stream picker and the account menu, then the page in the shared
 * `PageContainer`, then a quiet footer.
 */
export async function AppShell({
  ctx,
  active,
  children,
}: {
  ctx: OrgContext;
  active: NavHref;
  children: ReactNode;
}) {
  const [admin, scope, theme, orgs] = await Promise.all([
    isInstanceAdmin(ctx.userId),
    loadStreamScope(ctx.orgId),
    readTheme(),
    listUserOrgs(ctx.userId),
  ]);
  const alertsDot = await hasUnseenAlerts(getDb(), ctx.orgId, ctx.userId, repoScope(scope));

  return (
    <ConnectSheetProvider>
      <div className="flex min-h-svh flex-col">
        <TopBar
          active={active}
          admin={admin}
          theme={theme}
          alertsDot={alertsDot}
          user={{ name: ctx.name, email: ctx.email }}
          streams={scope.streams}
          currentStreamId={scope.current?.id ?? null}
          orgs={orgs}
          currentOrgId={ctx.orgId}
        />
        <PageContainer as="main" className="flex flex-1 flex-col pb-16">
          {!ctx.emailVerified && (
            <div className="pt-4">
              <VerifyEmailBanner email={ctx.email} />
            </div>
          )}
          {children}
        </PageContainer>
        <SiteFooter pricing={isCloud()} />
      </div>
    </ConnectSheetProvider>
  );
}
