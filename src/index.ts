import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"
import { startPoller } from "./poller"
import { ClaudeUsage } from "./rpc"
import { acquireShared } from "./shared"

const DEFAULT_INTERVAL_SECONDS = 120
const MIN_INTERVAL_SECONDS = 15
const CACHE_FILE = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "opencode-claude-usage", "poller.json")

const SOURCE_DIR = fileURLToPath(new URL(".", import.meta.url))
const CODE = createHash("sha256")
  .update(
    readdirSync(SOURCE_DIR)
      .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
      .sort()
      .map((name) => readFileSync(join(SOURCE_DIR, name), "utf8"))
      .join("\0"),
  )
  .digest("hex")
const SHARED = Symbol.for(`opencode-claude-usage.poller.${CODE}`)

function intervalMs(options: Readonly<Record<string, unknown>>) {
  const seconds = options.intervalSeconds
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return DEFAULT_INTERVAL_SECONDS * 1000
  return Math.max(MIN_INTERVAL_SECONDS, seconds) * 1000
}

export default Plugin.define({
  id: "claude-usage",
  async setup(ctx) {
    const interval = intervalMs(ctx.options)
    const { value: poller, release } = acquireShared(SHARED, () => startPoller(interval, CACHE_FILE))
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
