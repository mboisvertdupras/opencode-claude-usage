import { Schema } from "effect"

export const WINDOWS = {
  five_hour: { label: "Usage", short: "5h", name: "5-hour" },
  seven_day: { label: "Weekly", short: "7d", name: "Weekly" },
} as const

export type WindowKind = keyof typeof WINDOWS

const KINDS = Object.keys(WINDOWS) as WindowKind[]

export const LimitWindow = Schema.Struct({
  kind: Schema.Literals(KINDS),
  percent: Schema.Number,
  resetsAt: Schema.NullOr(Schema.String),
})
export type LimitWindow = typeof LimitWindow.Type

export const UsageError = Schema.Struct({
  reason: Schema.Literals(["no-credentials", "expired", "unauthorized", "rate-limited", "http", "network"]),
  message: Schema.String,
})
export type UsageError = typeof UsageError.Type

export const Snapshot = Schema.Union([
  Schema.Struct({ status: Schema.Literal("loading") }),
  Schema.Struct({
    status: Schema.Literal("ok"),
    windows: Schema.Array(LimitWindow),
    fetchedAt: Schema.Number,
    error: Schema.optionalKey(UsageError),
  }),
  Schema.Struct({ status: Schema.Literal("unavailable"), error: UsageError, fetchedAt: Schema.Number }),
])
export type Snapshot = typeof Snapshot.Type

export type FetchResult = { ok: true; windows: readonly LimitWindow[] } | { ok: false; error: UsageError }

export function parseUsage(json: unknown): LimitWindow[] {
  if (!isRecord(json)) return []
  return KINDS.flatMap((kind) => {
    const raw = json[kind]
    if (!isRecord(raw) || typeof raw.utilization !== "number" || !Number.isFinite(raw.utilization)) return []
    return [{ kind, percent: raw.utilization, resetsAt: typeof raw.resets_at === "string" ? raw.resets_at : null }]
  })
}

export function nextSnapshot(previous: Snapshot, result: FetchResult, now: number): Snapshot {
  if (result.ok) return { status: "ok", windows: result.windows, fetchedAt: now }
  if (previous.status === "ok") return { ...previous, error: result.error }
  return { status: "unavailable", error: result.error, fetchedAt: now }
}

export type Severity = "normal" | "warning" | "danger"

const SEVERITY_ORDER: readonly Severity[] = ["normal", "warning", "danger"]

export function severity(percent: number): Severity {
  if (percent >= 85) return "danger"
  if (percent >= 70) return "warning"
  return "normal"
}

export function worstSeverity(windows: readonly LimitWindow[]): Severity {
  return windows.reduce<Severity>(
    (worst, window) => {
      const current = severity(window.percent)
      return SEVERITY_ORDER.indexOf(current) > SEVERITY_ORDER.indexOf(worst) ? current : worst
    },
    "normal",
  )
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`
}

export function formatReset(resetsAt: string | null, now: number): string {
  if (!resetsAt) return ""
  const minutes = Math.ceil((Date.parse(resetsAt) - now) / 60_000)
  if (!(minutes > 0)) return ""
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return hours % 24 > 0 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${Math.floor(hours / 24)}d`
  return minutes % 60 > 0 ? `${hours}h ${minutes % 60}m` : `${hours}h`
}

export function formatAge(fetchedAt: number, now: number): string {
  const minutes = Math.floor((now - fetchedAt) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

export function bar(percent: number, width: number): readonly [filled: string, empty: string] {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return ["█".repeat(filled), "░".repeat(width - filled)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
