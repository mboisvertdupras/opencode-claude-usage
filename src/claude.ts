import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { parseUsage, type FetchResult, type UsageError } from "./usage"

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const KEYCHAIN_SERVICE = "Claude Code-credentials"

type Credentials = { accessToken: string; expiresAt: number | undefined }

export async function fetchUsage(signal: AbortSignal): Promise<FetchResult> {
  const credentials = await readCredentials()
  if (!credentials) return fail("no-credentials", "No Claude Code login found. Run `claude` and sign in.")
  if (credentials.expiresAt !== undefined && credentials.expiresAt <= Date.now())
    return fail("expired", "Claude Code token expired. It refreshes the next time Claude Code runs.")

  let response: Response
  try {
    response = await fetch(USAGE_URL, {
      headers: { authorization: `Bearer ${credentials.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
      signal,
    })
  } catch (error) {
    return fail("network", error instanceof Error ? error.message : "Network error")
  }

  if (response.status === 401 || response.status === 403)
    return fail("unauthorized", `Claude rejected the token (HTTP ${response.status})`)
  if (response.status === 429)
    return { ...fail("rate-limited", "Rate limited by the usage endpoint"), retryAfterMs: retryAfterMs(response) }
  if (!response.ok) return fail("http", `Usage endpoint returned HTTP ${response.status}`)

  try {
    return { ok: true, windows: parseUsage(await response.json()) }
  } catch {
    return fail("http", "Usage endpoint returned invalid JSON")
  }
}

async function readCredentials(): Promise<Credentials | undefined> {
  const raw = (process.platform === "darwin" ? await readKeychain() : undefined) ?? (await readCredentialsFile())
  if (!raw) return undefined
  try {
    const oauth = JSON.parse(raw)?.claudeAiOauth
    if (typeof oauth?.accessToken !== "string" || !oauth.accessToken) return undefined
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined,
    }
  } catch {
    return undefined
  }
}

async function readKeychain(): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"])
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

async function readCredentialsFile(): Promise<string | undefined> {
  const directory = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")
  try {
    return await readFile(join(directory, ".credentials.json"), "utf8")
  } catch {
    return undefined
  }
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"))
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined
}

function fail(reason: UsageError["reason"], message: string) {
  return { ok: false as const, error: { reason, message } }
}
