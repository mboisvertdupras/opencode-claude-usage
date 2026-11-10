type Slot<T> = { value: T; users: number }

// OpenCode evaluates the server module once per location and again on every reload, so module state is
// neither shared nor reset. The value lives on globalThis under a key that callers derive from their code,
// so a reload never picks up a value that older code created.
export function acquireShared<T extends { stop(): void }>(key: symbol, create: () => T) {
  const registry = globalThis as { [key: symbol]: Slot<T> | undefined }
  const slot = (registry[key] ??= { value: create(), users: 0 })
  slot.users++
  let released = false
  return {
    value: slot.value,
    release() {
      if (released) return
      released = true
      if (--slot.users > 0) return
      slot.value.stop()
      if (registry[key] === slot) delete registry[key]
    },
  }
}
