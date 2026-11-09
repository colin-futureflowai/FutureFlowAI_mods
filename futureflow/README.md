# futureflow

FutureFlowAI's all-in-one Claude Code mod: fewer tokens in and out, a Mac that doesn't freeze, a branded look and progress you can see.

futureflow will replace the separate `agent-slots` and `minify` plugins. Until you uninstall those, futureflow detects them at session start and leaves their parts to the old plugin, so nothing runs twice.

## Install

```bash
claude plugin marketplace add /path/to/FutureFlowAI_mods
claude plugin install futureflow@futureflowai-mods
# when the old plugins are installed:
claude plugin uninstall agent-slots@futureflowai-mods minify@futureflowai-mods
```

Requires Claude Code 2.1.287 or newer. State lives in `~/.claude/futureflow/` (override with `FUTUREFLOW_HOME`).

## Skin

futureflow includes [claude-skins](https://github.com/hellosverre/claude-skins) (in `hooks/skins/`) with a FutureFlowAI skin as the default: your prompt in an outline, tool rows on a rail with `▸` to open them, shell and diff cards, tables, code, Mermaid charts and math as cards, a usage band above the prompt (context, 5h and 7d limits, Compact) and a turn footer. Light or dark follows Claude Code's theme (`/theme`).

- `/futureflow stijl` opens the Stijl tab: skin on/off, a few skins as buttons, the main parts as checkboxes and a button for all settings.
- `/futureflow stijl aan|uit|<skin>` switches from the command line.
- `/skin`, `/skin gallery` and `/skin help` are claude-skins' own settings, gallery and options (16 skins plus FutureFlowAI).

Settings live in the plugin store under `skins.prefs`. What changed against upstream is listed in `NOTICE`; every change in the code carries a `futureflow:` comment. Upstream updates are not pulled in automatically: diff against commit `cf0d39f` and re-apply those changes.

## Dashboard

`/futureflow` opens the dashboard with six tabs (hotkeys 1-6): Overview, Slots, Minify, Stijl (style), Connectors and API. `/futureflow <tab>` opens a tab directly.

## Progress

When Claude works through a task list (TaskCreate/TaskUpdate, TodoWrite, or the desktop app's plan), a progress bar sits above the prompt, in the same band as the skin's usage meters: `▰▰▰▱▱ 60% ▸ 3/5 <current step>`. Press `v` (or `/futureflow balk`) to expand it to all steps with the goal from your last prompt. When every step is done, or the desktop app wraps up the turn, it shows a ✓ line for 5 seconds and disappears. Only the main session counts; subagents' lists don't show.

An interactive terminal session has no task-list tool unless `CLAUDE_CODE_ENABLE_TODO_TOOLS=true` is set. The Style tab has a checkbox *Takenlijst in de terminal* that sets it for new sessions under `env` in `~/.claude/settings.json` (other settings and env entries stay; off removes only that entry).

## Connectors

The Connectors tab shows how many tokens each MCP server's tools take in this session's context, and lets you turn a server off for this project from the next session on, the same list `/mcp` uses (`disabledMcpServers` in `~/.claude.json`). The project is the git root of the session's folder (a worktree is its own project), otherwise the folder itself.

Only servers `/mcp` can turn off get a button: claude.ai connectors, plugin servers and servers from your own config (`mcpServers` in `~/.claude.json` or `.mcp.json`). Servers that come from the desktop app or from mods are counted on one "Intern (app en mods)" line without a button. The file is written atomically; if it is missing or not valid JSON, nothing is written.

## API

The API tab switches new terminal sessions between your Claude subscription and an Anthropic API key.

- The key lives in the macOS keychain (service `futureflow-anthropic-api`, account `futureflow`). It goes from the input straight to the keychain over stdin and is never stored, logged or shown; the tab only shows `sk-ant-…` plus the last 4 characters. While you type, the key is visible in the input. Like any `apiKeyHelper`, the keychain item can be read by other processes running as you.
- Switching to API sets `apiKeyHelper` in `~/.claude/settings.json` to `/usr/bin/security find-generic-password -s futureflow-anthropic-api -a futureflow -w`; switching back removes exactly that value. An `apiKeyHelper` of your own is never touched; futureflow then refuses to switch.
- It applies to **new terminal sessions** only. The running session keeps its login, and the desktop app keeps its own login and ignores the switch.
- In API mode Claude Code does not load your claude.ai connectors.
- Automatic switching (off by default): from 90% of the 5-hour or 7-day window new sessions use the API key; back to the subscription once that window has reset (or is measured under 50%) and no other window is still over the limit. Both thresholds are adjustable, and there are at least 5 minutes between two switches. A manual switch wins: switching back to the subscription by hand holds until the window that was over the limit resets, and a manual switch to API is never undone automatically; toggling automatic switching ends the hold.
- Costs for turns of sessions that run on the API are estimated per day and month from the published price list (per model, dated in `lib/api.mjs`). They are estimates, not your invoice, and there is no hard stop.

## Credits

- Minify is based on [Caveman](https://github.com/JuliusBrussee/caveman) (Apache-2.0, commit `9b68f7e`).
- The skin is [claude-skins](https://github.com/hellosverre/claude-skins) by hellosverre (MIT, 0.5.16, commit `cf0d39f`), included with changes.

See `NOTICE` for details.
