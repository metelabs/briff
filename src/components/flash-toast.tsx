"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { useToast } from "@/components/ui/toast";
import { flashStep, strippedUrl } from "@/lib/flash";

/** Shows a redirect's one-shot message (`src/lib/flash.ts`) as a toast, then drops its params. */
export function FlashToast() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const shown = useRef<string | null>(null);

  useEffect(() => {
    const step = flashStep(pathname, params, shown.current);
    shown.current = step.key;
    if (!step.show) return;
    toast(step.show.message, step.show.kind);
    router.replace(strippedUrl(pathname, params, step.show.strip, window.location.hash), {
      scroll: false,
    });
  }, [pathname, params, router, toast]);

  return null;
}
