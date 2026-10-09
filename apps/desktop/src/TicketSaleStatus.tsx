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
  const label = (() => {
    if (document.documentElement.lang !== "ko") return status.label;
    const text = status.label;
    let match = text.match(/^D-(\d+) until sale$/);
    if (match) return "예매까지 D-" + match[1];
    match = text.match(/^Opens in (\d+)d (\d+)h$/);
    if (match) return match[1] + "일 " + match[2] + "시간 후 오픈";
    match = text.match(/^Opens in (\d+)h (\d+)m$/);
    if (match) return match[1] + "시간 " + match[2] + "분 후 오픈";
    match = text.match(/^Opens in (\d+)m$/);
    if (match) return match[1] + "분 후 오픈";
    return tx(text);
  })();
  const Icon = status.phase === "started" ? CheckCircle2 :
    ["sold-out", "cancelled", "postponed"].includes(status.phase) ? AlertCircle :
    status.phase === "tba" ? CalendarClock : Clock3;
  return (
    <span className={"ticket-sale-status ticket-sale-status--" + status.phase + (compact ? " is-compact" : "")}
      title={date} aria-label={label + ". " + date}>
      <span className="ticket-sale-status-line"><Icon size={13} aria-hidden="true" />{label}</span>
      {showDate && <span className="ticket-sale-status-date">{date}</span>}
    </span>
  );
}
