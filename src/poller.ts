import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { Option, Schema } from "effect"
import { fetchUsage } from "./claude"
import { nextSnapshot, Saved, type Snapshot } from "./usage"

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

const decodeSaved = Schema.decodeUnknownOption(Saved)

function load(cacheFile: string): Saved | undefined {
  try {
    return Option.getOrUndefined(decodeSaved(JSON.parse(readFileSync(cacheFile, "utf8"))))
  } catch {
    return undefined
  }
}

function save(cacheFile: string, saved: Saved) {
  try {
    mkdirSync(dirname(cacheFile), { recursive: true })
    const tmp = `${cacheFile}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(saved))
    renameSync(tmp, cacheFile)
  } catch {}
}

export function startPoller(intervalMs: number, cacheFile: string): Poller {
  const saved = load(cacheFile)
  let snapshot: Snapshot = saved?.snapshot ?? { status: "loading" }
  let delay = Math.max(saved?.delay ?? 0, intervalMs)
  let lastStarted = saved?.lastStarted ?? 0
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
    if (!controller.signal.aborted) save(cacheFile, { snapshot, delay, lastStarted })
    return snapshot
  }

  const refresh = () => (inflight ??= run().finally(() => (inflight = undefined)))

  schedule(Math.max(0, lastStarted + delay - Date.now()))

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
