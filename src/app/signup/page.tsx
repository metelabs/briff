import type { Metadata } from "next";

import { AuthPage } from "@/app/login/auth-page";

export const metadata: Metadata = { title: "Create an account · Briff" };

export default function SignupPage() {
  return <AuthPage route="signup" />;
}
