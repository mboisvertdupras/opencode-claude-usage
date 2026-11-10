import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  bar,
  formatReset,
  nextSnapshot,
  parseUsage,
  severity,
  Snapshot,
  staleError,
  worstSeverity,
  type UsageError,
} from "./usage"

const NOW = Date.parse("2026-11-10T12:00:00Z")
const at = (ms: number) => new Date(NOW + ms).toISOString()
const MINUTE = 60_000
const HOUR = 60 * MINUTE

describe("parseUsage", () => {
  test("reads both windows and ignores unknown fields", () => {
    const json = {
      five_hour: { utilization: 27, resets_at: "2026-11-10T21:00:00.162998+00:00" },
      seven_day: { utilization: 42, resets_at: "2026-11-10T22:00:00.163018+00:00", extra: true },
      seven_day_opus: { utilization: 99, resets_at: null },
      something_new: "x",
    }
    expect(parseUsage(json)).toEqual([
      { kind: "five_hour", percent: 27, resetsAt: "2026-11-10T21:00:00.162998+00:00" },
      { kind: "seven_day", percent: 42, resetsAt: "2026-11-10T22:00:00.163018+00:00" },
    ])
  })

  test("drops null windows and keeps the other", () => {
    expect(parseUsage({ five_hour: null, seven_day: { utilization: 5, resets_at: null } })).toEqual([
      { kind: "seven_day", percent: 5, resetsAt: null },
    ])
  })

  test("drops windows without a numeric utilization", () => {
    expect(
      parseUsage({ five_hour: { utilization: "27" }, seven_day: { utilization: Number.NaN, resets_at: "x" } }),
    ).toEqual([])
  })

  test("treats a non-string resets_at as unknown", () => {
    expect(parseUsage({ five_hour: { utilization: 1, resets_at: 123 } })).toEqual([
      { kind: "five_hour", percent: 1, resetsAt: null },
    ])
  })

  test("returns nothing for junk bodies", () => {
    for (const junk of [null, undefined, 42, "text", [], { error: "nope" }]) expect(parseUsage(junk)).toEqual([])
  })
})

describe("severity", () => {
  test.each([
    [0, "normal"],
    [69, "normal"],
    [69.9, "normal"],
    [70, "warning"],
    [84, "warning"],
    [85, "danger"],
    [100, "danger"],
  ] as const)("%p%% is %s", (percent, expected) => {
    expect(severity(percent)).toBe(expected)
  })

  test("worst window wins", () => {
    const window = (percent: number) => ({ kind: "five_hour" as const, percent, resetsAt: null })
    expect(worstSeverity([])).toBe("normal")
    expect(worstSeverity([window(10), window(72)])).toBe("warning")
    expect(worstSeverity([window(90), window(72)])).toBe("danger")
  })
})

describe("formatReset", () => {
  test.each([
    [12 * MINUTE, "12m"],
    [30 * 1000, "1m"],
    [59 * MINUTE, "59m"],
    [60 * MINUTE, "1h"],
    [4 * HOUR + 33 * MINUTE, "4h 33m"],
    [24 * HOUR, "1d"],
    [3 * 24 * HOUR + 4 * HOUR, "3d 4h"],
  ])("%p ms ahead reads %s", (ahead, expected) => {
    expect(formatReset(at(ahead), NOW)).toBe(expected)
  })

  test("past, missing, and unparseable times read as empty", () => {
    expect(formatReset(at(-5 * MINUTE), NOW)).toBe("")
    expect(formatReset(at(0), NOW)).toBe("")
    expect(formatReset(null, NOW)).toBe("")
    expect(formatReset("not a date", NOW)).toBe("")
  })
})

describe("bar", () => {
  test("fills proportionally and clamps", () => {
    expect(bar(25, 10)).toEqual(["███", "░░░░░░░"])
    expect(bar(0, 4)).toEqual(["", "░░░░"])
    expect(bar(140, 4)).toEqual(["████", ""])
    expect(bar(-3, 4)).toEqual(["", "░░░░"])
  })
})

describe("nextSnapshot", () => {
  const windows = [{ kind: "five_hour" as const, percent: 27, resetsAt: null }]
  const expired: UsageError = { reason: "expired", message: "Claude Code token expired" }
  const STALE_AFTER = 4 * MINUTE

  test("a success replaces whatever was there and sets the stale deadline", () => {
    expect(nextSnapshot({ status: "loading" }, { ok: true, windows }, NOW, STALE_AFTER)).toEqual({
      status: "ok",
      windows,
      fetchedAt: NOW,
      staleAt: NOW + STALE_AFTER,
    })
  })

  test("a failure after good numbers keeps them and their stale deadline", () => {
    const good = nextSnapshot({ status: "loading" }, { ok: true, windows }, NOW, STALE_AFTER)
    expect(nextSnapshot(good, { ok: false, error: expired }, NOW + HOUR, STALE_AFTER)).toEqual({
      status: "ok",
      windows,
      fetchedAt: NOW,
      staleAt: NOW + STALE_AFTER,
      error: expired,
    })
  })

  test("a failure with no good numbers is unavailable", () => {
    expect(nextSnapshot({ status: "loading" }, { ok: false, error: expired }, NOW, STALE_AFTER)).toEqual({
      status: "unavailable",
      error: expired,
      fetchedAt: NOW,
    })
  })

  test("every snapshot it produces passes the RPC schema", () => {
    const decode = Schema.decodeUnknownSync(Snapshot)
    const good = nextSnapshot({ status: "loading" }, { ok: true, windows }, NOW, STALE_AFTER)
    for (const snapshot of [
      { status: "loading" } as const,
      good,
      nextSnapshot(good, { ok: false, error: expired }, NOW, STALE_AFTER),
      nextSnapshot({ status: "loading" }, { ok: false, error: expired }, NOW, STALE_AFTER),
    ])
      expect(decode(snapshot)).toEqual(snapshot)
    expect(() =>
      decode({ status: "ok", windows: [{ kind: "monthly", percent: 1, resetsAt: null }], fetchedAt: 1, staleAt: 2 }),
    ).toThrow()
  })
})

describe("staleError", () => {
  const windows = [{ kind: "five_hour" as const, percent: 27, resetsAt: null }]
  const limited: UsageError = { reason: "rate-limited", message: "Rate limited by the usage endpoint" }
  const STALE_AFTER = 4 * MINUTE
  const good = nextSnapshot({ status: "loading" }, { ok: true, windows }, NOW, STALE_AFTER)
  const failed = nextSnapshot(good, { ok: false, error: limited }, NOW + MINUTE, STALE_AFTER)
  if (good.status !== "ok" || failed.status !== "ok") throw new Error("expected ok snapshots")

  test("a failed refresh is hidden while the numbers are younger than the deadline", () => {
    expect(staleError(failed, NOW + MINUTE)).toBeUndefined()
    expect(staleError(failed, NOW + STALE_AFTER - 1)).toBeUndefined()
  })

  test("a failed refresh shows once the numbers reach the deadline", () => {
    expect(staleError(failed, NOW + STALE_AFTER)).toEqual(limited)
  })

  test("old numbers with no failed refresh are not stale", () => {
    expect(staleError(good, NOW + HOUR)).toBeUndefined()
  })
})
