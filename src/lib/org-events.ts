import type { OrgEventType } from "@/generated/prisma/enums";
import { isPlanId, PLANS } from "@/lib/plans";

// One sentence per audit event (Settings -> Members, "Activity").

export interface OrgEventFacts {
  type: OrgEventType;
  actor: string | null;
  targetEmail: string | null;
  detail: string | null;
}

function article(role: string | null): string {
  return role === "owner" ? "an owner" : "a member";
}

export function eventSentence(event: OrgEventFacts): string {
  const actor = event.actor ?? "A deleted account";
  const target = event.targetEmail ?? "a former member";
  switch (event.type) {
    case "member_invited":
      return event.detail === "resent"
        ? `${actor} sent a new invite link to ${target}`
        : `${actor} invited ${target} as ${article(event.detail)}`;
    case "invite_accepted":
      return `${target} joined as ${article(event.detail)}`;
    case "invite_revoked":
      return `${actor} revoked the invite for ${target}`;
    case "member_removed":
      return event.detail === "left" ? `${target} left` : `${actor} removed ${target}`;
    case "role_changed":
      return `${actor} made ${target} ${article(event.detail)}`;
    case "org_renamed":
      return `${actor} renamed the organisation (${event.detail ?? ""})`;
    case "org_created":
      return `${actor} created the organisation`;
    case "plan_changed":
      return planSentence(event.detail);
    case "delivery_target_created":
      return `${actor} added ${targetLabel(event.detail)}`;
    case "delivery_target_enabled":
      return `${actor} turned on ${targetLabel(event.detail)}`;
    case "delivery_target_disabled":
      return `${actor} turned off ${targetLabel(event.detail)}`;
    case "delivery_target_deleted":
      return `${actor} removed ${targetLabel(event.detail)}`;
    case "audit_exported":
      return `${actor} exported the audit log`;
  }
}

/** The stored names of the event types (`@map` in the schema), used by the CSV export. */
export const EVENT_TYPE_NAMES: Readonly<Record<OrgEventType, string>> = {
  member_invited: "member.invited",
  invite_accepted: "invite.accepted",
  invite_revoked: "invite.revoked",
  member_removed: "member.removed",
  role_changed: "role.changed",
  org_renamed: "org.renamed",
  org_created: "org.created",
  plan_changed: "plan.changed",
  delivery_target_created: "delivery_target.created",
  delivery_target_enabled: "delivery_target.enabled",
  delivery_target_disabled: "delivery_target.disabled",
  delivery_target_deleted: "delivery_target.deleted",
  audit_exported: "audit.exported",
};

/** `delivery_target.*` detail: "<kind>:<masked url>", e.g. "slack:hooks.slack.com …a1B2". */
export function deliveryTargetDetail(kind: "slack" | "webhook", maskedUrl: string): string {
  return `${kind}:${maskedUrl}`;
}

function targetLabel(detail: string | null): string {
  const [kind, ...rest] = (detail ?? "").split(":");
  const where = rest.join(":");
  const name = kind === "slack" ? "a Slack webhook" : "a webhook";
  return where ? `${name} (${where})` : name;
}

/** `plan.changed` detail: "<source>:<from>:<to>", source paddle (billing) or admin. */
export function planChangeDetail(source: "paddle" | "admin", from: string, to: string): string {
  return `${source}:${from}:${to}`;
}

function planSentence(detail: string | null): string {
  const [source, from, to] = (detail ?? "").split(":");
  const name = (id: string | undefined) => (isPlanId(id) ? PLANS[id].name : "another plan");
  const who = source === "admin" ? "The instance admin" : "Billing";
  return `${who} changed the plan from ${name(from)} to ${name(to)}`;
}
