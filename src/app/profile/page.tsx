import { redirect } from "next/navigation";

import { requireOrgContext } from "@/lib/auth/session";

// Old address of Settings (bookmarks, older emails).
export default async function ProfileRedirect() {
  await requireOrgContext();
  redirect("/settings");
}
