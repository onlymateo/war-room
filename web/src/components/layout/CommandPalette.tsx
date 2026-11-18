import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Dialog as RDialog } from "radix-ui";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, CornerDownLeft } from "lucide-react";
import { api } from "@/lib/api";
import { NAV } from "./AppShell";
import { t } from "@/i18n";

interface SearchHit {
  type: string;
  title: string;
  href: string;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q), 180);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const results = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.get<SearchHit[]>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.trim().length >= 2,
  });

  const go = (href: string) => {
    onOpenChange(false);
    navigate(href);
  };

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RDialog.Content className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          <RDialog.Title className="sr-only">{t("Recherche globale")}</RDialog.Title>
          <RDialog.Description className="sr-only">{t("Rechercher dans WAR ROOM ou naviguer")}</RDialog.Description>
          <Command shouldFilter={false} className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 text-fg-subtle" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder={t("Rechercher War Rooms, agents, messages, fichiers…")}
                className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
              />
            </div>
            <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-xs text-fg-subtle">
                {results.isFetching ? t("Recherche…") : t("Aucun résultat")}
              </Command.Empty>
              {q.trim().length < 2 ? (
                <>
                  <Command.Group heading="Actions" className="text-[11px] text-fg-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                    <Item onSelect={() => go("/warrooms/new")} icon={<Plus />} label={t("Nouvelle War Room")} />
                    <Item onSelect={() => go("/chats?new=1")} icon={<Plus />} label={t("Nouveau chat")} hint="Ctrl Shift O" />
                    <Item onSelect={() => go("/projects?new=1")} icon={<Plus />} label={t("Nouveau projet")} />
                  </Command.Group>
                  <Command.Group heading="Navigation" className="text-[11px] text-fg-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                    {NAV.map((n) => (
                      <Item key={n.to} onSelect={() => go(n.to)} icon={<n.icon />} label={n.label} />
                    ))}
                  </Command.Group>
                </>
              ) : (
                (results.data ?? []).map((r, i) => (
                  <Item key={`${r.href}-${i}`} onSelect={() => go(r.href)} label={r.title} hint={r.type} />
                ))
              )}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function Item({ onSelect, icon, label, hint }: { onSelect: () => void; icon?: React.ReactNode; label: string; hint?: string }) {
  return (
    <Command.Item
      onSelect={onSelect}
      value={`${label}-${hint ?? ""}`}
      className="group flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-fg data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-fg-subtle"
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {hint ? <span className="text-[11px] text-fg-subtle">{hint}</span> : null}
      <CornerDownLeft className="hidden size-3 group-data-[selected=true]:block" />
    </Command.Item>
  );
}
