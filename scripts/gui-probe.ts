import { readFileSync } from "node:fs"
import { OpenCode } from "@opencode/client"
import * as gui from "@opencode/plugin/gui"
import * as rpc from "@opencode/plugin/rpc"
import * as effect from "effect"
import * as solid from "solid-js"

const [url, password] = process.argv.slice(2)
if (!url) throw new Error("usage: bun scripts/gui-probe.ts <url> <password>")

const modules: Record<string, unknown> = {
  "@opencode/plugin/gui": gui,
  "@opencode/plugin/rpc": rpc,
  effect,
  "solid-js": solid,
}
const bundle = readFileSync(new URL("../dist/gui-experimental.cjs", import.meta.url), "utf8")
const module = { exports: {} as { default?: unknown } }
Function("require", "module", "exports", bundle)(
  (id: string) => {
    if (!(id in modules)) throw new Error(`bundle required a module the host does not provide: ${id}`)
    return modules[id]
  },
  module,
  module.exports,
)
const definition = (module.exports.default ?? module.exports) as { setup(ctx: unknown): () => void }

const client = OpenCode.make({
  baseUrl: url,
  headers: password ? { authorization: `Basic ${btoa(`opencode:${password}`)}` } : undefined,
})
const added: { registry: unknown; item: any }[] = []
const toasts: unknown[] = []

const cleanup = solid.createRoot(() =>
  definition.setup({
    id: "claude-usage",
    options: {},
    app: { platform: "web" },
    get client() {
      return client
    },
    add: (registry: unknown, item: unknown) => {
      added.push({ registry, item })
      return () => {}
    },
    toast: { show: (toast: unknown) => toasts.push(toast) },
  }),
)

const pill = added.find((entry) => entry.registry === gui.ComposerPill)?.item
const command = added.find((entry) => entry.registry === gui.Command)?.item
const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(100)
}

await until(() => pill.show({}) !== undefined)
const view = pill.show({})
console.log("pill:", JSON.stringify({ label: view?.label, tone: view?.tone, icon: view?.icon, title: view?.title }))
for (const row of view?.rows ?? []) console.log("  row:", JSON.stringify({ ...row, run: typeof row.run }))
console.log("command:", JSON.stringify({ id: command?.id, title: command?.title }))

const before = view?.rows?.at(-1)?.label
view?.rows?.at(-1)?.run?.()
await until(() => pill.show({})?.rows?.at(-1)?.label !== before || toasts.length > 0)
console.log("after refresh row:", pill.show({})?.rows?.at(-1)?.label, "toasts:", JSON.stringify(toasts))
cleanup()
