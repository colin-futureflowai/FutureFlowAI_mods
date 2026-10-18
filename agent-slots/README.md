# agent-slots

Keeps Claude Code (and other coding agents) from starting more dev servers, test runs, browsers and sessions than your machine's memory can handle.

## What it does

- **Slots for heavy commands.** Dev servers, test/typecheck/build runs and browser sessions each have a limit (default: 2 dev, 1 test, 1 browser), shared across every session and worktree on the machine.
- **Memory floor.** Below 25% free memory, new heavy commands, sessions and workflows are refused; below 10%, new subagents too.
- **Automatic in Claude Code.** Heavy Bash commands are recognised (`pnpm dev`, `cd web && NODE_OPTIONS=… pnpm dev`, `vitest`, `tsc`, `npx playwright test`, …) and wrapped in `agent-slot run`, which holds the slot exactly as long as the process lives. Your existing permission rules still apply to the original command.
- **Clear refusals.** A refusal says who holds the slot, since when, and what to do next (`agent-slot wait dev`), so an agent waits instead of retrying or giving up.
- **Browser lock for the Playwright MCP**, tied to the session and released after 10 minutes without use or when the session ends.
- **Crash-safe.** Every slot records its process ID and start time; dead processes, reboots and reused PIDs never leave a slot stuck.
- **Dashboard.** `/agent-slots` opens a live pane in Claude Code: a memory bar, each slot type with who holds it, and the latest refusals (refreshed every 3 seconds).
- **Log and status.** Every acquire, release, refusal and clean-up goes to one log; `/agent-slots status` or `agent-slot status` shows the same as text.

If the mod itself fails (for example `node` can't be found), it lets everything through, shows a notice once, and writes the reason to `~/.claude/agent-slots-mod.log`.

Commands you type yourself with `!` are not affected. To switch it off for a session, start Claude Code with `AGENT_SLOT_BYPASS=1`.

## Install

```bash
claude plugin marketplace add colin-futureflowai/FutureFlowAI_mods
claude plugin install agent-slots@futureflowai-mods
```

Requires `node` on your PATH. Works on macOS, Linux and Windows (Windows is less tested).

### Other agents

Agents that are not Claude Code can use the same slots through the `agent-slot` command. Put it on your PATH once with `/agent-slots install` in Claude Code (it lands in `~/.local/bin`), then have those agents start heavy commands like this:

```bash
agent-slot run dev -- pnpm dev
agent-slot run test -- pnpm test
agent-slot wait dev        # blocks until a dev slot is free
agent-slot status
```

## Settings

Optional, in `~/.claude/agent-slots/config.json`:

```json
{
  "limits": { "dev": 2, "test": 1, "browser": 1 },
  "floorPercent": 25,
  "criticalPercent": 10,
  "browserIdleMinutes": 10,
  "waitTimeoutSeconds": 540
}
```

Free memory is read from `memory_pressure` on macOS, `MemAvailable` on Linux and the OS on Windows.

See [DESIGN.md](DESIGN.md) for how it works.
