import { CircleCheck } from "lucide-react";
import { OrgCapacityNotice } from "@/components/org-capacity-notice";
import { loadOrgCapacity } from "@/lib/org-capacity";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { ConnectReposButton } from "@/components/shell/connect-sheet";
import { PageHeader } from "@/components/ui/section-header";
import { Tag } from "@/components/ui/tag";
import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { smtpConfig } from "@/lib/email/mailer";
import { plural, shortDate, shortDateTime } from "@/lib/format";
import { listScanTokens } from "@/lib/scan/token-store";
import { loadMembers, loadOpenInvites, loadOrgEvents, ORG_NAME_MAX } from "@/lib/members";
import { eventSentence } from "@/lib/org-events";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EXCLUDE_AT, parseWeights } from "@/pipeline/weights";

import { loadGithubAppState } from "../onboarding/loaders";

import {
  ChangeEmailForm,
  ChangePasswordForm,
  DeleteOrgButton,
  DeliveryForm,
  NewScanTokenButton,
  ProfileTextForm,
  ScanTokenList,
  SectionIndex,
  SignOutButton,
} from "./_client";
import { InviteForm, MemberList, OrgNameForm, PendingInvites } from "./_members";

export const metadata: Metadata = { title: "Settings · Briff" };

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "weights", label: "Weights" },
  { id: "delivery", label: "Delivery" },
  { id: "github", label: "GitHub App" },
  { id: "scan-tokens", label: "Scan tokens" },
  { id: "organisation", label: "Organisation" },
  { id: "members", label: "Members" },
  { id: "your-data", label: "Your data" },
  { id: "account", label: "Account" },
];

const WEIGHT_GROUPS: { prefix: string; label: string }[] = [
  { prefix: "topic:", label: "Topics" },
  { prefix: "service:", label: "Services" },
  { prefix: "package:", label: "Packages" },
  { prefix: "source:", label: "Sources" },
];

function Block({
  id,
  title,
  sub,
  index,
  children,
}: {
  id: string;
  title: string;
  sub: ReactNode;
  index: number;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      style={{ "--i": index } as CSSProperties}
      className="rise bg-surface border-line rounded-card mb-4 scroll-mt-[calc(var(--bar-h,64px)+12px)] border p-5"
    >
      <h2 className="type-h2 mb-1">{title}</h2>
      <div className="text-fg-muted mb-4 text-[13.5px]">{sub}</div>
      {children}
    </section>
  );
}

