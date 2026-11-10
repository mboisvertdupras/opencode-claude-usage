import { OpenCode } from "@opencode/client"
import { ClaudeUsage } from "../src/rpc"

const [url, password, directory] = process.argv.slice(2)
if (!url || !directory) throw new Error("usage: bun scripts/rpc-probe.ts <url> <password> <directory>")

const client = OpenCode.make({
  baseUrl: url,
  headers: password ? { authorization: `Basic ${btoa(`opencode:${password}`)}` } : undefined,
})
const usage = client.rpc(ClaudeUsage)
const location = { directory }

const events: unknown[] = []
const stop = usage.events.on("updated", (event) => void events.push({ type: event.type, data: event.data }))

console.log("get:", JSON.stringify(await usage.get(undefined, { location })))
console.log("refresh:", JSON.stringify(await usage.refresh(undefined, { location })))
await new Promise((resolve) => setTimeout(resolve, 1500))
stop()
console.log("updated events seen:", events.length, JSON.stringify(events.at(-1)))
