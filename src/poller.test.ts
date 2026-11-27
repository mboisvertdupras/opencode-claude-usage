import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FetchResult } from "./usage"

let result: FetchResult
let calls = 0

mock.module("./claude", () => ({
  fetchUsage: async () => {
    calls++
    return result
  },
}))

const { startPoller } = await import("./poller")

const INTERVAL = 60_000
const WINDOWS = [{ kind: "seven_day" as const, percent: 9, resetsAt: null }]

let dir: string
let cacheFile: string
const pollers: { stop(): void }[] = []

function start() {
  const poller = startPoller(INTERVAL, cacheFile)
  pollers.push(poller)
  return poller
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "claude-usage-"))
  cacheFile = join(dir, "poller.json")
  calls = 0
})

afterEach(() => {
  for (const poller of pollers.splice(0)) poller.stop()
  rmSync(dir, { recursive: true, force: true })
})

test("a restarted poller keeps the last numbers and does not poll early", async () => {
  result = { ok: true, windows: WINDOWS }
  const first = start()
  expect(await first.current()).toMatchObject({ status: "ok", windows: WINDOWS })
  first.stop()

  result = { ok: false, error: { reason: "expired", message: "expired" } }
  const second = start()
  expect(await second.current()).toMatchObject({ status: "ok", windows: WINDOWS })
  expect(calls).toBe(1)
})

test("a restarted poller honors a saved rate-limit backoff", async () => {
  result = { ok: false, error: { reason: "rate-limited", message: "429" }, retryAfterMs: 30 * 60_000 }
  const first = start()
  const saved = await first.current()
  expect(saved).toMatchObject({ status: "unavailable", error: { reason: "rate-limited" } })
  first.stop()

  const second = start()
  second.nudge()
  await Bun.sleep(50)
  expect(calls).toBe(1)
  expect(await second.current()).toEqual(saved)
})

test("without a cache file the poller fetches right away", async () => {
  result = { ok: true, windows: WINDOWS }
  start()
  await Bun.sleep(10)
  expect(calls).toBe(1)
})
