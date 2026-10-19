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
- **Cloud overflow (optional).** Tick *Cloud-overflow* in the dashboard (or `agent-slot config set cloudOverflow on`) and a refused *task* (tests, builds, subagents) also suggests handing it to a Claude Code cloud session. The bundled `cloud-overflow` skill walks the agent through it: push a base branch (asked first), build the task with `agent-slot overflow brief`, start a real cloud session (from the desktop app, or `claude --cloud` in your terminal), and register it with `agent-slot overflow add`. The worker delivers on an `overflow/…` branch with `Agent-Slots-Overflow` trailers and a final report commit. A cloud session can't talk back, so agent-slots watches GitHub every minute and posts the report into the session that started the task; the dashboard lists running and finished cloud workers. Dev servers and the browser stay local. Requires Claude Code cloud sessions (Pro/Max/Team) and a GitHub repo.
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

## Privacy and security

- **Secrets are masked** before anything is stored or shown: environment values (`API_KEY=***`, except harmless ones like `PORT` and `NODE_ENV`), `--token`/`--password`-style options, bearer tokens, credentials in URLs and well-known token formats. The command itself still runs unchanged; only labels, the log, the status, the dashboard and refusal messages are masked. `agent-slot scrub-log` masks an older log.
- **Private repos** work with cloud overflow as long as the cloud session can push (Claude GitHub App or `/web-setup`) and your local git can fetch. Keep in mind:
  - the whole repo is cloned into a cloud VM at Anthropic. Decide per project (and per client) whether that is acceptable; organisations with Zero Data Retention can't use cloud sessions at all;
  - the worker is *told* to push only to `overflow/…`, but that is not enforced. Turn on **branch protection for `main`** (changes only via pull request) and give the GitHub App access only to the repos you want;
  - `.env` is not in git and never goes along. Don't put secrets in the task text.
- Reports from cloud workers are delivered as fenced, untrusted data; merging always waits for your approval.

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
