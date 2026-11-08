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

futureflow draws Claude Code in FutureFlowAI's style, in light and dark: tool rows with an icon, the tool name, a short input and the time it took (`▸` opens the full input and result), a diff card under Edit/Write, a shell card under Bash (`✓` or `✗ exit N`, stderr apart, long output folded to 8 + 4 lines) and a green spinner. Settings live in the plugin store under `stijl` (`aan`, `modus`, `regels`, `diff`, `shell`, `spinner`); `modus: 'auto'` follows Claude Code's theme.

## Credits

- Minify is based on [Caveman](https://github.com/JuliusBrussee/caveman) (Apache-2.0, commit `9b68f7e`).
- The skin is based on [claude-skins](https://github.com/hellosverre/claude-skins) by hellosverre (MIT, commit `cf0d39f`).

See `NOTICE` for details.
