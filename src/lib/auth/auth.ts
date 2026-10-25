import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { createOrgForUser } from "@/lib/org";

function createAuth() {
  const env = getEnv();
  const db = getDb();

  return betterAuth({
    appName: "Briff",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(db, { provider: "postgresql" }),
    emailAndPassword: { enabled: true, minPasswordLength: 12, autoSignIn: true },
    databaseHooks: {
      user: {
        create: {
          // Multi-user schema, single-user operations: the first account bootstraps
          // the instance; further sign-ups need ALLOW_SIGNUP=true.
          before: async (user) => {
            if (!getEnv().ALLOW_SIGNUP && (await db.user.count()) > 0) {
              throw new APIError("FORBIDDEN", { message: "Sign-up is disabled." });
            }
            return { data: user };
          },
          after: async (user) => {
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
