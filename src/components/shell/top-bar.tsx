"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { signOutAction } from "@/app/login/actions";
import { Logo } from "@/components/logo/Logo";
import { Tooltip, TruncatedText, useIsTruncated } from "@/components/ui/tooltip";
import type { StreamOption } from "@/lib/stream-scope";
import { themeAttribute, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

import { selectStreamAction, setThemeAction } from "./actions";
import { ConnectReposBarButton } from "./connect-sheet";
import { initialsOf, NAV, type NavHref } from "./nav";
import { PageContainer } from "./page-container";

export const menuPopupClass =
  "bg-surface text-fg border-line shadow-raised z-50 min-w-[250px] origin-[var(--transform-origin)] rounded-[14px] border p-1.5 outline-none transition-[opacity,scale] duration-[180ms] ease-out data-ending-style:scale-[.98] data-ending-style:opacity-0 data-ending-style:duration-[120ms] data-starting-style:scale-[.98] data-starting-style:opacity-0";
export const menuItemClass =
  "flex min-h-9 w-full cursor-default items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[14px] outline-none select-none transition-colors duration-[120ms] data-highlighted:bg-surface-2";

const THEME_LABELS: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

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
}: {
  active: NavHref;
  admin: boolean;
  theme: Theme;
  /** New alerts in the current scope since the member last opened /alerts: a coral dot. */
  alertsDot: boolean;
  user: { name: string; email: string };
  streams: StreamOption[];
  currentStreamId: string | null;
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
          <AccountMenu user={user} admin={admin} theme={theme} />
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

function AccountMenu({
  user,
  admin,
  theme,
}: {
  user: { name: string; email: string };
  admin: boolean;
  theme: Theme;
}) {
  const [shownTheme, setShownTheme] = useState(theme);
  const [, startTransition] = useTransition();

  return (
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
              value={shownTheme}
              onValueChange={(value: Theme) => {
                setShownTheme(value);
                applyTheme(value);
                startTransition(async () => {
                  await setThemeAction(value);
                });
              }}
            >
              <Menu.GroupLabel className="text-fg-muted px-2.5 pt-1 pb-1.5 text-[12px] font-medium">
                Theme
              </Menu.GroupLabel>
              {(Object.keys(THEME_LABELS) as Theme[]).map((t) => (
                <Menu.RadioItem key={t} value={t} closeOnClick={false} className={menuItemClass}>
                  <span className="flex w-4 shrink-0 justify-center">
                    <Menu.RadioItemIndicator>
                      <Check aria-hidden className="text-brand size-4" />
                    </Menu.RadioItemIndicator>
                  </span>
                  {THEME_LABELS[t]}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Separator className="border-line my-1.5 border-t" />
            <Menu.LinkItem render={<Link href="/settings" />} className={menuItemClass}>
              <span className="w-4" aria-hidden />
              Settings
            </Menu.LinkItem>
            {admin && (
              <Menu.LinkItem render={<Link href="/admin" />} className={menuItemClass}>
                <span className="w-4" aria-hidden />
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
              <span className="w-4" aria-hidden />
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