function formatWeight(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export default async function SettingsPage() {
  const ctx = await requireOrgContext();
  const db = getDb();
  const scoped = withOrg(db, ctx.orgId);
  const owner = ctx.role === "owner";
  const [profile, user, streams, tokens, org, github, capacity, members, invites, events] =
    await Promise.all([
      scoped.interestProfile.findFirst({
        select: { text: true, weights: true, refreshedAt: true, model: true, promptVersion: true },
      }),
      // The user row is the signed-in user's own (not tenant data).
      db.user.findUniqueOrThrow({
        where: { id: ctx.userId },
        select: { email: true, deliveryEmail: true },
      }),
      scoped.bulletinStream.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, _count: { select: { repos: true } } },
      }),
      listScanTokens(db, ctx.orgId),
      db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } }),
      loadGithubAppState(ctx.orgId),
      loadOrgCapacity(db, ctx.orgId),
      loadMembers(db, ctx.orgId),
      owner ? loadOpenInvites(db, ctx.orgId) : Promise.resolve([]),
      owner ? loadOrgEvents(db, ctx.orgId) : Promise.resolve([]),
    ]);
  const ownerCount = members.filter((m) => m.role === "owner").length;
  const weights = Object.entries(parseWeights(profile?.weights));
  const emailReady = smtpConfig() !== null;

  return (
    <AppShell ctx={ctx} active="/settings">
      <PageHeader title="Settings" />
      <div className="grid items-start gap-3 md:grid-cols-[200px_minmax(0,640px)] md:gap-8">
        <SectionIndex sections={SECTIONS} />
        <div className="min-w-0">
          <OrgCapacityNotice capacity={capacity} />
          <Block
            id="profile"
            index={0}
            title="Profile"
            sub={
              <>
                Briff reads this when it writes your bulletin, and refreshes it from your feedback
                before each one; your edits are kept.
                {profile?.refreshedAt &&
                  ` Last refresh ${profile.refreshedAt.toISOString().slice(0, 10)} (${profile.model}, ${profile.promptVersion}).`}
              </>
            }
          >
            <ProfileTextForm text={profile?.text ?? ""} />
          </Block>

          <Block
            id="weights"
            index={1}
            title="Weights"
            sub={`Learned from your feedback on bulletin items: Useful raises, Not useful and Less of this lower. Positive ranks higher; an item whose weights add up to ${EXCLUDE_AT} or lower is left out.`}
          >
            <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b pb-3">
              <div>
                <b className="font-medium">Security fixes and deadlines</b>
                <small className="text-fg-muted block text-[12.5px]">
                  Always kept, whatever the weights say
                </small>
              </div>
              <span className="text-fg-muted flex items-center gap-1.5 text-[12.5px]">
                <CircleCheck aria-hidden className="size-3.5" />
                Always
              </span>
            </div>
            {weights.length === 0 ? (
              <p className="text-fg-muted pt-3 text-[13.5px]">
                No feedback yet. Use Useful / Not useful / Less of this on a bulletin item.
              </p>
            ) : (
              WEIGHT_GROUPS.map((group) => {
                const rows = weights
                  .filter(([key]) => key.startsWith(group.prefix))
                  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
                if (rows.length === 0) return null;
                return (
                  <div key={group.prefix} className="pt-3">
                    <h3 className="text-fg-muted mb-1 text-[12px] font-semibold">{group.label}</h3>
                    <ul>
                      {rows.map(([key, value]) => (
                        <li
                          key={key}
                          className="border-line flex items-center justify-between gap-3 border-t py-2 first:border-t-0"
                        >
                          <span className="min-w-0 font-mono text-[13px] break-all">
                            {key.slice(group.prefix.length)}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 font-mono text-[13px] tabular-nums",
                              value > 0 ? "text-ok" : value < 0 ? "text-upgrade" : "text-fg-muted"
                            )}
                          >
                            {formatWeight(value)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </Block>

          <Block
            id="delivery"
            index={2}
            title="Delivery"
            sub={
              <>
                Bulletins go out on Monday 04:00 UTC; critical and high security alerts the same
                day.
                {!emailReady &&
                  " Email is not configured on this instance yet (SMTP_* / FROM_EMAIL)."}
              </>
            }
          >
            <DeliveryForm deliveryEmail={user.deliveryEmail} accountEmail={user.email} />
            <div className="border-line mt-5 border-t pt-4">
              <p className="mb-1 text-[13px] font-medium">Bulletins you receive</p>
              <p className="text-fg-muted mb-2 text-[12.5px]">
                Every member gets every stream that has repos.
              </p>
              {streams.length === 0 ? (
                <p className="text-fg-muted text-[13.5px]">No streams yet.</p>
              ) : (
                <ul>
                  {streams.map((s) => (
                    <li
                      key={s.id}
                      className="border-line flex items-center justify-between gap-3 border-t py-2 first:border-t-0"
                    >
                      <span>{s.name}</span>
                      {s._count.repos > 0 ? (
                        <span className="text-fg-muted text-[12.5px]">
                          {plural(s._count.repos, "repo")}
                        </span>
                      ) : (
                        <Tag kind="wait">No repos</Tag>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Block>

          <Block
            id="github"
            index={3}
            title="GitHub App"
            sub="Recommended. Briff scans the repos you pick on GitHub, on install and after every push that changes a lockfile, manifest or runtime file. It reads only those files (Contents and Metadata, read-only)."
          >
            {!github.configured ? (
              <p className="text-fg-muted text-[13.5px]">
                The GitHub App is not set up on this instance. Use a scan token below with the
                GitHub Action or the local scanner.
              </p>
            ) : (
              <>
                {github.installations.length === 0 ? (
                  <p className="text-fg-muted mb-3 text-[13.5px]">
                    No GitHub account connected yet.
                  </p>
                ) : (
                  <ul className="mb-3">
                    {github.installations.map((i) => (
                      <li
                        key={i.accountLogin}
                        className="border-line flex flex-wrap items-center justify-between gap-3 border-t py-2.5 first:border-t-0"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{i.accountLogin}</span>
                          <span className="text-fg-muted text-[12.5px]">
                            {i.accountType === "Organization" ? "organisation" : "personal account"}
                          </span>
                          {i.suspended && <Tag kind="wait">Suspended</Tag>}
                        </div>
                        <a
                          href={
                            i.accountType === "Organization"
                              ? `https://github.com/organizations/${encodeURIComponent(i.accountLogin)}/settings/installations`
                              : "https://github.com/settings/installations"
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand text-[13.5px] underline-offset-4 hover:underline"
                        >
                          Choose repos on GitHub
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <a href="/api/github/install" className={buttonVariants({ variant: "secondary" })}>
                  {github.installations.length > 0 ? "Connect another account" : "Connect GitHub"}
                </a>
              </>
            )}
          </Block>

          <Block
            id="scan-tokens"
            index={4}
            title="Scan tokens"
            sub="Scanners (the GitHub Action, briff-scan on a laptop or server) send package names, versions and runtimes with one of these tokens. Each token belongs to this org; revoke one to cut off the scanner that uses it."
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-fg-muted text-[12.5px]">
                {plural(tokens.filter((t) => !t.revokedAt).length, "active token")}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <ConnectReposButton variant="link" className="mr-2 text-[13.5px]">
                  How to connect repos
                </ConnectReposButton>
                <NewScanTokenButton />
              </div>
            </div>
            <ScanTokenList
              tokens={tokens.map((t) => ({
                id: t.id,
                name: t.name,
                prefix: t.prefix,
                created: shortDate(t.createdAt),
                lastUsed: t.lastUsedAt ? shortDateTime(t.lastUsedAt) : null,
                revoked: t.revokedAt ? shortDate(t.revokedAt) : null,
              }))}
            />
          </Block>

          <Block
            id="organisation"
            index={5}
            title="Organisation"
            sub={
              owner
                ? "Everything in Briff belongs to an organisation: repos, streams, bulletins, alerts. Switch between yours in the account menu."
                : "Everything in Briff belongs to an organisation. Only its owners can rename it."
            }
          >
            {owner ? (
              <OrgNameForm name={org.name} maxLength={ORG_NAME_MAX} />
            ) : (
              <p className="font-medium [overflow-wrap:anywhere]">{org.name}</p>
            )}
          </Block>

          <Block
            id="members"
            index={6}
            title="Members"
            sub={
              owner
                ? "Every member gets the bulletins and security alerts and can use repos, streams and alerts. Owners also invite, change roles, remove members and rename or delete the organisation."
                : "Every member gets the bulletins and security alerts. Owners invite and manage members."
            }
          >
            <MemberList
              members={members.map((m) => ({
                userId: m.userId,
                name: m.name,
                email: m.email,
                role: m.role,
                joined: shortDate(m.joinedAt),
                verified: m.verified,
              }))}
              currentUserId={ctx.userId}
              canManage={owner}
              ownerCount={ownerCount}
            />
            {owner && (
              <>
                <div className="border-line mt-2 border-t pt-4">
                  <h3 className="mb-3 text-[13px] font-medium">Invite someone</h3>
                  <InviteForm />
                </div>
                <div className="border-line mt-5 border-t pt-4">
                  <h3 className="mb-1 text-[13px] font-medium">Pending invites</h3>
                  <PendingInvites
                    invites={invites.map((i) => ({
                      id: i.id,
                      email: i.email,
                      role: i.role,
                      sent: shortDate(i.sentAt),
                      expires: shortDate(i.expiresAt),
                      expired: i.expired,
                    }))}
                  />
                </div>
                <div className="border-line mt-5 border-t pt-4">
                  <h3 className="mb-1 text-[13px] font-medium">Activity</h3>
                  {events.length === 0 ? (
                    <p className="text-fg-muted text-[13.5px]">Nothing yet.</p>
                  ) : (
                    <ol>
                      {events.map((e) => (
                        <li
                          key={e.id}
                          className="border-line flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t py-2 text-[13.5px] first:border-t-0"
                        >
                          <span className="min-w-0 [overflow-wrap:anywhere]">
                            {eventSentence(e)}
                          </span>
                          <time
                            dateTime={e.createdAt.toISOString()}
                            className="text-fg-muted shrink-0 text-[12.5px] tabular-nums"
                          >
                            {shortDateTime(e.createdAt)}
                          </time>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </>
            )}
          </Block>

          <Block
            id="your-data"
            index={7}
            title="Your data"
            sub="Take a copy of everything Briff keeps for this organisation, or delete it."
          >
            <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b pb-4">
              <div className="min-w-0 flex-1 basis-[280px]">
                <b className="font-medium">Export</b>
                <small className="text-fg-muted block text-[12.5px]">
                  One JSON file: repos, dependencies, runtimes, streams, bulletins, alerts,
                  feedback, profile. Scan token secrets are never stored, so they are not in it.
                </small>
              </div>
              <a href="/api/export" download className={buttonVariants({ variant: "secondary" })}>
                Download JSON
              </a>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
              <div className="min-w-0 flex-1 basis-[280px]">
                <b className="font-medium">Delete organisation</b>
                <small className="text-fg-muted block text-[12.5px]">
                  Removes {org.name} and everything attached to it, and your account if this is your
                  only organisation.
                </small>
              </div>
              {owner ? (
                <DeleteOrgButton orgName={org.name} />
              ) : (
                <span className="text-fg-muted text-[12.5px]">Only owners can delete it.</span>
              )}
            </div>
          </Block>

          <Block
            id="account"
            index={8}
            title="Account"
            sub="Sign-in email, password and theme. The theme switch is in the menu under your initials."
          >
            <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b pb-4">
              <div className="min-w-0">
                <p>{ctx.name || ctx.email}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <small className="text-fg-muted text-[12.5px] [overflow-wrap:anywhere]">
                    {ctx.email}
                  </small>
                  {ctx.emailVerified ? (
                    <Tag kind="ok">Verified</Tag>
                  ) : (
                    <Tag kind="upgrade">Not verified</Tag>
                  )}
                </div>
              </div>
              <SignOutButton />
            </div>
            <div className="border-line border-b py-4">
              <h3 className="mb-3 text-[13px] font-medium">Change email</h3>
              <ChangeEmailForm email={ctx.email} />
            </div>
            <div className="pt-4">
              <h3 className="mb-3 text-[13px] font-medium">Change password</h3>
              <ChangePasswordForm />
            </div>
          </Block>
        </div>
      </div>
    </AppShell>
  );
}
