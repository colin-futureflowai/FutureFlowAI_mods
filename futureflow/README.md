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

`/futureflow` opens the dashboard with seven tabs (hotkeys 1-7): Overview, Slots, Minify, Stijl (style), Connectors, API and Accounts. `/futureflow <tab>` opens a tab directly.

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

## Accounts

The Accounts tab (`/accounts`, or hotkey 7 in `/futureflow`) switches terminal sessions between your own Claude subscriptions. Each account is a separately paid subscription that you added yourself; futureflow never logs in for you.

- **Adding an account.** Log in with `/login` in a terminal session, then press *Huidige login toevoegen* (or `/accounts toevoegen`). futureflow checks with Anthropic that the token belongs to the identity in `~/.claude.json` and stores a copy. **Never use `/logout` between accounts**: it can revoke the stored login of the account you leave. To add a second account, just `/login` again.
- **Secrets stay in the macOS keychain**, under futureflow's own items: `futureflow-accounts` (the copy per account), `futureflow-accounts-vorige` (the previous generation) and `futureflow-accounts-redding` (a live login that belonged to no known account), keyed `<accountUuid>:<organizationUuid>`. The copy excludes the machine-wide keys (`mcpOAuth`, `pluginSecrets`, …) and goes to `security -i` over stdin. Only the live item `Claude Code-credentials` (about 12 KB with MCP logins) is too long for one stdin line; it goes hex-encoded via argv, the way Claude Code itself writes it. Nothing secret is written to a file, the plugin store, a log, a toast or the screen; e-mail addresses are masked (`co…@domain`).
- **State** lives in `~/.claude/futureflow/accounts/` (folder 700; the CLI writes its files 600): `accounts.json`, `gebruik.json` (usage and poll plan), `config/` (a copy of `oauthAccount` per account), `sessies/` (one busy/idle file per terminal session) and `log.jsonl`.
- **Usage** per account comes from Anthropic's OAuth usage endpoint. The accounts are also used on other machines, so futureflow polls sparingly: at most once per 6 minutes per account, 15 minutes for an idle account, 20 minutes for an exhausted one, and at least 10 minutes (×1.5 up to 30 minutes) after a 429. The tab shows the age of every measurement; automatic switching only decides on measurements younger than 15 minutes.
- **Switching by hand**: *Wissel hierheen* on a row, or `/accounts wissel <n>`. New terminal sessions use the new account; running terminal sessions pick it up within about 30 seconds. The desktop app keeps its own login: there the tab is read-only.
- **Automatic switching** (off by default) before a limit: when the active account reaches its margin (90% of the 5-hour or 7-day window, adjustable 50-99), futureflow first switches to another account in the rotation with the most room (at least 10 points more). Only when every account in the rotation is over its margin does it switch to your API key, through the API tab (its own thresholds and settings apply). Back from the API to a subscription as soon as one has room again. At least 5 minutes between switches; a manual choice in the API tab wins. Mode *Stil* switches between turns with a toast; *Eerst vragen* shows a question above the prompt with *Wissel* / *Niet nu* (not again for 30 minutes).
- **Never mid-turn.** A switch waits until no terminal session is in the middle of a turn: futureflow's own session files plus Claude Code's own `~/.claude/sessions/<pid>.json` (so sessions without futureflow count too). After 10 minutes of waiting it gives up with a notice and tries again after the next turn.
- **Terminal only, standard profile only.** Sessions with `CLAUDE_CONFIG_DIR` or `CLAUDE_SECURESTORAGE_CONFIG_DIR` can only look.

The keychain, `~/.claude.json`, Claude Code's locks and the network are handled by `cli/accounts.mjs` (Node built-ins only); run it with `status --json` to see what the tab sees.

## Credits

- Minify is based on [Caveman](https://github.com/JuliusBrussee/caveman) (Apache-2.0, commit `9b68f7e`).
- The skin is [claude-skins](https://github.com/hellosverre/claude-skins) by hellosverre (MIT, 0.5.16, commit `cf0d39f`), included with changes.
- Accounts follows [claude-swap](https://github.com/realiti4/claude-swap) by Onur Cetinkol (MIT, commit `5ac68bfb`): the lock protocol, the keychain write shape, the order of a switch and the shape of the usage poll policy, reimplemented with slower polling.

See `NOTICE` for details.
