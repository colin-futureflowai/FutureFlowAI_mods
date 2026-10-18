# agent-slots — ontwerp v1

Doel: Claude Code (en andere agents) mogen niet zoveel zware dingen tegelijk starten dat de computer vastloopt. Gebouwd voor Claude Code; de CLI `agent-slot` werkt ook los voor andere agents.

## Delen

1. **`bin/agent-slot.mjs`** (Node, geen dependencies) — alle state en logica. Werkt op macOS, Linux en Windows.
2. **`hooks/register.tsx`** — de mod: onderschept tool-aanroepen in Claude Code en gebruikt de CLI.
3. **Shim op het PATH** — `agent-slot install` zet `agent-slot` in `~/.local/bin` (Windows: `agent-slot.cmd`) en kopieert de CLI naar `~/.claude/agent-slots/bin/`, zodat de shim niet afhangt van de plugin-versie.

## State: `~/.claude/agent-slots/`

- `locks/<soort>-<n>.json` — één bestand per bezet slot, aangemaakt met `O_EXCL` (atomair, ook tussen worktrees en sessies). Inhoud: `pid`, `pidStart` (starttijd van het proces), `childPid`, `childStart`, `session`, `cwd`, `command`, `since`, `lastUsed`.
- `config.json` — limieten (optioneel; standaard hieronder).
- `log.jsonl` — elke acquire, release, refuse, reap en kill, één JSON-regel per gebeurtenis.
- `~/.claude/agent-slots-mod.log` — eigen log van de mod (via `$.fs`, dus ook als Node niet start): laden en fouten. Een fout laat alles door (fail-open) en geeft één toast per sessie.

**Levend?** Een slot leeft zolang `pid` of `childPid` bestaat **met dezelfde starttijd** (hergebruikte PID telt niet). Browser-slots hebben geen proces: ze leven zolang `lastUsed` jonger is dan `browserIdleMinutes`. Elke opdracht ruimt eerst dode slots op (reap), dus na een crash of herstart blijft niets hangen.

## Soorten en standaardlimieten

| Soort | Limiet | Voorbeelden |
| --- | --- | --- |
| `dev` | 2 | `pnpm dev`, `next dev`, `vite`, `npm start`, `wrangler dev` |
| `test` | 1 | `pnpm test`, `vitest`, `jest`, `node --test`, `playwright test`, `tsc`, `pnpm typecheck`, `pnpm build` |
| `browser` | 1 | Playwright-MCP-tools, `npx playwright` (niet `test`) |

Geheugen: `floorPercent` 25 (krap; was 20, verhoogd na de test met twee workers: 2 dev-servers + 1 testrun brachten een Mac met 16 GB op ~32% vrij) en `criticalPercent` 10 (kritiek). Gemeten als vrij percentage: macOS `memory_pressure -Q`, Linux `MemAvailable` uit `/proc/meminfo`, Windows `os.freemem()`.

## Regels in Claude Code

| Aanroep | Gedrag |
| --- | --- |
| Bash met zwaar commando | slot vrij en geheugen boven `floor` → commando ingepakt als `agent-slot run <soort> -- <cmd>`; anders geweigerd met volgende stap |
| Bash dat een agent start (`claude -p`, `codex exec`, `orca … spawn`) | geweigerd onder `floor` |
| Workflow, nieuwe sessie (`start_session`) | geweigerd onder `floor` |
| Agent (subagent) | geweigerd onder `critical` |
| Playwright-MCP-tool | browser-slot op sessie-id; elke aanroep ververst `lastUsed`; vrij na 10 min stilte of bij einde sessie |
| al het andere (ook `kill`, lezen, schrijven) | altijd door |

Herkenning: het commando wordt in stukken geknipt op `&&`, `||`, `;` en `|`; per stuk vallen `cd`, `VAR=…`, `env`, `time`, `nohup` weg en worden `npx`/`pnpm exec`/`pnpm run`/`npm run`/`yarn` uitgepakt. Bij twijfel: door en loggen (`unknown-heavy`), zodat de regels later strakker kunnen.

**Toestemming:** de ingepakte versie wordt in `tool.check` beoordeeld als het originele commando, zodat bestaande toestemmingsregels blijven werken.

**Weigering** noemt wie het slot heeft (sessie, map, commando), sinds wanneer, en de volgende stap: `agent-slot wait <soort>` (blokkeert tot er plek is, max. 9 minuten) of over 60 s opnieuw proberen.

**Ontsnapping:** `AGENT_SLOT_BYPASS=1` in de omgeving van de sessie zet alles uit. Getypte `!`-commando's van de gebruiker gaan niet via de tool-aanroepen van het model en worden niet geraakt.

## CLI

```
agent-slot run <soort> [--wait <s>] -- <cmd…>   slot vasthouden zolang cmd leeft
agent-slot wait <soort> [--timeout <s>]         wachten tot er plek is
agent-slot acquire|touch|release browser --session <id>
agent-slot check <soort>                        JSON: mag het nu?
agent-slot status [--json]                      slots, geheugen, laatste weigeringen
agent-slot kill-idle                            dode en verlopen slots opruimen
agent-slot install                              shim op het PATH zetten
```

## Dashboard

`/agent-slots` opent een paneel (`$.ui.open`, `ui.render` op `Pane`). De mod haalt elke 3 s `agent-slot status --json` op zolang het paneel open is (`$.clock.every`, stopt als `$.ui.panes()` het niet meer noemt) en zet het in `$.state` `agent-slots.snapshot`. `/agent-slots status` geeft dezelfde info als tekst.

## Later (v2)

- Een minimum per agent (lichte unit-tests zonder slot).
- Waarschuwing bij 15% vrij geheugen in de balk en een melding.
- `kill-idle` die ook echt processen stopt die lang niets doen.
