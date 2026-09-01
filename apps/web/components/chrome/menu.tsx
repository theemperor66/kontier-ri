"use client";

/**
 * Lightweight accessible dropdown menu (no portal): trigger render-prop +
 * an absolutely positioned panel. Keyboard: Enter/Space/ArrowDown open,
 * Arrow keys move item focus, Home/End jump, Escape closes and restores
 * trigger focus, Tab or an outside pointerdown closes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

interface MenuContextValue {
  close: (restoreFocus?: boolean) => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

export interface MenuTriggerProps {
  ref: React.Ref<HTMLButtonElement>;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

function focusableItems(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'),
  );
}

export function Menu({
  label,
  trigger,
  children,
  align = "end",
  panelClassName,
  className,
}: {
  /** Accessible name of the menu panel. */
  label: string;
  /** Render the trigger; spread `props` onto a focusable button. */
  trigger: (props: MenuTriggerProps, open: boolean) => React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  panelClassName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /** Scroll position at open time; null once the user scrolls on purpose. */
  const openScrollRef = useRef<{ x: number; y: number } | null>(null);

  const close = useCallback((restoreFocus = false) => {
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    setOpen(false);
    // Chrome natively scroll-jumps the page when a menu item is clicked
    // with the mouse (no JS scroll API and no focus event involved —
    // verified by wrapping/logging them all; keyboard selection is clean).
    // Menu interactions never scroll by design, so restore the position
    // captured at open for a few frames around the close — unless the
    // user really scrolled (wheel/touch) while the menu was open.
    const want = openScrollRef.current;
    if (want) {
      let frames = 0;
      const pin = () => {
        if (window.scrollX !== want.x || window.scrollY !== want.y) {
          window.scrollTo(want.x, want.y);
        }
        if (++frames < 6) requestAnimationFrame(pin);
      };
      pin();
    }
  }, []);

  // Outside pointerdown closes; deliberate scrolling disables the pin.
  useEffect(() => {
    if (!open) return;
    openScrollRef.current = { x: window.scrollX, y: window.scrollY };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onUserScroll = () => {
      openScrollRef.current = null;
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchmove", onUserScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
    };
  }, [open, close]);

  // Focus the first item once the panel is up.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      focusableItems(panelRef.current)[0]?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      close();
      return;
    }
    const items = focusableItems(panelRef.current);
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const triggerProps: MenuTriggerProps = {
    ref: (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
    },
    "aria-haspopup": "menu",
    "aria-expanded": open,
    onClick: () => setOpen((v) => !v),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown" && !open) {
        e.preventDefault();
        setOpen(true);
      }
    },
  };

  return (
    <MenuContext.Provider value={{ close }}>
      <span ref={rootRef} className={cn("relative inline-flex", className)}>
        {trigger(triggerProps, open)}
        {open ? (
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            onKeyDown={onPanelKeyDown}
            className={cn(
              "menu-enter absolute top-full z-50 mt-1.5 min-w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg",
              align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
              panelClassName,
            )}
          >
            {children}
          </div>
        ) : null}
      </span>
    </MenuContext.Provider>
  );
}

export function MenuItem({
  icon,
  children,
  shortcut,
  onSelect,
  disabled,
  className,
  ...buttonProps
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  /** Right-aligned keyboard hint, e.g. "F" or "\u2318K". */
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"button">, "onClick" | "children" | "className">) {
  const ctx = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      // Keep native mousedown focus off menu items: Chrome scroll-jumps
      // toward a focused element that unmounts (menu closes on select).
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => {
        // Restore focus to the trigger BEFORE the panel unmounts: if the
        // focused item is removed while focused, Chrome scroll-jumps the
        // page toward the orphaned focus position.
        ctx?.close(true);
        onSelect();
      }}
      className={cn(
        "flex w-full cursor-pointer select-none items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...buttonProps}
    >
      {icon ? (
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? (
        <kbd className="ml-auto shrink-0 rounded border border-border bg-muted px-1 font-sans text-[10px] text-muted-foreground">
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="mx-1 my-1 h-px bg-border/70" />;
}
