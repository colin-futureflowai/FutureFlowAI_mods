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

`/futureflow` opens the dashboard with four tabs (hotkeys 1-4): **Overzicht** (overview, read-only), **Wisselen** (the *Automatisch wisselen* card and one *Bronnen* list: subscription, other accounts, Anthropic API and OpenRouter, each with *Gebruik nu*; keys, models and advanced settings under *Meer ▸*), **Zuinig** (Slots and Minify) and **Instellingen** (style and connectors). *Meer ▸* (hotkey `m`) shows the details of a tab. `/futureflow <tab>` opens a tab directly; the old tab names (`api`, `accounts`, `openrouter`, `slots`, `minify`, `stijl`, `connectors`) still work and open the tab that now holds them.

## Progress

When Claude works through a task list (TaskCreate/TaskUpdate, TodoWrite, or the desktop app's plan), a progress bar sits above the prompt, in the same band as the skin's usage meters: `▰▰▰▱▱ 60% ▸ 3/5 <current step>`. Press `v` (or `/futureflow balk`) to expand it to all steps with the goal from your last prompt. When every step is done, or the desktop app wraps up the turn, it shows a ✓ line for 5 seconds and disappears. Only the main session counts; subagents' lists don't show.

An interactive terminal session has no task-list tool unless `CLAUDE_CODE_ENABLE_TODO_TOOLS=true` is set. The Style tab has a checkbox *Takenlijst in de terminal* that sets it for new sessions under `env` in `~/.claude/settings.json` (other settings and env entries stay; off removes only that entry).

## Connectors

The Connectors tab shows how many tokens each MCP server's tools take in this session's context, and lets you turn a server off for this project from the next session on, the same list `/mcp` uses (`disabledMcpServers` in `~/.claude.json`). The project is the git root of the session's folder (a worktree is its own project), otherwise the folder itself.

Only servers `/mcp` can turn off get a button: claude.ai connectors, plugin servers and servers from your own config (`mcpServers` in `~/.claude.json` or `.mcp.json`). Servers that come from the desktop app or from mods are counted on one "Intern (app en mods)" line without a button. The file is written atomically; if it is missing or not valid JSON, nothing is written.

## API

The API part of the Wisselen tab switches new terminal sessions between your Claude subscription and an Anthropic API key.

- The key lives in the macOS keychain (service `futureflow-anthropic-api`, account `futureflow`). It goes from the input straight to the keychain over stdin and is never stored, logged or shown; the tab only shows `sk-ant-…` plus the last 4 characters. While you type, the key is visible in the input. Like any `apiKeyHelper`, the keychain item can be read by other processes running as you.
- Switching to API sets `apiKeyHelper` in `~/.claude/settings.json` to `/usr/bin/security find-generic-password -s futureflow-anthropic-api -a futureflow -w`; switching back removes exactly that value. An `apiKeyHelper` of your own is never touched; futureflow then refuses to switch.
- It applies to **new terminal sessions** only. The running session keeps its login, and the desktop app keeps its own login and ignores the switch.
- In API mode Claude Code does not load your claude.ai connectors.
- Automatic switching (off by default): from 90% of the 5-hour or 7-day window new sessions use the API key; back to the subscription once that window has reset (or is measured under 50%) and no other window is still over the limit. Both thresholds are adjustable, and there are at least 5 minutes between two switches. A manual switch wins: switching back to the subscription by hand holds until the window that was over the limit resets, and a manual switch to API is never undone automatically; toggling automatic switching ends the hold.
- Costs for turns of sessions that run on the API are estimated per day and month from the published price list (per model, dated in `lib/api.mjs`). They are estimates, not your invoice, and there is no hard stop.

## Automatic switching (one card)

The Wisselen tab shows the card *Automatisch wisselen*: one on/off switch (it turns automatic switching for the API and for the accounts on or off together), where new terminal sessions run now, and the chain as a numbered list with live state — 1. your subscription (5h and 7d usage), 2. another subscription (account and its room), 3. Anthropic API (key), 4. OpenRouter (model). The current step is marked `← nu`; steps that are off say `(uit)`, steps that cannot run say why. Each step after the first has its own checkbox (API and OpenRouter can be reordered). One threshold, *Wissel vanaf %*, sets both the API threshold and the 5h/7d margins of the accounts; *Terug onder %* sets when to go back. Separate 5h/7d margins are under *Meer ▸* in *Abonnementen: geavanceerd*. Settings from before 0.8.0 migrate: if accounts switching was on, the switch is on.

## Accounts

The accounts part of the Wisselen tab (`/accounts`, or hotkey 2 in `/futureflow`) switches terminal sessions between your own Claude subscriptions. Each account is a separately paid subscription that you added yourself; futureflow never logs in for you.

- **Adding an account.** Log in with `/login` in a terminal session, then press *Huidige login toevoegen* (or `/accounts toevoegen`). futureflow checks with Anthropic that the token belongs to the identity in `~/.claude.json` and stores a copy. **Never use `/logout` between accounts**: it can revoke the stored login of the account you leave. To add a second account, just `/login` again.
- **Secrets stay in the macOS keychain**, under futureflow's own items: `futureflow-accounts` (the copy per account), `futureflow-accounts-vorige` (the previous generation) and `futureflow-accounts-redding` (a live login that belonged to no known account), keyed `<accountUuid>:<organizationUuid>`. The copy excludes the machine-wide keys (`mcpOAuth`, `pluginSecrets`, …) and goes to `security -i` over stdin. Only the live item `Claude Code-credentials` (about 12 KB with MCP logins) is too long for one stdin line; it goes hex-encoded via argv, the way Claude Code itself writes it. Nothing secret is written to a file, the plugin store, a log, a toast or the screen; e-mail addresses are masked (`co…@domain`).
- **State** lives in `~/.claude/futureflow/accounts/` (folder 700; the CLI writes its files 600): `accounts.json`, `gebruik.json` (usage and poll plan), `config/` (a copy of `oauthAccount` per account), `sessies/` (one busy/idle file per terminal session) and `log.jsonl`.
- **Usage** per account comes from Anthropic's OAuth usage endpoint. The accounts are also used on other machines, so futureflow polls sparingly: at most once per 6 minutes per account, 15 minutes for an idle account, 20 minutes for an exhausted one, and at least 10 minutes (×1.5 up to 30 minutes) after a 429. The tab shows the age of every measurement; automatic switching only decides on measurements younger than 15 minutes.
- **Switching by hand**: *Wissel hierheen* on a row, or `/accounts wissel <n>`. New terminal sessions use the new account; running terminal sessions pick it up within about 30 seconds. The desktop app keeps its own login: there the tab is read-only.
- **Automatic switching** (off by default) before a limit: when the active account reaches its margin (90% of the 5-hour or 7-day window, adjustable 50-99), futureflow first switches to another account in the rotation with the most room (at least 10 points more). Only when every account in the rotation is over its margin does it switch to your API key, through the API part (its own thresholds and settings apply). Back from the API to a subscription as soon as one has room again. At least 5 minutes between switches; a manual choice wins. Mode *Stil* switches between turns with a toast; *Eerst vragen* shows a question above the prompt with *Wissel* / *Niet nu* (not again for 30 minutes).
- **Never mid-turn.** A switch waits until no terminal session is in the middle of a turn: futureflow's own session files plus Claude Code's own `~/.claude/sessions/<pid>.json` (so sessions without futureflow count too). After 10 minutes of waiting it gives up with a notice and tries again after the next turn.
- **Terminal only, standard profile only.** Sessions with `CLAUDE_CONFIG_DIR` or `CLAUDE_SECURESTORAGE_CONFIG_DIR` can only look.

The keychain, `~/.claude.json`, Claude Code's locks and the network are handled by `cli/accounts.mjs` (Node built-ins only); run it with `status --json` to see what the tab sees.

## OpenRouter

The OpenRouter part of the Wisselen tab (hotkey 2 in `/futureflow`, or `/futureflow openrouter`) runs Claude Code on another model through [OpenRouter](https://openrouter.ai), **only in sessions you start with `claude-or`**. Other sessions and the desktop app stay on your subscription.

- **Key** in the macOS keychain (service `futureflow-openrouter`, account `futureflow`), passed to `security -i` over stdin; it must look like `sk-or-…`. Only the last 4 characters are ever shown.
- **Models.** The tab lists OpenRouter's models that support tools (`GET /api/v1/models?supported_parameters=tools`, public, cached for 6 hours in `~/.claude/futureflow/openrouter/modellen.json`; *Lijst verversen* fetches again). Search by id or name; Claude models come first under "Claude via OpenRouter"; 15 are shown with context size and price in/out per million tokens. Pick a main model (*Hoofd*: opus, sonnet and fable) and a fast model (*Snel*: haiku, background tasks and subagents).
- **Gebruik nu** (since 0.9.0) never touches `~/.claude/settings.json`: Claude Code reads that file live in every running session, including the desktop app, so OpenRouter settings there moved all sessions to a model with a smaller context window. Instead futureflow writes its own `~/.claude/futureflow/openrouter/settings.json` (`env.ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `env.ANTHROPIC_API_KEY=""`, `apiKeyHelper` = `/usr/bin/security find-generic-password -s futureflow-openrouter -a futureflow -w`, the main model for opus/sonnet/fable, the fast model for haiku and subagents, `env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`) and the shim `~/.local/bin/claude-or`, which runs `claude --settings <that file> "$@"`. An existing `claude-or` that futureflow did not write is left alone. Models with less than 200k context are flagged "te klein voor Claude Code"; models with 1M context or more get `[1m]` after the id. OpenRouter rules left in `~/.claude/settings.json` by futureflow before 0.9 (recorded in `marker.json`) are removed at the next session start, exactly and only while they still hold futureflow's value.
- **Test verbinding** sends one tiny request (`POST /api/v1/messages`, `max_tokens: 1`) to the fast model with the key from the keychain and shows only ok or the error. Never automatic.
- **Model 1-5** (0.13.0). The card shows five rows, each with *Kies* to pick from the model list: 1 is the model a `claude-or` session starts with and `/model opus`, 2 is `/model sonnet`, 3 is `/model fable`, 4 is `/model haiku`, subagents and background tasks, 5 is an extra entry in `/model`. Empty 2-4 use model 1; an empty 5 is left out. Only model 1 is required.
- **Meet cache** (0.14.1). Picking a model measures once, on its own, whether it caches the growing conversation of a Claude Code agent loop: six small requests (about 35-60k input tokens), counted per round. *goed* = at most one round missed the cache, *wisselend* = several missed, *zwak* = none hit, so every call pays for the whole context again. Providers miss a round at random, so *goed* and *wisselend* can differ between runs; *zwak* does not. *Meet cache* under *Meer ▸* measures all chosen models again. Results are kept and override the built-in warning list.
- **Start check** (0.15.0). `claude-or` only starts when every chosen model has a cache measurement and none of them is *zwak*; *wisselend* is allowed and there is no override. *Gebruik nu* refuses to set up such a model (CLI exit 7, nothing written), the `claude-or` shim reads `~/.claude/futureflow/openrouter/poort` and exits with the reason when it is not `ok` (also when the file is missing), and *Herstart op OpenRouter* opens no new window. Picking a new model therefore costs one measurement before the first start; if the measurement fails, the model stays unmeasured and `claude-or` does not start with it.
- **Local proxy** (0.16.0, 0.17.0). `claude-or` goes through a small local proxy on `127.0.0.1:20817` that passes requests to OpenRouter, reads the token usage along the way and writes one line of metadata per request (no prompts, no answers, no headers, never the key) to `~/.claude/futureflow/openrouter/log.jsonl`. Since 0.17.0 it keeps one OpenRouter provider per session and model (`provider.order`, retrying once without it on 429, 404 or 5xx), switches provider after two cache misses in a row and stops a model after two more (it then marks the model as not caching in `cache.json` and refuses further requests for it with a readable error, so the worst case is five expensive turns). The page at `http://127.0.0.1:20817/` has two tabs: *Modellen* to search, measure, pick and switch Model 1-5 (a switch applies right away to running `claude-or` sessions; the proxy rewrites an old model id to the current one of the same slot) and *Logboek* with recent requests and cache hits per session and model. Open it with *Proxy* in the OpenRouter card (under *Meer ▸*). The page never writes settings itself: the proxy runs the futureflow CLI, so the start check still applies, and the key stays in the keychain. The `claude-or` shim starts the proxy when it is not running and does not start Claude Code if the proxy cannot start. The subscription and the Anthropic API key never go through it.
- **0.13.2.** `claude-or` no longer sets `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` (it switched tool search off, so every request carried all tool schemas), sends one `x-session-id` per launch so OpenRouter keeps the same provider and the prompt cache hits, and the model list warns for models that do not cache inside an agent loop (currently `qwen/…`). Click *Gebruik nu* once to rewrite the settings file and the shim.
- **0.13.1.** `claude-or` sets `FUTUREFLOW_OPENROUTER=1`, so the dashboard and cost tracking recognise an OpenRouter session. In Orca, *Herstart op OpenRouter* opens a new Orca terminal in the same worktree. If an OpenRouter model ends up as `model` in `~/.claude/settings.json` (via `/model` → Enter in `claude-or`), a red row above the prompt offers to remove just that key. Tip: in `claude-or`, pick a model in `/model` with `s` (this session only), not Enter.
- **Herstart op OpenRouter** (0.11.0). Every switch to OpenRouter (the chain's message, or *Gebruik nu*) puts a row above the prompt with a button that continues the current session on OpenRouter: it opens one new Terminal window (iTerm when the session runs there) with `claude-or --resume <session id>` in the same folder, then closes the old session (or says you can close it). In the desktop app it shows the command to copy. It warns when the conversation is larger than the model's context window. One click opens one window.
- **Chain.** When automatic switching is on and every subscription is full, futureflow goes to the first available step of the chain: by default the Anthropic API. OpenRouter never switches by itself: as a step it only shows a message (once per usage window) to start a session with `claude-or`. Back to a subscription as soon as one has room again; a manual choice wins.
- **Costs** while a session started with `claude-or` runs are estimated with the chosen model's cached prices (cache tokens count as normal input) and shown per day and month, separate from the API costs.
- **Caveats:** non-Claude models are not guaranteed to work in Claude Code (Anthropic and OpenRouter both say so); web search does not work; claude.ai connectors are off; it applies only to sessions started with `claude-or`.
- **Fallback (not built):** if OpenRouter turns out not to accept the key from `apiKeyHelper`, the alternative is `env.ANTHROPIC_AUTH_TOKEN` with the key in plain text in `settings.json`. futureflow deliberately does not do that; check a new session with `/status` and *Test verbinding*.

## Credits

- Minify is based on [Caveman](https://github.com/JuliusBrussee/caveman) (Apache-2.0, commit `9b68f7e`).
- The skin is [claude-skins](https://github.com/hellosverre/claude-skins) by hellosverre (MIT, 0.5.16, commit `cf0d39f`), included with changes.
- Accounts follows [claude-swap](https://github.com/realiti4/claude-swap) by Onur Cetinkol (MIT, commit `5ac68bfb`): the lock protocol, the keychain write shape, the order of a switch and the shape of the usage poll policy, reimplemented with slower polling.

See `NOTICE` for details.
