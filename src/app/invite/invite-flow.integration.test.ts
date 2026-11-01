import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { MailMessage } from "@/lib/email/mailer";

// The invite flow through its Server Actions, against Postgres: the owner's invite email, a
// sign-up from its link on a closed instance, sign-in with an invite, role checks in the
// actions, and the org cookie only ever choosing one of the user's own orgs.

const state = vi.hoisted(() => ({
  ip: "192.0.2.80",
  jar: new Map<string, string>(),
  session: null as null | {
    user: { id: string; email: string; name: string; emailVerified: boolean };
  },
  sent: [] as MailMessage[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": state.ip }),
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) ?? "" } : undefined,
    getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void state.jar.set(name, value),
    delete: (name: string) => void state.jar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => ({ host: "smtp", port: 587, user: "u", pass: "p", from: "b@example.com" }),
  sendMail: async (message: MailMessage) => {
    state.sent.push(message);
    return { status: "sent", messageId: "test" };
  },
}));
// Better Auth's own cookie plumbing needs a Next request; the test decides who is signed in.
vi.mock("@/lib/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/auth")>();
  return {
    ...actual,
    getAuth: () => {
      const auth = actual.getAuth();
      return { ...auth, api: { ...auth.api, getSession: async () => state.session } };
    },
  };
});

const url = process.env.TEST_DATABASE_URL;
const PASSWORD = "a-long-enough-password";

