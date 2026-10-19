import {
  AlertTriangle,
  CircleCheck,
  CircleDot,
  CirclePause,
  CircleX,
} from "lucide-react";

type Status = "UP" | "DOWN" | "PAUSED" | "UNKNOWN";

const statusConfig: Record<
  Status,
  { label: string; className: string; icon: typeof CircleCheck }
> = {
  UP: {
    label: "Opérationnel",
    className: "border-state-up/25 bg-state-up/10 text-state-up",
    icon: CircleCheck,
  },
  DOWN: {
    label: "Incident",
    className: "border-state-down/25 bg-state-down/10 text-state-down",
    icon: CircleX,
  },
  PAUSED: {
    label: "En pause",
    className: "border-ink-muted/30 bg-ink-muted/10 text-ink-muted",
    icon: CirclePause,
  },
  UNKNOWN: {
    label: "En attente",
    className: "border-state-warn/25 bg-state-warn/10 text-state-warn",
    icon: AlertTriangle,
  },
};

export function StatusBadge({ status }: { status: Status }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.className}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{config.label}</span>
    </span>
  );
}

export function StatusDot({ status }: { status: Status }) {
  const color =
    status === "UP"
      ? "text-state-up"
      : status === "DOWN"
        ? "text-state-down"
        : status === "PAUSED"
          ? "text-ink-muted"
          : "text-state-warn";
  return <CircleDot className={`h-4 w-4 ${color}`} aria-hidden="true" />;
}
