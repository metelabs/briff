"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, type LucideIcon, Monitor, Moon, Plus, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { signOutAction } from "@/app/login/actions";
import { Logo } from "@/components/logo/Logo";
import { Button } from "@/components/ui/button";
import { DialogClose, FormDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FieldHelp, FormStatus, Label } from "@/components/ui/label";
import { Tooltip, TruncatedText, useIsTruncated } from "@/components/ui/tooltip";
import type { StreamOption } from "@/lib/stream-scope";
import { themeAttribute, THEMES, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

import {
  createOrgAction,
  type CreateOrgState,
  selectStreamAction,
  setThemeAction,
  switchOrgAction,
} from "./actions";
import { ConnectReposBarButton } from "./connect-sheet";
import { initialsOf, NAV, type NavHref } from "./nav";
import { PageContainer } from "./page-container";

export const menuPopupClass =
  "bg-surface text-fg border-line shadow-raised z-50 min-w-[250px] origin-[var(--transform-origin)] rounded-[14px] border p-1.5 outline-none transition-[opacity,scale] duration-[180ms] ease-out data-ending-style:scale-[.98] data-ending-style:opacity-0 data-ending-style:duration-[120ms] data-starting-style:scale-[.98] data-starting-style:opacity-0";
export const menuItemClass =
  "flex min-h-9 w-full cursor-default items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[14px] outline-none select-none transition-colors duration-[120ms] data-highlighted:bg-surface-2";

const THEME_LABELS: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };
const THEME_ICONS: Record<Theme, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("theming");
    window.setTimeout(() => root.classList.remove("theming"), 350);
  }
  const attr = themeAttribute(theme);
  if (attr) root.setAttribute("data-theme", attr);
  else root.removeAttribute("data-theme");
}