describe.skipIf(!url)("invite flow through the Server Actions", () => {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const emails: string[] = [];
  let mod: {
    db: typeof import("@/lib/db/client");
    env: typeof import("@/lib/env");
    login: typeof import("@/app/login/actions");
    members: typeof import("@/app/settings/member-actions");
    shell: typeof import("@/components/shell/actions");
    invite: typeof import("./[token]/actions");
    session: typeof import("@/lib/auth/session");
  };
  let ipCounter = 0;

  const db = () => mod.db.getDb();
  const email = (tag: string) => {
    const e = `flow-${tag}-${suffix}@example.com`;
    emails.push(e);
    return e;
  };
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  async function signInAs(address: string) {
    const u = await db().user.findUniqueOrThrow({ where: { email: address } });
    state.session = {
      user: { id: u.id, email: u.email, name: u.name, emailVerified: u.emailVerified },
    };
    return u.id;
  }
  function signOut() {
    state.session = null;
    state.jar.clear();
  }
  async function redirectOf(run: Promise<unknown>): Promise<string> {
    const err = await run.then(
      () => null,
      (e: unknown) => e
    );
    if (!(err instanceof Error) || !err.message.startsWith("redirect:")) {
      throw new Error(`expected a redirect, got ${String(err)}`);
    }
    return err.message.slice("redirect:".length);
  }
  async function signUp(address: string, extra: Record<string, string> = {}) {
    state.ip = `192.0.2.${100 + ipCounter++}`;
    return mod.login.signUpAction(
      { error: null },
      form({ name: `Flow ${address}`, email: address, password: PASSWORD, ...extra })
    );
  }
  function linkIn(message: MailMessage | undefined): string {
    const match = message?.text.match(/https:\/\/\S+\/invite\/([A-Za-z0-9_-]{43})/);
    if (!match?.[1]) throw new Error("no invite link in email");
    return match[1];
  }
  async function ownerInvite(to: string, role = "member"): Promise<string> {
    const before = state.sent.length;
    const res = await mod.members.inviteMemberAction(
      { ok: true, message: null },
      form({ email: to, role })
    );
    expect(res).toMatchObject({ ok: true, message: `Invite sent to ${to}.` });
    expect(state.sent).toHaveLength(before + 1);
    expect(state.sent.at(-1)?.to).toBe(to);
    return linkIn(state.sent.at(-1));
  }

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", url ?? "");
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-secret-of-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.com");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ALLOW_SIGNUP", "true");
    mod = {
      db: await import("@/lib/db/client"),
      env: await import("@/lib/env"),
      login: await import("@/app/login/actions"),
      members: await import("@/app/settings/member-actions"),
      shell: await import("@/components/shell/actions"),
      invite: await import("./[token]/actions"),
      session: await import("@/lib/auth/session"),
    };
    mod.env.resetEnvCache();
  });

  beforeEach(() => signOut());

  afterAll(async () => {
    const users = await db().user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await db().org.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
    await db().user.deleteMany({ where: { id: { in: ids } } });
    await db().$disconnect();
    vi.unstubAllEnvs();
    mod.env.resetEnvCache();
  });

  it("lets an invited address in on a closed instance and joins it to the org", async () => {
    const owner = email("owner");
    expect(await redirectOf(signUp(owner))).toBe("/");
    vi.stubEnv("ALLOW_SIGNUP", "false");
    mod.env.resetEnvCache();

    const ownerId = await signInAs(owner);
    const orgId = (await mod.session.getOrgContext())?.orgId ?? "";
    expect(orgId).not.toBe("");
    const invited = email("newbie");
    const token = await ownerInvite(invited);
    expect(state.sent.at(-1)?.subject).toBe(`Flow ${owner} invited you to Flow ${owner} on Briff`);

    signOut();
    // Without an invite the instance stays closed.
    expect(await signUp(email("stranger"))).toEqual({ error: "Sign-up is disabled." });
    // The invite decides the address, whatever the form says.
    expect(await redirectOf(signUp(email("tampered"), { invite: token }))).toBe("/?joined=1");
    expect(await db().user.count({ where: { email: `flow-tampered-${suffix}@example.com` } })).toBe(
      0
    );
    const newbie = await db().user.findUniqueOrThrow({
      where: { email: invited },
      select: { id: true, memberships: { select: { orgId: true, role: true } } },
    });
    // No org of its own: the invite's org is its only one.
    expect(newbie.memberships).toEqual([{ orgId, role: "member" }]);
    expect(state.jar.get(mod.session.ORG_COOKIE)).toBe(orgId);

    await signInAs(invited);
    expect(await mod.session.getOrgContext()).toMatchObject({ orgId, role: "member" });

    // A used link cannot sign up a second account.
    signOut();
    expect(await signUp(email("again"), { invite: token })).toEqual({
      error: "This invite is no longer valid. Ask for a new one.",
    });

    // Members cannot manage the org through the actions.
    await signInAs(invited);
    expect(
      await mod.members.inviteMemberAction(
        { ok: true, message: null },
        form({ email: email("x"), role: "owner" })
      )
    ).toMatchObject({ ok: false, message: "Only an owner can do that." });
    expect(
      await mod.members.renameOrgAction({ ok: true, message: null }, form({ name: "Mine now" }))
    ).toMatchObject({ ok: false, message: "Only an owner can do that." });
    expect(await mod.members.removeMemberAction(ownerId)).toMatchObject({ ok: false });
    expect(await mod.members.changeRoleAction(newbie.id, "owner")).toMatchObject({ ok: false });
    expect(
      await db().orgMember.findFirstOrThrow({ where: { orgId, userId: newbie.id } })
    ).toMatchObject({ role: "member" });
    expect((await db().org.findUniqueOrThrow({ where: { id: orgId } })).name).toBe(`Flow ${owner}`);
  }, 60000);

  it("joins an existing account by sign-in, and refuses another account's sign-in", async () => {
    vi.stubEnv("ALLOW_SIGNUP", "true");
    mod.env.resetEnvCache();
    const owner = email("owner2");
    const member = email("member2");
    const other = email("other2");
    for (const address of [owner, member, other]) {
      expect(await redirectOf(signUp(address))).toBe("/");
    }
    const password = PASSWORD;

    await signInAs(owner);
    const orgId = (await mod.session.getOrgContext())?.orgId ?? "";
    const token = await ownerInvite(member);

    signOut();
    state.ip = "192.0.2.90";
    expect(
      await redirectOf(
        mod.login.signInAction({ error: null }, form({ email: other, password, invite: token }))
      )
    ).toBe(`/invite/${token}`);
    const otherId = (await db().user.findUniqueOrThrow({ where: { email: other } })).id;
    expect(await db().orgMember.count({ where: { orgId, userId: otherId } })).toBe(0);

    signOut();
    expect(
      await redirectOf(
        mod.login.signInAction({ error: null }, form({ email: member, password, invite: token }))
      )
    ).toBe("/?joined=1");
    const memberId = (await db().user.findUniqueOrThrow({ where: { email: member } })).id;
    expect(await db().orgMember.findFirst({ where: { orgId, userId: memberId } })).toMatchObject({
      role: "member",
    });
    expect(state.jar.get(mod.session.ORG_COOKIE)).toBe(orgId);
  }, 60000);

  it("switches only between the user's own orgs", async () => {
    vi.stubEnv("ALLOW_SIGNUP", "true");
    mod.env.resetEnvCache();
    const ada = email("ada3");
    const zed = email("zed3");
    expect(await redirectOf(signUp(ada))).toBe("/");
    expect(await redirectOf(signUp(zed))).toBe("/");

    await signInAs(zed);
    const zedOrg = (await mod.session.getOrgContext())?.orgId ?? "";
    signOut();

    const adaId = await signInAs(ada);
    const first = (await mod.session.getOrgContext())?.orgId ?? "";
    expect(
      await redirectOf(
        mod.shell.createOrgAction({ ok: true, message: null }, form({ name: `Second ${suffix}` }))
      )
    ).toBe("/");
    const second = state.jar.get(mod.session.ORG_COOKIE) ?? "";
    expect(second).not.toBe(first);
    expect(await mod.session.getOrgContext()).toMatchObject({ orgId: second, role: "owner" });
    expect((await mod.session.listUserOrgs(adaId)).map((o) => o.id)).toEqual([first, second]);
    const created = await db().orgEvent.findFirstOrThrow({ where: { orgId: second } });
    expect(created).toMatchObject({ type: "org_created", actorUserId: adaId });

    expect(await redirectOf(mod.shell.switchOrgAction(first))).toBe("/");
    expect((await mod.session.getOrgContext())?.orgId).toBe(first);

    // Another user's org: the action refuses, and a forged cookie falls back to her own.
    expect(await mod.shell.switchOrgAction(zedOrg)).toEqual({ ok: false });
    expect(state.jar.get(mod.session.ORG_COOKIE)).toBe(first);
    state.jar.set(mod.session.ORG_COOKIE, zedOrg);
    expect((await mod.session.getOrgContext())?.orgId).toBe(first);
    // Settings actions then act on her org only; Zed's members are out of reach.
    const zedId = (await db().user.findUniqueOrThrow({ where: { email: zed } })).id;
    expect(await mod.members.removeMemberAction(zedId)).toMatchObject({ ok: false });
    expect(await db().orgMember.count({ where: { orgId: zedOrg, userId: zedId } })).toBe(1);
    expect(
      await mod.members.renameOrgAction({ ok: true, message: null }, form({ name: `R ${suffix}` }))
    ).toMatchObject({ ok: true });
    expect((await db().org.findUniqueOrThrow({ where: { id: first } })).name).toBe(`R ${suffix}`);
    expect((await db().org.findUniqueOrThrow({ where: { id: zedOrg } })).name).toBe(`Flow ${zed}`);
  }, 60000);

  it("joins a signed-in account from the invite page and leaves again", async () => {
    vi.stubEnv("ALLOW_SIGNUP", "true");
    mod.env.resetEnvCache();
    const owner = email("owner4");
    const guest = email("guest4");
    expect(await redirectOf(signUp(owner))).toBe("/");
    expect(await redirectOf(signUp(guest))).toBe("/");
    await signInAs(owner);
    const orgId = (await mod.session.getOrgContext())?.orgId ?? "";
    const token = await ownerInvite(guest);

    signOut();
    await signInAs(owner);
    // Already a member: back to the page, which says so.
    expect(
      await redirectOf(mod.invite.joinInviteAction({ ok: true, message: null }, form({ token })))
    ).toBe(`/invite/${token}`);

    signOut();
    const guestId = await signInAs(guest);
    expect(
      await redirectOf(mod.invite.joinInviteAction({ ok: true, message: null }, form({ token })))
    ).toBe("/?joined=1");
    expect(await mod.session.getOrgContext()).toMatchObject({ orgId, role: "member" });

    expect(await redirectOf(mod.members.leaveOrgAction())).toBe("/?left=1");
    expect(state.jar.has(mod.session.ORG_COOKIE)).toBe(false);
    expect(await db().orgMember.count({ where: { orgId, userId: guestId } })).toBe(0);
    // Still in the org made at sign-up.
    expect(await db().orgMember.count({ where: { userId: guestId } })).toBe(1);
  }, 60000);
});
