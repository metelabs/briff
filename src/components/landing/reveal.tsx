"use client";

import { useEffect } from "react";

/**
 * Scroll reveals for the landing page (globals.css, "Landing page"). Sections marked
 * `data-reveal` get `data-shown` when they scroll into view. What is already on screen is
 * shown first, and only then does `<html data-reveal-ready>` hide the rest, so nothing
 * flashes; without JavaScript or with reduced motion everything simply stays visible.
 */
export function RevealObserver() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;
    const root = document.documentElement;
    const show = (el: Element) => el.setAttribute("data-shown", "");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show(entry.target);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 }
    );
    for (const el of document.querySelectorAll("[data-reveal]")) {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.88) show(el);
      else observer.observe(el);
    }
    root.setAttribute("data-reveal-ready", "");
    return () => {
      observer.disconnect();
      root.removeAttribute("data-reveal-ready");
    };
  }, []);
  return null;
}