export function TopBar({
  active,
  admin,
  theme,
  alertsDot,
  user,
  streams,
  currentStreamId,
  orgs,
  currentOrgId,
}: {
  active: NavHref;
  admin: boolean;
  theme: Theme;
  /** New alerts in the current scope since the member last opened /alerts: a coral dot. */
  alertsDot: boolean;
  user: { name: string; email: string };
  streams: StreamOption[];
  currentStreamId: string | null;
  orgs: OrgOption[];
  currentOrgId: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLElement>(null);

  // Exposes the bar's height (64px, two rows on mobile) for scroll-margin on anchor targets.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty("--bar-h", `${Math.round(bar.getBoundingClientRect().height)}px`);
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // On mobile the pill row scrolls inside itself; keep the current page's pill visible.
  useEffect(() => {
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const nav = navRef.current;
    if (!current || !nav || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
  }, [active]);

  return (
    <header
      ref={barRef}
      data-sticky-top
      className={cn(
        "bg-bar sticky top-0 z-30 border-b backdrop-blur-[12px] transition-[border-color] duration-200",
        scrolled ? "border-line" : "border-transparent"
      )}
    >
      <PageContainer className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2.5 pt-2 md:min-h-16 md:flex-nowrap md:gap-4 md:pt-0">
        <Link href="/" aria-label="Briff, home" className="rounded-[8px]">
          <Logo size={24} />
        </Link>
        <nav
          ref={navRef}
          aria-label="Main"
          className="no-scrollbar bg-surface border-line order-3 mb-2.5 flex min-w-0 basis-full gap-0.5 overflow-x-auto rounded-full border p-[3px] md:order-none md:mb-0 md:basis-auto"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active === item.href ? "page" : undefined}
              className="text-fg-muted hover:bg-bg hover:text-fg aria-[current=page]:bg-fg aria-[current=page]:text-surface relative flex min-h-9 shrink-0 items-center rounded-full px-[13px] text-[14px] font-medium whitespace-nowrap transition-colors duration-150 md:min-h-0 md:py-1.5"
            >
              {item.label}
              {item.href === "/alerts" && alertsDot && (
                <>
                  <span
                    aria-hidden
                    className="bg-sec absolute top-[5px] right-[6px] size-1.5 rounded-full"
                  />
                  <span className="sr-only"> (new since your last visit)</span>
                </>
              )}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2.5">
          <ConnectReposBarButton />
          <StreamPicker streams={streams} currentStreamId={currentStreamId} />
          <AccountMenu
            user={user}
            admin={admin}
            theme={theme}
            orgs={orgs}
            currentOrgId={currentOrgId}
          />
        </div>
      </PageContainer>
    </header>
  );
}

function StreamPicker({
  streams,
  currentStreamId,
}: {
  streams: StreamOption[];
  currentStreamId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [optimistic, setOptimistic] = useState(currentStreamId);
  const shownId = pending ? optimistic : currentStreamId;
  const current = streams.find((s) => s.id === shownId) ?? null;
  const shownName = current?.name ?? "No stream";
  const { ref: nameRef, cut } = useIsTruncated<HTMLSpanElement>(shownName);

  return (
    <Menu.Root>
      {/* The full name is in the trigger's aria-label; the tooltip is for pointer users. */}
      <Tooltip content={shownName} disabled={!cut} describe={false} toggleOnTap={false}>
        <Menu.Trigger
          className="bg-surface border-line hover:border-brand data-popup-open:border-brand flex h-9 max-w-[46vw] min-w-0 items-center gap-[7px] rounded-full border px-3 text-[14px] font-medium transition-colors duration-150 sm:max-w-[260px]"
          aria-label={current ? `Stream: ${current.name}` : "Streams"}
        >
          <span aria-hidden className="bg-brand size-2 shrink-0 rounded-full" />
          <span ref={nameRef} className="truncate">
            {shownName}
          </span>
          <ChevronDown aria-hidden className="text-fg-muted size-3.5 shrink-0" />
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="z-50">
          <Menu.Popup className={menuPopupClass}>
            {streams.length > 0 && (
              <Menu.RadioGroup
                value={shownId ?? ""}
                onValueChange={(value: string) => {
                  if (value === currentStreamId) return;
                  setOptimistic(value);
                  startTransition(async () => {
                    const res = await selectStreamAction(value);
                    // A page filtered by ?stream= follows the picker instead of contradicting it.
                    const slug = streams.find((s) => s.id === value)?.slug;
                    if (res.ok && slug && searchParams.has("stream")) {
                      const next = new URLSearchParams(searchParams);
                      next.set("stream", slug);
                      router.replace(`${pathname}?${next.toString()}`);
                    }
                  });
                }}
              >
                <Menu.GroupLabel className="text-fg-muted px-2.5 pt-1 pb-1.5 text-[12px] font-medium">
                  Stream
                </Menu.GroupLabel>
                {streams.map((s) => (
                  <Menu.RadioItem key={s.id} value={s.id} className={menuItemClass}>
                    <span className="flex w-4 shrink-0 justify-center">
                      <Menu.RadioItemIndicator>
                        <Check aria-hidden className="text-brand size-4" />
                      </Menu.RadioItemIndicator>
                    </span>
                    <TruncatedText className="flex-1" focusable={false}>
                      {s.name}
                    </TruncatedText>
                    <span className="text-fg-muted text-[12.5px] tabular-nums">
                      {s.repoCount} {s.repoCount === 1 ? "repo" : "repos"}
                    </span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            )}
            {streams.length > 0 && <Menu.Separator className="border-line my-1.5 border-t" />}
            <Menu.LinkItem
              render={<Link href="/streams" />}
              className={cn(menuItemClass, "text-brand text-[13px] font-medium")}
            >
              {streams.length > 0 ? "Manage streams" : "Create a stream"}
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export interface OrgOption {
  id: string;
  name: string;
  role: "owner" | "member";
}

function AccountMenu({
  user,
  admin,
  theme,
  orgs,
  currentOrgId,
}: {
  user: { name: string; email: string };
  admin: boolean;
  theme: Theme;
  orgs: OrgOption[];
  currentOrgId: string;
}) {
  const [shownTheme, setShownTheme] = useState(theme);
  const [, startTransition] = useTransition();
  const [switching, startSwitch] = useTransition();
  const [optimisticOrg, setOptimisticOrg] = useState(currentOrgId);
  const [creating, setCreating] = useState(false);
  // A new key per opening, so the dialog starts empty.
  const [round, setRound] = useState(0);

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label="Account and theme"
          className="bg-brand-soft text-brand hover:ring-line-strong data-popup-open:ring-brand grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold ring-1 ring-transparent transition-shadow duration-150"
        >
          {initialsOf(user.name, user.email)}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={8} align="end" className="z-50">
            <Menu.Popup className={menuPopupClass}>
              <div className="px-2.5 pt-1.5 pb-2">
                <TruncatedText className="text-[14px] font-medium" focusable={false}>
                  {user.name || user.email}
                </TruncatedText>
                <TruncatedText className="text-fg-muted text-[12.5px]" focusable={false}>
                  {user.email}
                </TruncatedText>
              </div>
              <Menu.Separator className="border-line my-1.5 border-t" />
              <Menu.RadioGroup
                value={switching ? optimisticOrg : currentOrgId}
                onValueChange={(value: string) => {
                  if (value === currentOrgId) return;
                  setOptimisticOrg(value);
                  startSwitch(async () => {
                    await switchOrgAction(value);
                  });
                }}
              >
                <Menu.GroupLabel className="text-fg-muted px-2.5 pt-1 pb-1.5 text-[12px] font-medium">
                  Organisation
                </Menu.GroupLabel>
                {orgs.map((o) => (
                  <Menu.RadioItem key={o.id} value={o.id} className={menuItemClass}>
                    <span className="flex w-4 shrink-0 justify-center">
                      <Menu.RadioItemIndicator>
                        <Check aria-hidden className="text-brand size-4" />
                      </Menu.RadioItemIndicator>
                    </span>
                    <TruncatedText className="flex-1" focusable={false}>
                      {o.name}
                    </TruncatedText>
                    <span className="text-fg-muted text-[12.5px]">
                      {o.role === "owner" ? "Owner" : "Member"}
                    </span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
              <Menu.Item
                className={cn(menuItemClass, "text-brand text-[13px] font-medium")}
                onClick={() => {
                  setRound((r) => r + 1);
                  setCreating(true);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  <Plus aria-hidden className="size-4" />
                </span>
                Create organisation
              </Menu.Item>
              <Menu.Separator className="border-line my-1.5 border-t" />
              <Menu.RadioGroup
                value={shownTheme}
                onValueChange={(value: Theme) => {
                  setShownTheme(value);
                  applyTheme(value);
                  startTransition(async () => {
                    await setThemeAction(value);
                  });
                }}
                className="flex items-center justify-between gap-3 py-0.5 pr-0.5 pl-2.5"
              >
                <Menu.GroupLabel className="text-fg-muted text-[12.5px] font-medium">
                  Theme
                </Menu.GroupLabel>
                <div className="bg-surface-2 border-line flex gap-0.5 rounded-full border p-0.5">
                  {THEMES.map((t) => {
                    const Icon = THEME_ICONS[t];
                    return (
                      <Tooltip
                        key={t}
                        content={THEME_LABELS[t]}
                        describe={false}
                        toggleOnTap={false}
                      >
                        <Menu.RadioItem
                          value={t}
                          closeOnClick={false}
                          aria-label={`${THEME_LABELS[t]} theme`}
                          title={THEME_LABELS[t]}
                          className="text-fg-muted data-highlighted:ring-line-strong data-highlighted:not-data-checked:bg-surface data-highlighted:not-data-checked:text-fg data-checked:bg-brand-soft data-checked:text-brand grid size-8 cursor-default place-items-center rounded-full transition-colors duration-[120ms] outline-none select-none data-highlighted:ring-1"
                        >
                          <Icon aria-hidden className="size-4" />
                        </Menu.RadioItem>
                      </Tooltip>
                    );
                  })}
                </div>
              </Menu.RadioGroup>
              <Menu.Separator className="border-line my-1.5 border-t" />
              <Menu.LinkItem render={<Link href="/settings" />} className={menuItemClass}>
                Settings
              </Menu.LinkItem>
              {admin && (
                <Menu.LinkItem render={<Link href="/admin" />} className={menuItemClass}>
                  Admin
                </Menu.LinkItem>
              )}
              <Menu.Item
                className={menuItemClass}
                onClick={() => {
                  startTransition(async () => {
                    await signOutAction();
                  });
                }}
              >
                Sign out
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="Create organisation"
        description="A separate workspace with its own repos, streams, bulletins and members. You are its owner."
      >
        <CreateOrgForm key={round} />
      </FormDialog>
    </>
  );
}

const CREATE_INITIAL: CreateOrgState = { ok: true, message: null };

function CreateOrgForm() {
  const [state, action, pending] = useActionState(createOrgAction, CREATE_INITIAL);
  return (
    <form action={action} className="grid gap-1.5">
      <Label htmlFor="new-org-name">Name</Label>
      <Input
        id="new-org-name"
        name="name"
        placeholder="e.g. Acme Studio"
        maxLength={100}
        defaultValue={state.saved ?? ""}
        required
        autoFocus
      />
      <FieldHelp>You can rename it later in Settings.</FieldHelp>
      <FormStatus ok={state.ok} message={state.message} />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <DialogClose render={<Button variant="secondary">Cancel</Button>} />
        <Button type="submit" variant="primary" disabled={pending}>
          Create organisation
        </Button>
      </div>
    </form>
  );
}
