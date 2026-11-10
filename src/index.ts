import { Plugin } from "@opencode/plugin"
import { fetchUsage } from "./claude"
import { ClaudeUsage } from "./rpc"
import { nextSnapshot, type Snapshot } from "./usage"

const DEFAULT_INTERVAL_SECONDS = 60
const MIN_INTERVAL_SECONDS = 15
const SESSION_DEBOUNCE_MS = 15_000
const MAX_BACKOFF_MS = 10 * 60_000

type Listener = (snapshot: Snapshot) => void

type Poller = {
  current(): Promise<Snapshot>
  refresh(): Promise<Snapshot>
  nudge(): void
  subscribe(listener: Listener): () => void
  stop(): void
}

function startPoller(intervalMs: number): Poller {
  let snapshot: Snapshot = { status: "loading" }
  let delay = intervalMs
  let lastStarted = 0
  let inflight: Promise<Snapshot> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<Listener>()
  const controller = new AbortController()

  const schedule = (ms: number) => {
    clearTimeout(timer)
    if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), ms)
  }

  const run = async () => {
    lastStarted = Date.now()
    const result = await fetchUsage(controller.signal)
    const rateLimited = !result.ok && result.error.reason === "rate-limited"
    delay = rateLimited ? Math.max(Math.min(delay * 2, MAX_BACKOFF_MS), result.retryAfterMs ?? 0) : intervalMs
    schedule(delay)
    const next = nextSnapshot(snapshot, result, Date.now())
    if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
      snapshot = next
      for (const listener of listeners) listener(next)
    }
    return snapshot
  }

  const refresh = () => (inflight ??= run().finally(() => (inflight = undefined)))

  void refresh()

  return {
    current: async () => (snapshot.status === "loading" ? refresh() : snapshot),
    refresh,
    nudge() {
      if (delay > intervalMs) return
      schedule(Math.max(0, lastStarted + SESSION_DEBOUNCE_MS - Date.now()))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stop() {
      controller.abort()
      clearTimeout(timer)
      listeners.clear()
    },
  }
}

// The server evaluates this module once per location, so module state is not shared. The poller
// lives on globalThis so the endpoint is polled once per process.
const SHARED = Symbol.for("opencode-claude-usage.poller")
type Shared = { poller: Poller; users: number }
const registry = globalThis as { [SHARED]?: Shared }

function acquirePoller(intervalMs: number) {
  const shared = (registry[SHARED] ??= { poller: startPoller(intervalMs), users: 0 })
  shared.users++
  let released = false
  const release = () => {
    if (released) return
    released = true
    if (--shared.users > 0) return
    shared.poller.stop()
    if (registry[SHARED] === shared) delete registry[SHARED]
  }
  return { poller: shared.poller, release }
}

function intervalMs(options: Readonly<Record<string, unknown>>) {
  const seconds = options.intervalSeconds
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return DEFAULT_INTERVAL_SECONDS * 1000
  return Math.max(MIN_INTERVAL_SECONDS, seconds) * 1000
}

export default Plugin.define({
  id: "claude-usage",
  async setup(ctx) {
    const { poller, release } = acquirePoller(intervalMs(ctx.options))
    const registration = await ctx.rpc.register(ClaudeUsage, {
      get: () => poller.current(),
      refresh: () => poller.refresh(),
    })
    const unsubscribe = poller.subscribe((snapshot) => {
      registration.events.emit("updated", snapshot).catch(() => {})
    })

    const events = new AbortController()
    void (async () => {
      for await (const _ of ctx.event.subscribe({
        types: ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"],
        signal: events.signal,
      }))
        poller.nudge()
    })().catch(() => {})

    return () => {
      events.abort()
      unsubscribe()
      release()
    }
  },
})
