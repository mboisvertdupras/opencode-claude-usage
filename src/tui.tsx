/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { createSignal, Show } from "solid-js"
import { ClaudeUsage } from "./rpc"
import { bar, formatPercent, formatReset, severity, staleError, WINDOWS, type Severity, type Snapshot } from "./usage"

const BAR_WIDTH = 10
const CLOCK_MS = 30_000
const RETRY_MS = 5_000

const TONE = {
  normal: (theme) => theme.text.feedback.success.base,
  warning: (theme) => theme.text.feedback.warning.base,
  danger: (theme) => theme.text.feedback.error.base,
} satisfies Record<Severity, (theme: Context["theme"]) => unknown>

export default Plugin.define({
  id: "claude-usage.tui",
  setup(context) {
    const location = context.location ?? context.data.location.default()
    const usage = () => context.client.rpc(ClaudeUsage)
    const [snapshot, setSnapshot] = createSignal<Snapshot>({ status: "loading" })
    const [now, setNow] = createSignal(Date.now())

    let retry: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      usage()
        .get(undefined, { location })
        .then(setSnapshot, () => {
          retry = setTimeout(load, RETRY_MS)
        })
    void load()

    const stopEvents = usage().events.on("updated", (event) => void setSnapshot(event.data))
    const clock = setInterval(() => setNow(Date.now()), CLOCK_MS)

    const view = () => {
      const theme = context.theme
      const current = snapshot()
      switch (current.status) {
        case "loading":
          return null
        case "unavailable":
          return <span style={{ fg: theme.text.muted }}>Claude usage: {current.error.reason}</span>
        case "ok": {
          const stale = staleError(current, now())
          return [
            ...current.windows.flatMap((window, index) => {
              const tone = TONE[severity(window.percent)](theme)
              const [filled, empty] = bar(window.percent, BAR_WIDTH)
              const reset = formatReset(window.resetsAt, now())
              const info = WINDOWS[window.kind]
              return [
                index > 0 && <span style={{ fg: theme.text.faint }}> │ </span>,
                <span style={{ fg: theme.text.muted }}>{info.label} </span>,
                <span style={{ fg: tone }}>{filled}</span>,
                <span style={{ fg: theme.text.faint }}>{empty}</span>,
                <span style={{ fg: tone }}> {formatPercent(window.percent)}</span>,
                reset && <span style={{ fg: theme.text.muted }}> ({reset} / {info.short})</span>,
              ]
            }),
            stale && <span style={{ fg: theme.text.faint }}> · stale: {stale.reason}</span>,
          ]
        }
        default:
          return current satisfies never
      }
    }
    const Line = () => (
      <text wrapMode="none" truncate>
        {view()}
      </text>
    )

    context.ui.slot({ append: "home.footer.status", render: () => <Line /> })
    context.ui.slot({ append: "prompt.footer.status", render: (input) => (
        <Show when={input.sessionID}>
          <Line />
        </Show>
      ), })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "claude-usage.refresh",
          title: "Refresh Claude usage",
          group: "Claude",
          palette: true,
          run: async () => {
            try {
              setSnapshot(await usage().refresh(undefined, { location }))
            } catch {
              context.ui.toast.show({ message: "Could not reach the Claude usage plugin", variant: "error" })
            }
          },
        },
      ],
    }))

    return () => {
      clearTimeout(retry)
      clearInterval(clock)
      stopEvents()
    }
  },
})
