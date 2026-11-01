"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { useToast } from "@/components/ui/toast";
import { flashFor, strippedUrl } from "@/lib/flash";

/** Shows a redirect's one-shot message (`src/lib/flash.ts`) as a toast, then drops its params. */
export function FlashToast() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const shown = useRef<string | null>(null);

  useEffect(() => {
    const flash = flashFor(pathname, params);
    // Once the params are stripped, forget the URL so the same redirect later toasts again.
    if (!flash) {
      shown.current = null;
      return;
    }
    const key = `${pathname}?${params.toString()}`;
    if (shown.current === key) return;
    shown.current = key;
    toast(flash.message, flash.kind);
    router.replace(strippedUrl(pathname, params, flash.strip, window.location.hash), {
      scroll: false,
    });
  }, [pathname, params, router, toast]);

  return null;
}
