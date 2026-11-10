import { describe, expect, test } from "bun:test"
import { acquireShared } from "./shared"

function fakePoller(name: string) {
  return {
    name,
    stopped: false,
    stop() {
      this.stopped = true
    },
  }
}

describe("acquireShared", () => {
  test("instances with the same key share one value until the last one releases", () => {
    const key = Symbol("same-code")
    const first = acquireShared(key, () => fakePoller("v1"))
    const second = acquireShared(key, () => fakePoller("v1"))
    expect(second.value).toBe(first.value)
    first.release()
    expect(first.value.stopped).toBe(false)
    second.release()
    expect(first.value.stopped).toBe(true)
  })

  test("a reload under a new key gets a new value while old instances still hold the old one", () => {
    const oldKey = Symbol("v1")
    const newKey = Symbol("v2")
    const firstLocation = acquireShared(oldKey, () => fakePoller("v1"))
    const secondLocation = acquireShared(oldKey, () => fakePoller("v1"))
    const reloaded = acquireShared(newKey, () => fakePoller("v2"))
    expect(reloaded.value.name).toBe("v2")
    firstLocation.release()
    expect(secondLocation.value.stopped).toBe(false)
    secondLocation.release()
    expect(secondLocation.value.stopped).toBe(true)
    expect(reloaded.value.stopped).toBe(false)
  })

  test("releasing twice counts once", () => {
    const key = Symbol("double-release")
    const first = acquireShared(key, () => fakePoller("v1"))
    const second = acquireShared(key, () => fakePoller("v1"))
    first.release()
    first.release()
    expect(second.value.stopped).toBe(false)
  })
})
