"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useReducer, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogClose, FormDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FieldHelp, FormStatus, Label } from "@/components/ui/label";
import { SearchField } from "@/components/ui/search-field";
import { useToast } from "@/components/ui/toast";
import { limitLabel, PLAN_ALLOWANCES, PLAN_IDS, PLANS, type PlanId } from "@/lib/plans";
import { formatUsd } from "@/llm/pricing";
import { initialSearch, searchSync, withSearch } from "@/lib/search-sync";

import {
  type AdminState,
  type LimitsState,
  runJobAction,
  saveOrgPlanAction,
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

function planSummary(plan: PlanId): string {
  const p = PLANS[plan];
  return `${p.name} · ${limitLabel(p.repos, "repo")}, ${limitLabel(p.streams, "stream")}, ${limitLabel(p.members, "member")}`;
}

export function EditLimitsButton({
  org,
}: {
  org: {
    id: string;
    name: string;
    plan: PlanId;
    repoOverride: number | null;
    streamOverride: number | null;
    llmBudgetOverride: number | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: LimitsState, form: FormData) => {
      const res = await saveOrgPlanAction(prev, form);
      if (res.ok) {
        setOpen(false);
        if (res.message) toast(res.message);
      }
      return res;
    },
    { ok: true, message: null }
  );
  const current = state.saved ?? {
    plan: org.plan,
    repoLimit: org.repoOverride,
    streamLimit: org.streamOverride,
    llmBudgetUsd: org.llmBudgetOverride,
  };
  const [plan, setPlan] = useState<PlanId>(current.plan);
  const base = PLANS[plan];
  const planBudget = PLAN_ALLOWANCES[plan].llmBudgetUsd;
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPlan(current.plan);
        setOpen(next);
      }}
      trigger={
        <Button variant="secondary" size="sm" aria-label={`Edit limits of ${org.name}`}>
          Edit limits
        </Button>
      }
      title="Edit limits"
      description={`${org.name}: the plan sets the limits; an override only raises one. Lowering deletes nothing, it refuses new repos and streams past the limit.`}
    >
      <form action={action} className="grid gap-3">
        <input type="hidden" name="orgId" value={org.id} />
        <div className="grid gap-1.5">
          <Label htmlFor={`plan-${org.id}`}>Plan</Label>
          <Select
            id={`plan-${org.id}`}
            name="plan"
            value={plan}
            onValueChange={setPlan}
            autoFocus
            options={PLAN_IDS.map((id) => ({ value: id, label: planSummary(id) }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`repo-limit-${org.id}`}>Repositories override</Label>
            <Input
              id={`repo-limit-${org.id}`}
              type="number"
              name="repoLimit"
              min={1}
              defaultValue={current.repoLimit ?? ""}
              placeholder={base.repos === null ? "unlimited" : `plan: ${base.repos}`}
              disabled={base.repos === null}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`stream-limit-${org.id}`}>Streams override</Label>
            <Input
              id={`stream-limit-${org.id}`}
              type="number"
              name="streamLimit"
              min={1}
              defaultValue={current.streamLimit ?? ""}
              placeholder={base.streams === null ? "unlimited" : `plan: ${base.streams}`}
              disabled={base.streams === null}
            />
          </div>
        </div>
        <FieldHelp>
          Leave an override empty to use the plan&apos;s limit. It counts only above the plan&apos;s
          limit.
        </FieldHelp>
        <div className="grid gap-1.5">
          <Label htmlFor={`llm-budget-${org.id}`}>Monthly AI budget (USD)</Label>
          <Input
            id={`llm-budget-${org.id}`}
            type="number"
            name="llmBudgetUsd"
            min={0}
            max={10000}
            step={0.01}
            inputMode="decimal"
            defaultValue={current.llmBudgetUsd ?? ""}
            placeholder={planBudget === null ? "plan: no budget" : `plan: ${formatUsd(planBudget)}`}
          />
          <FieldHelp>
            Replaces the plan&apos;s budget, higher or lower. Past it, weekly bulletins are a
            condensed edition; security alerts never change.
          </FieldHelp>
        </div>
        {!state.ok && <FormStatus ok={false} message={state.message} />}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button type="submit" variant="primary" disabled={pending}>
            Save
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
