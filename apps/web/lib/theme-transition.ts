"use client";

/**
 * U5 (A8): shared "no hard flash" transition helper for whole-surface state
 * flips (theme mode, presentation mode). Chromium gets a View Transitions
 * cross-fade; other engines get an optional CSS fallback class window on
 * <html> (see globals.css `html.theme-fade`). prefers-reduced-motion makes
 * every path an instant switch.
 */

type DocWithVT = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => unknown;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/** Resolves once the DOM mutated after `apply` (or after a short timeout). */
function domSettled(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      resolve();
    };
    const observer = new MutationObserver(finish);
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    window.setTimeout(finish, 150);
  });
}

export function withViewTransition(
  apply: () => void,
  opts: { fallbackClass?: string } = {},
): void {
  if (typeof document === "undefined") {
    apply();
    return;
  }
  const doc = document as DocWithVT;
  if (!prefersReducedMotion() && typeof doc.startViewTransition === "function") {
    doc.startViewTransition(async () => {
      apply();
      await domSettled();
    });
    return;
  }
  if (!prefersReducedMotion() && opts.fallbackClass) {
    const root = document.documentElement;
    const cls = opts.fallbackClass;
    root.classList.add(cls);
    window.setTimeout(() => root.classList.remove(cls), 360);
  }
  apply();
}
