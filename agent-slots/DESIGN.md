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

## Cloud-overflow (0.3)

- Instelling `cloudOverflow` in `config.json` (standaard uit), te zetten met het vinkje in het dashboard (`Button` key `overflow`, sneltoets `c`) of `agent-slot config set cloudOverflow on|off`.
- Aan: een weigering voor een **taak** (`test`, `agent`, `session`, `unknown-heavy`) krijgt de uitweg "besteed uit aan een cloud-worker" erbij. `dev` en `browser` niet: een preview hoort lokaal.
- Bewust **aanbieden, niet automatisch**: uitbesteden betekent pushen naar GitHub, een stap naar buiten die de agent eerst aan de gebruiker voorlegt.
- **Echt in de cloud starten** (getest 19-10-2026): via de sessie-tool van de desktop-app (`target: "cloud"`), of door de gebruiker met `claude --cloud "<opdracht>"` in een interactieve terminal. `claude --cloud` weigert zonder TTY ("requires an interactive terminal"), en een nagebootste TTY (`script`) blijft hangen op de vraag of de map vertrouwd is.
- `agents/cloud-worker.md` (`isolation: remote`) is alleen een laatste redmiddel: in de test draaide het stil **lokaal** (Darwin, worktree onder `.claude/worktrees/`), ook met `isolation: "remote"` expliciet in de Agent-aanroep. De werkwijze staat in de agent-prompt zelf, want een cloud-sessie heeft de plugins van de gebruiker niet.
- **Terugkanaal via git:** een cloud-sessie kan niet terugpraten. `agent-slot overflow add` legt vast welke sessie welke `overflow/…`-branch verwacht (`~/.claude/agent-slots/overflow.json`). De mod draait elke minuut `overflow check --session <id>`: `git ls-remote` op de remote, en bij een nieuwe tip-commit `overflow: rapport …` haalt hij het rapport op (trailers eruit), zet het met `$.prompt.submit` als bericht van de mod in de starter-sessie en markeert het als afgeleverd. Het dashboard toont de jobs onder **Cloud-workers**.
- `agent-slot overflow brief` maakt de volledige opdracht (taak + werkwijze + trailers + rapportformaat), zodat de conventies op één plek staan.
- `skills/cloud-overflow/SKILL.md`: voor de lokale hoofdagent. Wanneer wel/niet, basis-branch pushen (na akkoord), worker starten, `SendMessage` tussendoor, terughalen en controleren.
- **Git-conventies** (zodat teruglezen de skill weer triggert): branch `overflow/<JJJJMMDD>-<onderwerp>`, basis `overflow-base/<onderwerp>`, trailers `Agent-Slots-Overflow: cloud-worker`, `Overflow-Base: <basis>`, `Overflow-Task: <taak>`, en een laatste commit `overflow: rapport <onderwerp>` met Gedaan / Tests / Open. De skill-beschrijving noemt de branchnaam en de trailer letterlijk.

## Later (v2)

- Een minimum per agent (lichte unit-tests zonder slot).
- Waarschuwing bij 15% vrij geheugen in de balk en een melding.
- `kill-idle` die ook echt processen stopt die lang niets doen.
