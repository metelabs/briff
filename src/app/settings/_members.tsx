"use client";

import { useActionState, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FieldHelp, Label } from "@/components/ui/label";
import { SecretBox } from "@/components/ui/secret-box";
import { Tag } from "@/components/ui/tag";
import { useResultToast, useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import type { FormState } from "./actions";
import { DEFAULT_INVITE_ROLE, type InviteRole, roleAfterInvite } from "./invite-role";
import {
  changeRoleAction,
  type InviteFormState,
  inviteMemberAction,
  leaveOrgAction,
  removeMemberAction,
  renameOrgAction,
  resendInviteAction,
  revokeInviteAction,
} from "./member-actions";

// Settings -> Organisation and Members (owners manage, members see the list and can leave).

const INITIAL: FormState = { ok: true, message: null };

const INVITE_INITIAL: InviteFormState = { ok: true, message: null };

const ROW =
  "border-line flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t py-3 first:border-t-0";

export function OrgNameForm({ name, maxLength }: { name: string; maxLength: number }) {
  const [state, action, pending] = useActionState(renameOrgAction, INITIAL);
  useResultToast(state, state);
  return (
    <form
      action={action}
      className="grid gap-4 min-[560px]:grid-cols-[minmax(0,1fr)_auto] min-[560px]:gap-x-3 min-[560px]:gap-y-1.5"
    >
      <div className="grid content-start gap-1.5">
        <Label htmlFor="org-name">Name</Label>
        <Input
          id="org-name"
          name="name"
          defaultValue={state.saved ?? name}
          maxLength={maxLength}
          required
          aria-describedby="org-name-help"
        />
      </div>
      <FieldHelp id="org-name-help" className="-mt-2.5 min-[560px]:row-start-2 min-[560px]:mt-0">
        Shown in the account menu, in invites and in the organisation&apos;s emails.
      </FieldHelp>
      <Button
        type="submit"
        variant="primary"
        disabled={pending}
        className="h-10 w-full min-[560px]:col-start-2 min-[560px]:row-start-1 min-[560px]:w-auto min-[560px]:self-end"
      >
        Rename
      </Button>
    </form>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMemberAction, INVITE_INITIAL);
  const [role, setRole] = useState<InviteRole>(DEFAULT_INVITE_ROLE);
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    setRole(roleAfterInvite(role, state));
  }
  useResultToast(state, state);
  return (
    <div className="grid gap-3">
      <form
        action={action}
        className="grid gap-4 min-[560px]:grid-cols-[minmax(0,1fr)_140px_auto] min-[560px]:gap-x-3 min-[560px]:gap-y-1.5"
      >
        <div className="grid content-start gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            placeholder="teammate@studio.dev"
            defaultValue={state.saved ?? ""}
            required
            aria-describedby="invite-help"
          />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <Select
            id="invite-role"
            name="role"
            value={role}
            onValueChange={setRole}
            options={[
              { value: "member", label: "Member" },
              { value: "owner", label: "Owner" },
            ]}
          />
        </div>
        <FieldHelp
          id="invite-help"
          className="-mt-2.5 min-[560px]:col-span-2 min-[560px]:row-start-2 min-[560px]:mt-0"
        >
          They get a link that works for 7 days. Owners can also invite, remove and rename.
        </FieldHelp>
        <Button
          type="submit"
          variant="primary"
          disabled={pending}
          className="h-10 w-full min-[560px]:col-start-3 min-[560px]:row-start-1 min-[560px]:w-auto min-[560px]:self-end"
        >
          Send invite
        </Button>
      </form>
      {state.link && <InviteLinkBox link={state.link} />}
    </div>
  );
}

function InviteLinkBox({ link }: { link: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-[13px] font-medium">Invite link</p>
      <SecretBox secret={link} />
    </div>
  );
}

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "member";
  joined: string;
  verified: boolean;
}

