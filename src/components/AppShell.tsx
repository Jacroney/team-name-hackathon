import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  CaretDown,
  ClipboardText,
  Gear,
  SignOut,
  Broadcast,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import type { RealtimeStatus } from "../lib/realtime";
import { ConnectionStatus } from "./ConnectionStatus";

interface AppShellProps {
  map: ReactNode;
  left: ReactNode;
  right: ReactNode;
  wide: boolean;
  activeCount: number;
  connectionStatus: RealtimeStatus;
}

export function AppShell({ map, left, right, wide, activeCount, connectionStatus }: AppShellProps) {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="mapui">
      <div className="mapui-canvas">{map}</div>

      <header className="mapui-topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><Broadcast size={16} weight="bold" /></span>
          <strong>Flare Net</strong>
          <span className="console-label">FLOOD OPS · TRAVIS CO.</span>
        </div>
        <div className="topbar-spacer" />
        <ConnectionStatus status={connectionStatus} />
        <div className="active-count"><span>Active</span><strong>{activeCount}</strong></div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="operator-menu" aria-label="Open operator menu">
            <span className="operator-avatar">AO</span>
            <span className="operator-copy"><small>OPERATOR</small><strong>A. Okafor</strong></span>
            <CaretDown size={13} aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="dropdown-content" align="end" sideOffset={8}>
              <DropdownMenu.Label>Shift 14:00–22:00</DropdownMenu.Label>
              <DropdownMenu.Separator />
              <DropdownMenu.Item><ClipboardText size={15} /> Handoff notes</DropdownMenu.Item>
              <DropdownMenu.Item><Gear size={15} /> Console settings</DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item><SignOut size={15} /> End shift</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <time className="topbar-clock" dateTime={time.toISOString()}>
          {time.toLocaleTimeString("en-US", { hour12: false })}
        </time>
      </header>

      <aside className="mapui-left" aria-label="Incident queue">{left}</aside>

      {right && (
        <aside className="mapui-right" data-wide={wide || undefined} aria-label="Incident details">
          {right}
        </aside>
      )}
    </div>
  );
}
