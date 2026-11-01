"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useReducer, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogClose, FormDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormStatus, Label } from "@/components/ui/label";
import { SearchField } from "@/components/ui/search-field";
import { useToast } from "@/components/ui/toast";
import { initialSearch, searchSync, withSearch } from "@/lib/search-sync";

import {
  type AdminState,
  type LimitsState,
  raiseOrgLimitsAction,
  runJobAction,
  sendTestEmailAction,
} from "./actions";

const INITIAL: AdminState = { ok: true, message: null };

function Status({ state }: { state: AdminState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={state.ok ? "text-fg-muted text-[12.5px]" : "text-upgrade text-[12.5px]"}
    >
      {state.message}
    </p>
  );
}

export function JobButton({ type, label }: { type: string; label: string }) {
  const [state, action, pending] = useActionState(runJobAction, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="type" value={type} />
      <Button type="submit" variant="secondary" disabled={pending} className="w-full justify-start">
        {label}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function TestEmailButton() {
  const [state, action, pending] = useActionState(sendTestEmailAction, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-1">
      <Button type="submit" variant="secondary" disabled={pending} className="w-full justify-start">
        Send test email
      </Button>
      <Status state={state} />
    </form>
  );
}

export function EditLimitsButton({
  org,
}: {
  org: { id: string; name: string; repoLimit: number; streamLimit: number };
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: LimitsState, form: FormData) => {
      const res = await raiseOrgLimitsAction(prev, form);
      if (res.ok) {
        setOpen(false);
        if (res.message) toast(res.message);
      }
      return res;
    },
    { ok: true, message: null }
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="secondary" size="sm" aria-label={`Edit limits of ${org.name}`}>
          Edit limits
        </Button>
      }
      title="Edit limits"
      description={`${org.name}: limits can only be raised. Repositories past the old limit need a rescan.`}
    >
      <form action={action} className="grid gap-3">
        <input type="hidden" name="orgId" value={org.id} />
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`repo-limit-${org.id}`}>Repositories</Label>
            <Input
              id={`repo-limit-${org.id}`}
              type="number"
              name="repoLimit"
              min={org.repoLimit}
              defaultValue={state.repoLimit ?? org.repoLimit}
              required
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`stream-limit-${org.id}`}>Streams</Label>
            <Input
              id={`stream-limit-${org.id}`}
              type="number"
              name="streamLimit"
              min={org.streamLimit}
              defaultValue={state.streamLimit ?? org.streamLimit}
              required
            />
          </div>
        </div>
        {!state.ok && <FormStatus ok={false} message={state.message} />}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button type="submit" variant="primary" disabled={pending}>
            Save limits
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

/** Name/email search for the organisation table; the query lives in the URL (`?q=`). */
export function OrgSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(searchSync, initial, initialSearch);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => dispatch({ type: "url", q: initial }), [initial]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onChange = (value: string) => {
    dispatch({ type: "edit", value });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const q = value.trim();
      dispatch({ type: "navigate", q });
      const { pathname, search } = window.location;
      router.replace(withSearch(pathname, search, q), { scroll: false });
    }, 300);
  };
  return (
    <SearchField
      value={state.value}
      onChange={onChange}
      placeholder="Search name or owner email"
      label="Search organisations"
    />
  );
}
