"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getAuth } from "@/lib/auth/auth";
import { log } from "@/lib/log";

export interface AuthFormState {
  error: string | null;
}

const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const signUpSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email(),
  password: z.string().min(12, "Password must be at least 12 characters."),
});

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong.";
}

export async function signInAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter your email and password." };
  try {
    await getAuth().api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (err) {
    log.warn({ err }, "auth: sign-in failed");
    return { error: "Invalid email or password." };
  }
  redirect("/");
}

export async function signUpAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  try {
    await getAuth().api.signUpEmail({ body: parsed.data, headers: await headers() });
  } catch (err) {
    log.warn({ err }, "auth: sign-up failed");
    return { error: messageOf(err) };
  }
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}
