"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { signOutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { FormCallout } from "@/components/ui/callout";
import { ConfirmDialog, DialogClose, FormDialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { FieldHelp, FormStatus, Label } from "@/components/ui/label";
import { SecretBox } from "@/components/ui/secret-box";
import { Tag } from "@/components/ui/tag";
import { useToast } from "@/components/ui/toast";
import { SCAN_TOKEN_NAME_MAX } from "@/lib/scan/tokens";
import {
  activeSectionId,
  atPageBottom,
  SCROLL_GAP,
  scrollToElement,
  stickyOffset,
} from "@/lib/scroll";
import { cn } from "@/lib/utils";

import {
  changeEmailAction,
  changePasswordAction,
  createScanTokenAction,
  deleteOrgAction,
  type FormState,
  revokeScanTokenAction,
  saveDeliveryAction,
  saveProfileTextAction,
  type ScanTokenFormState,
} from "./actions";

const INITIAL: FormState = { ok: true, message: null };

export function ProfileTextForm({ text }: { text: string }) {
  const [state, action, pending] = useActionState(saveProfileTextAction, INITIAL);
  return (
    <form action={action} className="grid gap-1.5">
      <Label htmlFor="text">About your work</Label>
      <Textarea
        id="text"
        name="text"
        defaultValue={state.saved ?? text}
        rows={5}
        maxLength={2000}
        placeholder="Example: Freelancer, mostly Laravel and Vue for clients; PHP upgrades matter, frontend betas don't."
      />
      <FieldHelp>
        Used as context for your bulletin, never shared. At most 2000 characters.
      </FieldHelp>
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          Save profile
        </Button>
        <FormStatus ok={state.ok} message={state.message} />
      </div>
    </form>
  );
}

export function DeliveryForm({
  deliveryEmail,
  accountEmail,
}: {
  deliveryEmail: string | null;
  accountEmail: string;
}) {
  const [state, action, pending] = useActionState(saveDeliveryAction, INITIAL);
  return (
    <form action={action} className="grid gap-4 min-[560px]:grid-cols-2">
      <div className="grid content-start gap-1.5">
        <Label htmlFor="accountEmail">Account email</Label>
        <Input
          id="accountEmail"
          value={accountEmail}
          readOnly
          className="bg-surface-2 text-fg-muted focus:shadow-none"
        />
        <FieldHelp>You sign in with this address.</FieldHelp>
      </div>
      <div className="grid content-start gap-1.5">
        <Label htmlFor="deliveryEmail">Send to</Label>
        <Input
          id="deliveryEmail"
          name="deliveryEmail"
          type="email"
          defaultValue={state.saved ?? deliveryEmail ?? ""}
          placeholder={accountEmail}
        />
        <FieldHelp>Empty means the account email.</FieldHelp>
      </div>
      <div className="flex flex-wrap items-center gap-3 min-[560px]:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          Save delivery address
        </Button>
        <FormStatus ok={state.ok} message={state.message} />
      </div>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, INITIAL);
  return (
    // From 560px: both fields and the button on one row, the button bottom-aligned with the
    // inputs; the help line goes under the fields. Below: one column, full-width button last.
    <form
      action={action}
      className="grid gap-4 min-[560px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] min-[560px]:gap-x-3 min-[560px]:gap-y-1.5"
    >
      <div className="grid content-start gap-1.5">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="grid content-start gap-1.5">
        <Label htmlFor="newPassword">New password</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          aria-describedby="newPasswordHelp"
        />
      </div>
      <FieldHelp
        id="newPasswordHelp"
        className="-mt-2.5 min-[560px]:col-span-2 min-[560px]:row-start-2 min-[560px]:mt-0"
      >
        At least 12 characters. Other devices are signed out.
      </FieldHelp>
      <Button
        type="submit"
        variant="primary"
        disabled={pending}
        className="h-10 w-full min-[560px]:col-start-3 min-[560px]:row-start-1 min-[560px]:w-auto min-[560px]:self-end"
      >
        Change password
      </Button>
      <FormCallout
        ok={state.ok}
        message={state.message}
        className="min-[560px]:col-span-3 min-[560px]:mt-2.5"
      />
    </form>
  );
}

export function ChangeEmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changeEmailAction, INITIAL);
  // Same row layout as ChangePasswordForm.
  return (
    <form
      action={action}
      className="grid gap-4 min-[560px]:grid-cols-[minmax(0,1fr)_auto] min-[560px]:gap-x-3 min-[560px]:gap-y-1.5"
    >
      <div className="grid content-start gap-1.5">
        <Label htmlFor="newEmail">New account email</Label>
        <Input
          id="newEmail"
          name="newEmail"
          type="email"
          autoComplete="email"
          defaultValue={state.saved ?? ""}
          placeholder={email}
          required
          aria-describedby="newEmailHelp"
        />
      </div>
      <FieldHelp id="newEmailHelp" className="-mt-2.5 min-[560px]:row-start-2 min-[560px]:mt-0">
        We send a link to the new address; the change happens once you open it.
      </FieldHelp>
      <Button
        type="submit"
        variant="primary"
        disabled={pending}
        className="h-10 w-full min-[560px]:col-start-2 min-[560px]:row-start-1 min-[560px]:w-auto min-[560px]:self-end"
      >
        Change email
      </Button>
      <FormCallout
        ok={state.ok}
        message={state.message}
        className="min-[560px]:col-span-2 min-[560px]:mt-2.5"
      />
    </form>
  );
}

