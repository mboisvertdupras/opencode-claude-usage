import { OpenCode } from "@opencode/client"
import { ClaudeUsage } from "../src/rpc"

const [url, password, directory, seconds = "40"] = process.argv.slice(2)
if (!url || !directory) throw new Error("usage: bun scripts/nudge-probe.ts <url> <password> <directory> [seconds]")

const client = OpenCode.make({
  baseUrl: url,
  headers: password ? { authorization: `Basic ${btoa(`opencode:${password}`)}` } : undefined,
})
const start = Date.now()
const t = () => `+${((Date.now() - start) / 1000).toFixed(1)}s`

const stopUsage = client.rpc(ClaudeUsage).events.on("updated", (event) => {
  const data = event.data
  console.log(t(), "usage updated", data.status, data.status === "ok" ? data.error?.reason ?? "fresh" : "")
})
const stopSessions = new AbortController()
void (async () => {
  for await (const event of client.event.subscribe({
    types: ["session.execution.started", "session.execution.succeeded"],
    signal: stopSessions.signal,
  }))
    console.log(t(), event.type)
})().catch(() => {})

console.log(t(), "initial", (await client.rpc(ClaudeUsage).get(undefined, { location: { directory } })).status)
await Bun.sleep(20_000)
const session = await client.session.create({ title: "nudge probe", location: { directory } })
await client.session.prompt({ sessionID: session.id, text: "Reply with the single word ok and nothing else" })
console.log(t(), "prompt sent")
await Bun.sleep(Number(seconds) * 1000)
stopUsage()
stopSessions.abort()
