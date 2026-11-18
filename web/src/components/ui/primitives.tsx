import type { HTMLAttributes, ReactNode } from "react";
import { Dialog as RDialog, Tabs as RTabs, Tooltip as RTooltip, DropdownMenu as RMenu } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- Badge

const badgeTones = {
  neutral: "bg-surface-3 text-fg-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/12 text-danger",
  outline: "border border-border text-fg-muted",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: keyof typeof badgeTones; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-medium [&_svg]:size-3", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

export function StatusDot({ status, className }: { status: "ok" | "error" | "unknown" | "working" | "idle" | "warning"; className?: string }) {
  const color = {
    ok: "bg-success",
    idle: "bg-fg-subtle",
    unknown: "bg-fg-subtle",
    error: "bg-danger",
    warning: "bg-warning",
    working: "bg-accent animate-pulse-dot",
  }[status];
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", color, className)} />;
}

// ---------------------------------------------------------------- Card

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-surface", className)} {...props} />;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-border px-4 py-3", className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Page layout

export function PageHeader({ title, description, actions, icon }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="flex min-w-0 items-center gap-3">
        {icon ? <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-fg-muted [&_svg]:size-4.5">{icon}</div> : null}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          {description ? <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-6 py-6 lg:px-8", wide ? "max-w-[1600px]" : "max-w-6xl", className)}>{children}</div>;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2 text-fg-muted [&_svg]:size-5">{icon}</div> : null}
      <p className="text-[13px] font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-md text-xs text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-2 px-1 font-mono text-[10px] text-fg-subtle">{children}</kbd>;
}

export function Progress({ value, tone = "accent", className }: { value: number | null; tone?: "accent" | "warning" | "danger" | "success"; className?: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  const color = { accent: "bg-accent", warning: "bg-warning", danger: "bg-danger", success: "bg-success" }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface px-4 py-3", className)}>
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-fg-subtle">{hint}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Dialog

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const width = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <RDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-surface shadow-2xl",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <RDialog.Title className="text-[15px] font-semibold">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-xs text-fg-muted">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Fermer">
              <X className="size-4" />
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ---------------------------------------------------------------- Tabs

export function Tabs({ value, onValueChange, items, className }: { value: string; onValueChange: (v: string) => void; items: { value: string; label: ReactNode; icon?: ReactNode; count?: number }[]; className?: string }) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange}>
      <RTabs.List className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}>
        {items.map((it) => (
          <RTabs.Trigger
            key={it.value}
            value={it.value}
            className="relative -mb-px flex h-9 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-2.5 text-[13px] text-fg-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg [&_svg]:size-3.5"
          >
            {it.icon}
            {it.label}
            {it.count !== undefined ? <span className="rounded bg-surface-3 px-1 text-[10px] tabular-nums text-fg-subtle">{it.count}</span> : null}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
    </RTabs.Root>
  );
}

// ---------------------------------------------------------------- Tooltip

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  if (!content) return <>{children}</>;
  return (
    <RTooltip.Root delayDuration={250}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-[60] max-w-xs rounded-md border border-border bg-surface-3 px-2 py-1 text-xs text-fg shadow-lg">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export const TooltipProvider = RTooltip.Provider;

// ---------------------------------------------------------------- Dropdown menu

export function Menu({ trigger, items, align = "end" }: { trigger: ReactNode; items: ({ label: ReactNode; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean } | "separator")[]; align?: "start" | "end" }) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content align={align} sideOffset={4} className="z-50 min-w-44 rounded-lg border border-border bg-surface-2 p-1 shadow-xl">
          {items.map((it, i) =>
            it === "separator" ? (
              <RMenu.Separator key={i} className="my-1 h-px bg-border" />
            ) : (
              <RMenu.Item
                key={i}
                disabled={it.disabled}
                onSelect={it.onSelect}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-3 [&_svg]:size-3.5",
                  it.danger ? "text-danger" : "text-fg",
                )}
              >
                {it.icon}
                {it.label}
              </RMenu.Item>
            ),
          )}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

export function Section({ title, description, children, actions, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {description ? <p className="text-xs text-fg-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
