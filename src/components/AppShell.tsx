import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ClipboardCheck, LogOut, Menu, RadioTower, Settings, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { RealtimeStatus } from "../lib/realtime";
import { ConnectionStatus } from "./ConnectionStatus";

interface AppShellProps {
  queue: ReactNode;
  workspace: ReactNode;
  decision: ReactNode;
  selected: boolean;
  activeCount: number;
  connectionStatus: RealtimeStatus;
  onMobileBack: () => void;
}

const useMobileLayout = (): boolean => {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 800px)").matches);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const update = (): void => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return mobile;
};

export function AppShell({
  queue,
  workspace,
  decision,
  selected,
  activeCount,
  connectionStatus,
  onMobileBack,
}: AppShellProps) {
  const [time, setTime] = useState(() => new Date());
  const [decisionOpen, setDecisionOpen] = useState(false);
  const mobile = useMobileLayout();

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => setDecisionOpen(false), [selected]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><RadioTower size={16} /></span>
          <strong>Crisis Mesh</strong>
          <span className="console-label">OPS CONSOLE</span>
        </div>
        <div className="topbar-spacer" />
        <ConnectionStatus status={connectionStatus} />
        <div className="active-count"><span>Active</span><strong>{activeCount}</strong></div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="operator-menu" aria-label="Open operator menu">
            <span className="operator-avatar">AO</span>
            <span className="operator-copy"><small>OPERATOR</small><strong>A. Okafor</strong></span>
            <ChevronDown size={14} aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="dropdown-content" align="end" sideOffset={6}>
              <DropdownMenu.Label>Shift 14:00–22:00</DropdownMenu.Label>
              <DropdownMenu.Separator />
              <DropdownMenu.Item><ClipboardCheck size={15} /> Handoff notes</DropdownMenu.Item>
              <DropdownMenu.Item><Settings size={15} /> Console settings</DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item><LogOut size={15} /> End shift</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <time className="topbar-clock" dateTime={time.toISOString()}>
          {time.toLocaleTimeString("en-US", { hour12: false })}
        </time>
      </header>

      <main className="console-grid" data-selected={selected || undefined}>
        <aside className="queue-column" aria-label="Incident queue">{queue}</aside>
        <section className="workspace-column" aria-label="Incident details">{workspace}</section>
        {!mobile && <aside className="decision-column" aria-label="Dispatch decision">{decision}</aside>}
      </main>

      {mobile && selected && (
        <div className="mobile-action-bar">
          <button type="button" className="button secondary" onClick={onMobileBack}>
            <Menu size={17} /> Queue
          </button>
          <Dialog.Root open={decisionOpen} onOpenChange={setDecisionOpen}>
            <Dialog.Trigger asChild>
              <button type="button" className="button mobile-review-button">
                Review decision
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content className="mobile-decision-drawer">
                <div className="mobile-drawer-header">
                  <Dialog.Title>Dispatch decision</Dialog.Title>
                  <Dialog.Close aria-label="Close decision panel"><X size={18} /></Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">
                  Review extracted fields and choose an incident action.
                </Dialog.Description>
                <div className="mobile-drawer-body">{decision}</div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      )}
    </div>
  );
}
