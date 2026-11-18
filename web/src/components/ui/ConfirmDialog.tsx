import type { ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./primitives";
import { t } from "@/i18n";

/** Confirmation for destructive actions: says exactly what will happen before doing it. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  details,
  confirmLabel,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Bullet list of what will be removed or kept. */
  details?: ReactNode[];
  confirmLabel?: string;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {t("Annuler")}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel ?? t("Supprimer")}
          </Button>
        </>
      }
    >
      {details?.length ? (
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-fg-muted">
          {details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-fg-muted">{t("Cette action est définitive.")}</p>
      )}
    </Dialog>
  );
}
