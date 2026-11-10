# opencode-claude-usage

Shows your Claude subscription's 5-hour and weekly usage limits inside OpenCode, the way claude-hud shows them in
Claude Code.

- **TUI.** A line in the footer on the home screen and under the prompt in a session:
  `Usage ████░░░░░░ 41% (4h 26m / 5h) │ Weekly ████░░░░░░ 43% (5h 26m / 7d)`.
  Bars take the theme's warning color from 70% and its error color from 85%. The palette has **Refresh Claude usage**.
- **Desktop.** A pill above the composer, such as `5h 41% · 7d 43%`. Its menu lists each window with the time
  until it resets and a row to refresh. The palette has **Refresh Claude usage**.

## Install

Add the plugin to your global `~/.config/opencode/opencode.json`. OpenCode Desktop only loads GUI parts from the
global config.

```jsonc
{
  "plugins": ["/path/to/opencode-claude-usage"],
}
```

Build the Desktop bundle once, and again after changing `src/gui.ts`:

```bash
bun install
bun run build
```

## Options

```jsonc
{
  "plugins": [{ "package": "/path/to/opencode-claude-usage", "options": { "intervalSeconds": 300 } }],
}
```

- `intervalSeconds` sets how often the server polls. Default 120, minimum 15.

The server also refreshes when a session finishes, at most once every 15 seconds. A 429 from the endpoint doubles
the interval, up to 10 minutes, and waits at least as long as its `Retry-After` header.

A failed refresh keeps the last numbers. They get a `stale` marker only once they are older than two intervals, so a
single missed poll doesn't flag numbers that are still fresh.

## Credentials

The plugin reuses Claude Code's login. On macOS it reads the `Claude Code-credentials` keychain item. Elsewhere it reads
`$CLAUDE_CONFIG_DIR/.credentials.json`, falling back to `~/.claude/.credentials.json`.

It never refreshes the token, because a refresh rotates Claude Code's refresh token and can sign you out of Claude Code.
When the token has expired, the plugin keeps the last numbers and marks them stale until Claude Code runs again and
refreshes it. The token is only sent to `api.anthropic.com` and is never logged or stored.

## Caveats

The numbers come from `GET https://api.anthropic.com/api/oauth/usage`. The endpoint is
undocumented and may change or disappear without notice. It also rate-limits aggressively. Other tools that poll it with
the same login likely draw on the same limit, so a long run of 429s shows as `stale: rate-limited`.

## Development

```bash
bun test          # usage model tests
bun run typecheck
bun run build     # dist/gui-experimental.cjs
bun scripts/rpc-probe.ts <server-url> <password> <directory>    # call the RPC on a running server
bun scripts/gui-probe.ts <server-url> <password>                # load the GUI bundle like the desktop host
bun scripts/nudge-probe.ts <server-url> <password> <directory>  # check the after-session refresh
```