export function MemberList({
  members,
  currentUserId,
  canManage,
  ownerCount,
}: {
  members: MemberView[];
  currentUserId: string;
  canManage: boolean;
  ownerCount: number;
}) {
  return (
    <ul>
      {members.map((m) => {
        const self = m.userId === currentUserId;
        const lastOwner = m.role === "owner" && ownerCount <= 1;
        return (
          <li key={m.userId} className={ROW}>
            <div className="min-w-0 flex-1 basis-[240px]">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium [overflow-wrap:anywhere]">{m.name || m.email}</span>
                {self && <span className="text-fg-muted text-[12.5px]">(you)</span>}
                <Tag kind={m.role === "owner" ? "brand" : "wait"}>
                  {m.role === "owner" ? "Owner" : "Member"}
                </Tag>
                {!m.verified && <Tag kind="upgrade">Not verified</Tag>}
              </div>
              <small className="text-fg-muted block text-[12.5px] [overflow-wrap:anywhere]">
                {m.email} · joined {m.joined}
                {m.verified ? " · verified" : ""}
              </small>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {canManage && !lastOwner && <RoleButton member={m} />}
              {canManage && !self && !lastOwner && <RemoveButton member={m} />}
              {self && !lastOwner && <LeaveButton />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function useResultHandler() {
  const toast = useToast();
  return (res: FormState) => {
    if (res.message) toast(res.message, res.ok ? "ok" : "error");
  };
}

function RoleButton({ member }: { member: MemberView }) {
  const [pending, start] = useTransition();
  const show = useResultHandler();
  const next = member.role === "owner" ? "member" : "owner";
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => start(async () => show(await changeRoleAction(member.userId, next)))}
    >
      {next === "owner" ? "Make owner" : "Make member"}
    </Button>
  );
}

function RemoveButton({ member }: { member: MemberView }) {
  const [pending, start] = useTransition();
  const show = useResultHandler();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" disabled={pending}>
          Remove
        </Button>
      }
      title="Remove this member?"
      description={
        <>
          <b className="text-fg font-medium">{member.name || member.email}</b> loses access to this
          organisation and stops getting its bulletins and alerts. You can invite them again later.
        </>
      }
      confirmLabel="Remove member"
      pending={pending}
      onConfirm={() => start(async () => show(await removeMemberAction(member.userId)))}
    />
  );
}

function LeaveButton() {
  const [pending, start] = useTransition();
  const show = useResultHandler();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" disabled={pending}>
          Leave organisation
        </Button>
      }
      title="Leave this organisation?"
      description="You lose access to its repos, bulletins and alerts. An owner can invite you again. If it is your only organisation, Briff makes you a new, empty one."
      confirmLabel="Leave"
      pending={pending}
      onConfirm={() => start(async () => show(await leaveOrgAction()))}
    />
  );
}

export interface InviteView {
  id: string;
  email: string;
  role: "owner" | "member";
  sent: string;
  expires: string;
  expired: boolean;
}

export function PendingInvites({ invites }: { invites: InviteView[] }) {
  if (invites.length === 0) {
    return <p className="text-fg-muted text-[13.5px]">No pending invites.</p>;
  }
  return (
    <ul>
      {invites.map((i) => (
        <PendingInvite key={i.id} invite={i} />
      ))}
    </ul>
  );
}

function PendingInvite({ invite }: { invite: InviteView }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const show = useResultHandler();
  return (
    <li className={cn(ROW, "block")}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className={cn("min-w-0 flex-1 basis-[240px]", invite.expired && "opacity-70")}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium [overflow-wrap:anywhere]">{invite.email}</span>
            <Tag kind={invite.role === "owner" ? "brand" : "wait"}>
              {invite.role === "owner" ? "Owner" : "Member"}
            </Tag>
            {invite.expired && <Tag kind="upgrade">Expired</Tag>}
          </div>
          <small className="text-fg-muted block text-[12.5px]">
            Sent {invite.sent} · {invite.expired ? "expired" : "expires"} {invite.expires}
          </small>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await resendInviteAction(invite.id);
                setLink(res.link ?? null);
                show(res);
              })
            }
          >
            Resend
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" disabled={pending}>
                Revoke
              </Button>
            }
            title="Revoke this invite?"
            description={
              <>
                The link sent to <b className="text-fg font-medium">{invite.email}</b> stops
                working. You can invite the address again later.
              </>
            }
            confirmLabel="Revoke invite"
            pending={pending}
            onConfirm={() => start(async () => show(await revokeInviteAction(invite.id)))}
          />
        </div>
      </div>
      {link && (
        <div className="mt-3">
          <InviteLinkBox link={link} />
        </div>
      )}
    </li>
  );
}
