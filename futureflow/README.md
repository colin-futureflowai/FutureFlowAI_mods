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

## Credits

- Minify is based on [Caveman](https://github.com/JuliusBrussee/caveman) (Apache-2.0, commit `9b68f7e`).
- The skin is [claude-skins](https://github.com/hellosverre/claude-skins) by hellosverre (MIT, 0.5.16, commit `cf0d39f`), included with changes.

See `NOTICE` for details.
