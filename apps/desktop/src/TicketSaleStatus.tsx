import { Clock3, CheckCircle2, CalendarClock, AlertCircle } from "lucide-react";
import { tx } from "./i18n";
import { formatSaleLocalTime, getSaleTiming } from "./ticket-sales";
import type { PerformanceState } from "./ticket-sales";

type Props = {
  saleAt?: string | null;
  now: number;
  timezone?: string | null;
  performanceStatus?: PerformanceState;
  showDate?: boolean;
  compact?: boolean;
};

export function TicketSaleStatus({ saleAt, now, timezone, performanceStatus, showDate = false, compact = false }: Props) {
  const status = getSaleTiming(saleAt, now, performanceStatus);
  const date = formatSaleLocalTime(saleAt, timezone);
  const Icon = status.phase === "started" ? CheckCircle2 :
    ["sold-out", "cancelled", "postponed"].includes(status.phase) ? AlertCircle :
    status.phase === "tba" ? CalendarClock : Clock3;
  return (
    <span className={"ticket-sale-status ticket-sale-status--" + status.phase + (compact ? " is-compact" : "")}
      title={date} aria-label={tx(status.label) + ". " + date}>
      <span className="ticket-sale-status-line"><Icon size={13} aria-hidden="true" />{tx(status.label)}</span>
      {showDate && <span className="ticket-sale-status-date">{date}</span>}
    </span>
  );
}
