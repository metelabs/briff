"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { useToast } from "@/components/ui/toast";
import { flashStep, strippedUrl } from "@/lib/flash";

/** Shows a redirect's one-shot message (`src/lib/flash.ts`) as a toast, then drops its params. */
export function FlashToast() {
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const shown = useRef<string | null>(null);

  useEffect(() => {
    const step = flashStep(pathname, params, shown.current);
    shown.current = step.key;
    if (!step.show) return;
    toast(step.show.message, step.show.kind);
    // The native history API updates the URL without asking the server for the page again
    // (router.replace would re-render it right after the navigation that brought the flash).
    window.history.replaceState(
      null,
      "",
      strippedUrl(pathname, params, step.show.strip, window.location.hash)
    );
  }, [pathname, params, toast]);

  return null;
}
