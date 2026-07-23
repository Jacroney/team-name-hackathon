import * as Dialog from "@radix-ui/react-dialog";
import { Warning, X } from "@phosphor-icons/react";
import type { ReactElement } from "react";

interface ConfirmDialogProps {
  trigger: ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  intent?: "primary" | "danger";
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  intent = "primary",
}: ConfirmDialogProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-icon" data-intent={intent}>
            <Warning size={20} aria-hidden="true" />
          </div>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button className="button secondary" type="button">Cancel</button>
            </Dialog.Close>
            <Dialog.Close asChild>
              <button className="button" data-intent={intent} type="button" onClick={onConfirm}>
                {confirmLabel}
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Close className="dialog-close" aria-label="Close confirmation">
            <X size={16} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
