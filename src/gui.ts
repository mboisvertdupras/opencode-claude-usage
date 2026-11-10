import { Command, ComposerPill, Plugin, type ComposerPillTone, type ComposerPillView } from "@opencode/plugin/gui"
import { createSignal } from "solid-js"
import { ClaudeUsage } from "./rpc"
import {
  formatAge,
  formatPercent,
  formatReset,
  severity,
  staleError,
  worstSeverity,
  WINDOWS,
  type Severity,
  type Snapshot,
} from "./usage"

const TICK_MS = 30_000
const TITLE = "Claude usage"

const TONE: Record<Severity, ComposerPillTone | undefined> = {
  normal: undefined,
  warning: "warning",
  danger: "danger",
}

export default Plugin.define({
  setup(ctx) {
    const [snapshot, setSnapshot] = createSignal<Snapshot>({ status: "loading" })
    const [now, setNow] = createSignal(Date.now())

    // Poll the server part's cached snapshot instead of subscribing to its events: ctx.client is
    // replaced when the server restarts, and a fresh call each tick always uses the live client.
    const load = () =>
      ctx.client
        .rpc(ClaudeUsage)
        .get()
        .then(setSnapshot, () => {})
    const refresh = () =>
      void ctx.client
        .rpc(ClaudeUsage)
        .refresh()
        .then(setSnapshot, () => ctx.toast.show({ variant: "error", title: "Could not refresh Claude usage" }))

    void load()
    const tick = setInterval(() => {
      setNow(Date.now())
      void load()
    }, TICK_MS)

    const view = (): ComposerPillView | undefined => {
      const current = snapshot()
      switch (current.status) {
        case "loading":
          return undefined
        case "unavailable":
          return {
            label: `Claude ${current.error.reason}`,
            icon: "warning",
            tone: "warning",
            title: TITLE,
            rows: [{ id: "status", label: current.error.message, icon: "refresh", detail: "Refresh", run: refresh }],
          }
        case "ok":
          return {
            label: current.windows.map((window) => `${WINDOWS[window.kind].short} ${formatPercent(window.percent)}`).join(" · "),
            icon: "status",
            tone: TONE[worstSeverity(current.windows)],
            title: TITLE,
            rows: [
              ...current.windows.map((window) => {
                const reset = formatReset(window.resetsAt, now())
                return {
                  id: window.kind,
                  label: WINDOWS[window.kind].name,
                  icon: "status" as const,
                  tone: TONE[severity(window.percent)] ?? "success",
                  detail: reset ? `${formatPercent(window.percent)} · resets in ${reset}` : formatPercent(window.percent),
                }
              }),
              {
                id: "updated",
                label: staleError(current, now())?.message ?? `Updated ${formatAge(current.fetchedAt, now())}`,
                icon: "refresh",
                detail: "Refresh",
                run: refresh,
              },
            ],
          }
        default:
          return current satisfies never
      }
    }

    ctx.add(ComposerPill, { id: "usage", show: view })
    ctx.add(Command, { id: "refresh", title: "Refresh Claude usage", keywords: "claude usage limits quota", run: refresh })

    return () => clearInterval(tick)
  },
})