export function SignOutButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await signOutAction();
        })
      }
    >
      Sign out
    </Button>
  );
}

/** Section index: sticky column on desktop, a scrolling pill row on mobile; follows scroll. */
export function SectionIndex({ sections }: { sections: { id: string; label: string }[] }) {
  const [current, setCurrent] = useState(sections[0]?.id ?? "");
  // While a click's smooth scroll runs, the clicked section stays current.
  const scrolling = useRef(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (scrolling.current) return;
      const root = document.documentElement;
      const tops = sections.flatMap((s) => {
        const el = document.getElementById(s.id);
        return el ? [{ id: s.id, top: el.getBoundingClientRect().top }] : [];
      });
      const id = activeSectionId(
        tops,
        stickyOffset() + SCROLL_GAP + 24,
        atPageBottom(window.scrollY, window.innerHeight, root.scrollHeight)
      );
      if (id) setCurrent(id);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections]);
  return (
    <nav
      aria-label="Settings sections"
      className="no-scrollbar flex gap-0.5 overflow-x-auto md:sticky md:top-[84px] md:grid"
    >
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={current === s.id ? "true" : undefined}
          onClick={(e) => {
            const el = document.getElementById(s.id);
            if (!el) return;
            e.preventDefault();
            setCurrent(s.id);
            window.history.replaceState(null, "", `#${s.id}`);
            scrolling.current = true;
            void scrollToElement(el).then(() => {
              scrolling.current = false;
            });
          }}
          className={cn(
            "text-fg-muted hover:bg-surface hover:text-fg rounded-[9px] px-3 py-2 font-medium whitespace-nowrap transition-colors duration-150",
            "aria-[current=true]:bg-surface aria-[current=true]:text-fg aria-[current=true]:shadow-[inset_2px_0_0_var(--brand)]"
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

export interface ScanTokenRow {
  id: string;
  name: string;
  prefix: string;
  created: string;
  lastUsed: string | null;
  revoked: string | null;
}

export function ScanTokenList({ tokens }: { tokens: ScanTokenRow[] }) {
  if (tokens.length === 0) {
    return (
      <p className="text-fg-muted text-[13.5px]">
        No tokens yet. Create one for each scanner: a GitHub Action, a laptop, a server.
      </p>
    );
  }
  return (
    <ul>
      {tokens.map((t) => (
        <li
          key={t.id}
          className="border-line flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t py-2.5 first:border-t-0"
        >
          <div className={cn("min-w-0", t.revoked && "opacity-70")}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium break-all">{t.name}</span>
              <code className="text-fg-muted font-mono text-[12.5px]">{t.prefix}…</code>
              {t.revoked && <Tag kind="wait">Revoked</Tag>}
            </div>
            <small className="text-fg-muted block text-[12.5px]">
              Created {t.created} · {t.lastUsed ? `last used ${t.lastUsed}` : "never used"}
              {t.revoked && ` · revoked ${t.revoked}`}
            </small>
          </div>
          {!t.revoked && <RevokeScanTokenButton token={t} />}
        </li>
      ))}
    </ul>
  );
}

function RevokeScanTokenButton({ token }: { token: ScanTokenRow }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" disabled={pending}>
          Revoke
        </Button>
      }
      title="Revoke this token?"
      description={
        <>
          Scanners that send <b className="font-medium">{token.name}</b> ({token.prefix}…) get HTTP
          401 from now on. This cannot be undone; create a new token to reconnect them.
        </>
      }
      confirmLabel="Revoke token"
      pending={pending}
      onConfirm={() =>
        start(async () => {
          const res = await revokeScanTokenAction(token.id);
          toast(res.ok ? "Token revoked" : "Token was already revoked", res.ok ? "ok" : "info");
        })
      }
    />
  );
}

const TOKEN_INITIAL: ScanTokenFormState = { ok: true, message: null };

export function NewScanTokenButton() {
  const [open, setOpen] = useState(false);
  // A new key per opening, so the dialog never shows the previous secret again.
  const [round, setRound] = useState(0);
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (next) setRound((r) => r + 1);
        setOpen(next);
      }}
      trigger={<Button variant="secondary">New token</Button>}
      title="New scan token"
      description="A scanner sends this token with every upload. Name it after where it runs."
    >
      <NewScanTokenForm key={round} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

function NewScanTokenForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState(createScanTokenAction, TOKEN_INITIAL);
  if (state.secret) {
    return (
      <div className="grid gap-3">
        <p className="text-[13.5px]">
          <b className="font-medium">{state.name}</b> is ready. Put it into the scanner&apos;s{" "}
          <code className="font-mono text-[12.5px]">BRIFF_TOKEN</code>.
        </p>
        <SecretBox secret={state.secret} />
        <div className="flex justify-end">
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-1.5">
      <Label htmlFor="scan-token-name">Name</Label>
      <Input
        id="scan-token-name"
        name="name"
        placeholder="e.g. GitHub Action, laptop"
        maxLength={SCAN_TOKEN_NAME_MAX}
        defaultValue={state.saved ?? ""}
        required
        autoFocus
      />
      <FieldHelp>Only you see the name; it tells tokens apart in this list.</FieldHelp>
      <FormStatus ok={state.ok} message={state.message} />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <DialogClose render={<Button variant="secondary">Cancel</Button>} />
        <Button type="submit" variant="primary" disabled={pending}>
          Create token
        </Button>
      </div>
    </form>
  );
}

export function DeleteOrgButton({ orgName }: { orgName: string }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (next) setRound((r) => r + 1);
        setOpen(next);
      }}
      trigger={<Button variant="danger">Delete organisation</Button>}
      title="Delete this organisation?"
      description={
        <>
          Repos, dependencies, streams, bulletins, alerts, feedback, the profile and scan tokens of{" "}
          <b className="text-fg font-medium">{orgName}</b> are deleted now. If you belong to no
          other organisation, your account goes too and you are signed out. This cannot be undone;
          export your data first if you want a copy.
        </>
      }
    >
      <DeleteOrgForm key={round} orgName={orgName} />
    </FormDialog>
  );
}

function DeleteOrgForm({ orgName }: { orgName: string }) {
  const [state, action, pending] = useActionState(deleteOrgAction, INITIAL);
  const [typed, setTyped] = useState(state.saved ?? "");
  const matches = typed.trim() === orgName.trim();
  return (
    <form action={action} className="grid gap-1.5">
      <Label htmlFor="confirm-org-name">
        Type <span className="font-mono text-[12.5px]">{orgName}</span> to confirm
      </Label>
      <Input
        id="confirm-org-name"
        name="confirmName"
        autoComplete="off"
        spellCheck={false}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        required
        autoFocus
      />
      <FormStatus ok={state.ok} message={state.message} />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <DialogClose render={<Button variant="secondary">Cancel</Button>} />
        <Button type="submit" variant="danger-solid" disabled={pending || !matches}>
          Delete organisation
        </Button>
      </div>
    </form>
  );
}
