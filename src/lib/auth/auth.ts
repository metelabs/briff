import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { acceptInvite } from "@/lib/members";
import { createOrgForUser } from "@/lib/org";
import { sendPasswordResetEmail, sendVerificationEmailTo } from "./auth-email";
import { inviteSignupFor } from "./invite-signup";
import { authAttemptAllowed, authRateLimitRules, isLimitedAuthPath } from "./signup-limit";

/** Where Better Auth sends the browser after an email link; relative to BETTER_AUTH_URL. */
export const RESET_PASSWORD_PATH = "/reset-password";
export const VERIFIED_CALLBACK = "/settings?verified=1";

function createAuth() {
  const env = getEnv();
  const db = getDb();

  return betterAuth({
    appName: "Briff",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(db, { provider: "postgresql" }),
    rateLimit: {
      enabled: true,
      storage: "memory",
      customRules: authRateLimitRules(),
    },
    advanced: { ipAddress: { ipAddressHeaders: ["x-real-ip"] } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!isLimitedAuthPath(ctx.path)) return;
        if (!authAttemptAllowed(ctx.path, ctx.headers?.get("x-real-ip"))) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message:
              ctx.path === "/sign-up/email"
                ? "Too many sign-up attempts. Try again in one hour."
                : "Too many attempts. Try again in one hour.",
          });
        }
      }),
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      autoSignIn: true,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      // Not awaited: a send that takes as long as SMTP would tell apart existing accounts.
      sendResetPassword: async ({ user, url }) => {
        void sendPasswordResetEmail(user, url).catch((err: unknown) =>
          log.error({ err, userId: user.id }, "auth: reset email failed")
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 3600,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmailTo(db, user, url);
      },
    },
    user: { changeEmail: { enabled: true } },
    databaseHooks: {
      user: {
        create: {
          // The first account can always bootstrap a closed instance, and an invite is
          // always a way in.
          before: async (user) => {
            if (inviteSignupFor(user.email)) return { data: user };
            if (!getEnv().ALLOW_SIGNUP && (await db.user.count()) > 0) {
              throw new APIError("FORBIDDEN", { message: "Sign-up is disabled." });
            }
            return { data: user };
          },
          after: async (user) => {
            const invite = inviteSignupFor(user.email);
            if (invite) {
              const joined = await acceptInvite(db, { token: invite.token, userId: user.id });
              if (joined.ok) {
                log.info(
                  { userId: user.id, orgId: joined.orgId },
                  "auth: new user joined by invite"
                );
                return;
              }
              // Revoked or used between the page and the sign-up: the account still needs an org.
              log.warn(
                { userId: user.id, reason: joined.reason },
                "auth: invite sign-up not joined"
              );
            }
            await createOrgForUser(db, { name: user.name || user.email, userId: user.id });
            log.info({ userId: user.id }, "auth: created org for new user");
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;

let instance: Auth | null = null;

// Lazy so `next build` can import route modules without runtime secrets.
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
