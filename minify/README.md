# minify

Makes Claude Code spend fewer tokens, on what it says and on what it reads, without losing substance. Like a minifier for code: same behaviour, fewer characters. On by default.

## What it does

- **Terse answers, three levels.** Like Caveman, command hooks give Claude the rules at session start and a one-line reminder with every prompt: answer first, no preamble or recap, one idea per sentence, code/paths/commands/errors verbatim, and *not/never/only* never dropped. Levels follow compiler flags:
  - `O1`: full sentences, filler removed.
  - `O2` (default): articles may go, fragments allowed.
  - `O3`: fragments, each fact once.
- **Plain language where it matters.** Security warnings, irreversible actions, questions to you, and anything that outlives the chat (code, comments, commits, PRs, docs, notes) are written normally.
- **Your language.** Rules are written for Dutch and English; Claude answers in the language you write in.
- **Subagents too.** Their final report comes back into your session's context, so they are asked to keep it short.
- **Plain shell.** The hooks run `bin/regels.sh` with `sh`; no Node needed. The mod writes the rule texts and each session's level under `~/.claude/minify/`.
- **Long tool output shrunk.** Bash output and MCP tool results (e.g. Playwright page snapshots) longer than a few thousand characters are cut down before the model reads them: ANSI colours and progress bars removed, repeated lines collapsed, the start and end kept, plus every line that looks like an error. Large JSON becomes its structure. The full output is saved under `~/.claude/minify/uitvoer/` (or stays where Claude Code already saved very large output) and the model gets the path, so nothing is lost. For output too large for Claude Code to show inline, minify shrinks the whole file instead of letting the model see only the first 2 KB, so errors at the end are not missed. A failed command's shortened output reaches the model as a withheld result that says the command did run. `Read`, `Edit` and `Grep` are never touched.
- **Memory files shrunk.** `/minify bestand CLAUDE.md` asks Claude Haiku for a shorter version, checks that every heading, code block, inline code span and URL survived, and shows you a diff. Nothing changes until you run `/minify toepassen`; the original goes to `~/.claude/minify/backups/` and `/minify herstel <path>` puts it back. Only `.md` and `.txt`; files that look like secrets and Obsidian `vault/` notes are refused. The file is sent to the model provider.
- **Measured.** The status line shows the level, average output tokens per turn and how much tool output was cut. `/minify stats` compares your own turns per level.
- **Dashboard.** `/minify` opens a pane: level buttons (O1/O2/O3/off), cards for output per turn, output cut and tokens not read, a chart of output tokens per turn, average output per level across sessions, and the latest shrunk outputs. Charts are SVG in the desktop app and text bars in the terminal; it redraws after every turn.

If the mod fails, everything passes through unchanged; you get one notice and the reason in `~/.claude/minify-mod.log`.

## Commands

| Command | |
| --- | --- |
| `/minify` | Dashboard |
| `/minify status` | Same as text: level, whether the rules reached Claude, counts for this session |
| `/minify O1` · `O2` · `O3` | Level for this session |
| `/minify uit` (or say "doe normaal") | Off for this session |
| `/minify standaard O3` | Level for new sessions (`standaard uit` to start off) |
| `/minify stats` | Output tokens per turn per level, across sessions |
| `/minify bestand <path>` · `toepassen` · `herstel <path>` | Shrink a memory file, apply, restore |

## What to expect

Honest numbers from Caveman's own measurements: compared with a plain "answer concisely", the terse voice saves about 3% (O2) to 35% (O3) output tokens; JetBrains measured 8.5% fewer output tokens with no quality loss. In Claude Code sessions most cost is *input*, so the bigger win is in shrinking what Claude reads: tool output and memory files. The full rules cost about 1,000 input tokens once per session, the reminder about 80 per prompt.

## Install

```bash
claude plugin marketplace add colin-futureflowai/FutureFlowAI_mods
claude plugin install minify@futureflowai-mods
```

## Credits

Based on [Caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee (Apache-2.0). The answer and compression rules are translated and adapted from it; the code is new. "Caveman" is a trademark of Julius Brussee and this plugin is not affiliated with it. See [NOTICE](NOTICE) and [LICENSE](LICENSE).
