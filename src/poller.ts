import { fetchUsage } from "./claude"
import { nextSnapshot, type Snapshot } from "./usage"

const STALE_AFTER_INTERVALS = 2
const SESSION_DEBOUNCE_MS = 15_000
const MAX_BACKOFF_MS = 10 * 60_000

type Listener = (snapshot: Snapshot) => void

export type Poller = {
  current(): Promise<Snapshot>
  refresh(): Promise<Snapshot>
  nudge(): void
  subscribe(listener: Listener): () => void
  stop(): void
}

export function startPoller(intervalMs: number): Poller {
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
    const next = nextSnapshot(snapshot, result, Date.now(), intervalMs * STALE_AFTER_INTERVALS)
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
