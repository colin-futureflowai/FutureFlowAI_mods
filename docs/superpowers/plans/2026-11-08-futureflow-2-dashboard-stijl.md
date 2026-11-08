# futureflow — Plan 2: dashboard en stijl

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/futureflow` opent een FutureFlowAI-dashboard (Overzicht, Agent slots, Minify, Stijl), en Claude Code krijgt een FFAI-skin in licht en donker: tool-regels met icoon en tijd, diff-kaart, shell-kaart, groene spinner.

**Architecture:** Eén palet in `lib/thema.mjs` voedt zowel het dashboard als de skin. `hooks/dashboard.tsx` tekent het paneel `futureflow` met tabs; de bestaande panelen van Slots en Minify worden functies die het dashboard aanroept. `hooks/skin.tsx` vervangt `ToolUse`/`ToolResult`/`Spinner`/`TurnDuration` en valt per onderdeel terug op Claude Code's eigen weergave (`next(e)`). Desktop krijgt vectorkaarten (`Svg`), de terminal tekst en kleur.

**Tech Stack:** Claude Code mods (TSX, `$.ui.resolve(e)` → `Box/Text/Button/Svg`), Node-tests, `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-11-08-futureflow-supermod-design.md` (secties 4 Skin en 7 Dashboard; mockup `.superpowers/brainstorm/4691-1794161861/content/supermod-v1.html`, secties 2 en 3)

**Bron skin:** claude-skins, github.com/hellosverre/claude-skins, MIT, commit `cf0d39f`, lokaal in `/private/tmp/claude-501/-Users-rduivenvoorden-Companies-FutureFlowAI-mods/1ca85bcf-2578-4999-b4bf-a825d8867473/scratchpad/repos/claude-skins` (opnieuw clonen als die map weg is). Relevant: `hooks/register.tsx` (render-hooks, theme), `hooks/rows.tsx`, `hooks/tools.ts`, `hooks/icons.ts`, `hooks/shell-rows.tsx`, `hooks/detail-rows.tsx`, `hooks/diff-fence.tsx`, `hooks/light.ts`.

**Volgt op plan 1** (Taak 1–5 klaar; Taak 6 en de eindreview van plan 1 staan geparkeerd). futureflow is geïnstalleerd en leest direct uit `futureflow/`.

## Global Constraints

- Alle Global Constraints van plan 1 gelden (geen Node in hooks, alleen `fn($, …)`-aanroepen met `$`, handlers `($, e, next)`, één ongematchte `session.start`/`tool.call` per module → werk via `start…($)`-functies en matchers, mocks `{ value }`, geen variabele `h` in `.tsx`, failOpen).
- Huisstijl: groen `#32a029`, donkergrijs `#3D3D3D`, wit `#FFFFFF`, zwart `#000000`, rood voor verwijderingen `#d4483b`. "AI" in het woordmerk is altijd groen. Geen cursief.
- Oppervlak: `Svg` bestaat niet in de terminal. Kies de vorm met `e.surface !== 'terminal'`, nooit met `'Svg' in $.ui.resolve(e)` (die is in de terminal ook `true`).
- `Svg`: `source` ≤ 131072 tekens, `alt` verplicht, geen scripts.
- Teksten Nederlands, licht informeel, kort.
- Elke render-hook faalt open: bij een fout `next(e)` (Claude Code's eigen weergave) en één `failOpen`.
- Licentie: claude-skins-code die je overneemt krijgt een vermelding in `futureflow/NOTICE` (MIT, auteur hellosverre, commit `cf0d39f`) en in `futureflow/README.md`.
- De schijf van deze Mac is krap: geen grote downloads, geen `npm install` in de repo, tijdelijke bestanden opruimen.

## Review Focus

1. **Lichte en donkere Claude Code-thema's** (`light`, `dark`, `light-daltonized`, `dark-ansi`, `auto`): de skin kiest het juiste palet. Bij een onbekende waarde valt hij terug op donker. Test in Taak 1 en Taak 4.
2. **Fout in een render-hook** (bv. tool zonder `input`, onbekende tool, gigantische diff): Claude Code's eigen weergave verschijnt, geen lege regel. Test in Taak 4.
3. **Terminal**: geen `Svg` in de boom, wel kleur en tekst. Test in Taak 2 en Taak 4 via `$.ui.mount` met `surface: 'terminal'`.
4. **Skin uit** (`/futureflow stijl uit` of het vinkje): elke render-hook geeft `next(e)`. Test in Taak 5.
5. **Leeg dashboard bij de eerste start** (nog geen tellers of snapshot): de tabs tonen "nog geen gegevens", geen crash. Test in Taak 3.

---

### Taak 1: Palet en woordmerk

**Files:**
- Create: `futureflow/lib/thema.mjs`, `futureflow/lib/thema.d.mts`, `futureflow/tests/thema.test.mjs`

**Interfaces:**
- Produces:
  - `type Modus = 'licht' | 'donker'`
  - `modusVoor(theme: unknown): Modus` — `'light'`, `'light-daltonized'`, `'light-ansi'` → `'licht'`; al het andere (ook `undefined` en `'auto'`) → `'donker'` (mijn keuze; in de Stijl-tab te overschrijven).
  - `palet(modus: Modus): Palet` met sleutels `groen, groenZacht, inkt, mut, lijn, achtergrond, vlak, rood, oranje` — licht: `#32a029, #e8f5e6, #3D3D3D, #7a807a, #e3e6e3, #ffffff, #f6f7f6, #d4483b, #d99a1e`; donker: `#32a029, #16301a, #e9ece9, #8d958d, #2b302b, #121412, #1b1e1b, #e5675b, #e0a93a`.
  - `woordmerkSvg(modus: Modus, breedte: number): string` — `<svg>` met de tekst "FutureFlow" in `inkt` en "AI" in `groen`, font-family `'BR Sonoma', -apple-system, 'Segoe UI', sans-serif`, gewicht 600, hoogte 28.
  - `balkTekst(fractie: number, breedte: number): string` — `▰`/`▱`, fractie geklemd op 0..1, bv. `balkTekst(0.57, 7) === '▰▰▰▰▱▱▱'`.

- [ ] **Stap 1: Failing tests** in `tests/thema.test.mjs`: `modusVoor` voor `light`, `light-daltonized`, `light-ansi`, `dark`, `dark-ansi`, `auto`, `undefined`, `42`; `palet('licht').groen === '#32a029'` en `palet('donker').inkt === '#e9ece9'`; `woordmerkSvg('licht', 200)` begint met `<svg`, bevat `>AI<` met `fill="#32a029"` en is < 131072 tekens; `balkTekst(0.57, 7) === '▰▰▰▰▱▱▱'`, `balkTekst(-1, 4) === '▱▱▱▱'`, `balkTekst(2, 4) === '▰▰▰▰'`.
- [ ] **Stap 2:** `node --test futureflow/tests/thema.test.mjs` → FAIL.
- [ ] **Stap 3: Implementeren** volgens de interfaces.
- [ ] **Stap 4:** zelfde commando → PASS.
- [ ] **Stap 5: Commit** `futureflow: palet en woordmerk`.

---

### Taak 2: Dashboard-paneel met tabs

**Files:**
- Create: `futureflow/hooks/dashboard.tsx`, `futureflow/tests/dashboard.test.ts`
- Modify: `futureflow/hooks/slots.tsx` (paneel-inhoud → export `slotsTab($)`), `futureflow/hooks/minify.tsx` (paneel-inhoud → export `minifyTab($)`), `futureflow/hooks/register.tsx`, `futureflow/types/index.d.ts`

**Interfaces:**
- Consumes: `palet`, `modusVoor`, `woordmerkSvg` (Taak 1); `oud($)` uit `ctx.ts`.
- Produces:
  - Paneel-id `futureflow`, titel `FutureFlowAI`. Atom `{ plugin: 'futureflow', key: 'dashboard.tab' }` met type `'overzicht' | 'slots' | 'minify' | 'stijl'`, standaard `'overzicht'`.
  - `openDashboard($, tab?: Tab): Promise<void>` in `dashboard.tsx`: zet de tab en opent het paneel (`$.ui.open({ id: 'futureflow', title: 'FutureFlowAI' })`).
  - `/futureflow [overzicht|slots|minify|stijl]` opent het dashboard op die tab (registratie in `startDashboard($)`, aangeroepen vanuit de ene `session.start`).
  - `/agent-slots` (zonder argument) en `/minify` zonder argument openen het dashboard op tab `slots` resp. `minify`; hun andere subcommando's (`status`, `O1`, `stats`, `bestand …`) werken als voorheen. De oude losse panelen `agent-slots` en `minify` vervallen; `slotsTab($)` en `minifyTab($)` geven de oude paneel-inhoud terug (zelfde elementen, zelfde knoppen en hotkeys). De oud-guards (oude plugin aan → `next(e)`) blijven.
  - Kop: desktop `Svg` met `woordmerkSvg(modus, 220)` (alt `FutureFlowAI`); terminal `Text` "FutureFlow" + `Text color={groen}` "AI". Daaronder een tabrij: per tab een `Button` (hotkeys `1`–`4`), de actieve tab in `groen` en vet.
  - Modus = de stijl-instelling als die `licht`/`donker` is (Taak 4; tot dan altijd auto), anders `modusVoor` van Claude Code's `theme` (`$.config.list()`, sleutel `theme`; bijwerken op `config.set { key: 'theme' }`).
  - Verversen: zolang het paneel open is elke 3 s (zoals het slots-dashboard nu), daarbuiten niet.

- [ ] **Stap 1: Failing tests** in `tests/dashboard.test.ts`:
  - `test('/futureflow opent het paneel op overzicht')` — `command.run { command: 'futureflow' }` → `ui.open` met id `futureflow`; atom-tab `overzicht`.
  - `test('/futureflow minify kiest de minify-tab')`.
  - `test('/agent-slots zonder argument opent het dashboard op slots')` en `test('/agent-slots status geeft nog steeds tekst')`.
  - `test('terminal tekent geen Svg')` — `$.ui.mount({ plugin: 'futureflow', surface: 'terminal', component: 'Pane', props: { requestId: 'futureflow' } })`; de boom bevat geen element van type `Svg` en wel de tekst `AI`.
  - `test('desktop tekent het woordmerk')` — zelfde met `surface: 'desktop'`; er is een `Svg` met `alt === 'FutureFlowAI'`.
- [ ] **Stap 2:** `claude plugin test futureflow` → nieuwe tests FAIL.
- [ ] **Stap 3: Implementeren.** Bestaande tests voor de oude panelen aanpassen aan `slotsTab`/`minifyTab`; hun inhoud mag niet veranderen.
- [ ] **Stap 4:** `claude plugin test futureflow`, `node --test futureflow/tests/*.test.mjs`, `claude plugin validate futureflow` → PASS.
- [ ] **Stap 5: Commit** `futureflow: dashboard met tabs`.

---

### Taak 3: Tab Overzicht

**Files:**
- Create: `futureflow/lib/overzicht.mjs`, `futureflow/lib/overzicht.d.mts`, `futureflow/tests/overzicht.test.mjs`
- Modify: `futureflow/hooks/dashboard.tsx`, `futureflow/tests/dashboard.test.ts`

**Interfaces:**
- Consumes: minify-atom `minify.teller` (`MinifyTeller`: `beurten, output, ingekort, uitvoerVoor, uitvoerNa`), `$.store` `minify.perNiveau`, het huidige minify-niveau, slots-atom `slots.snapshot` (`memory.freePercent`, `memory.totalGB`), `$.session.usage()` voor het contextvenster (kijk in `agent-slots/.claude-plugin/types/claude-code/index.d.ts` naar de vorm; `cache-tax/hooks/register.ts` in de scratchpad-repos gebruikt het ook).
- Produces: `kpis(invoer: { teller?: MinifyTeller | null; perNiveau?: Record<string, { beurten: number; output: number }>; niveau?: string; snapshot?: { memory: { freePercent: number; totalGB: number } } | null; context?: { gebruikt: number; max: number } | null }): Kpi[]` met `type Kpi = { titel: string; waarde: string; sub: string; toon: 'groen' | 'oranje' | 'mut'; fractie?: number }`, altijd in deze volgorde:
  1. `Tokens bespaard (in)` — `(uitvoerVoor − uitvoerNa) / 4`, afgerond; vanaf 1000 als `k` met één decimaal (`'41.2k'`); sub `'{ingekort}× uitvoer ingekort'`; toon `groen`.
  2. `Tokens bespaard (uit)` — schatting: als `perNiveau.uit.beurten ≥ 5` en het huidige niveau `n` gegevens heeft: `round(perNiveau[n].beurten × (gem(uit) − gem(n)))`, anders `round(teller.beurten × (teller.output / teller.beurten) × 0.35)`; waarde voorafgegaan door `≈`; sub `'schatting'`; toon `groen`. Geen beurten → waarde `'–'`.
  3. `Contextvenster` — `round(gebruikt/max × 100) + '%'`, `fractie` gezet, sub `'van het venster'`; toon `oranje` boven 70%, anders `groen`.
  4. `Vrij geheugen` — `'{freePercent}%'`, sub `'van {totalGB} GB'`, toon `oranje` onder 25%, anders `groen`.
  Ontbrekende invoer voor een kpi → waarde `'–'`, sub `'nog geen gegevens'`, toon `mut`.
- Desktop: één `Svg` met vier kaarten naast elkaar (titel klein in `mut`, waarde groot in `inkt` of de toonkleur, sub klein; bij `fractie` een dunne balk). Terminal: vier regels `titel  waarde  sub`, waarde in de toonkleur; bij `fractie` ook `balkTekst(fractie, 10)`.
- Onder de kaarten: drie `Button`s als snelkoppeling naar de tabs Slots, Minify, Stijl.

- [ ] **Stap 1: Failing tests** `tests/overzicht.test.mjs`: lege invoer → vier kpi's met `'–'`; `teller = { beurten: 10, output: 5000, ingekort: 3, uitvoerVoor: 200000, uitvoerNa: 35200 }` → kpi 1 waarde `'41.2k'`, sub `'3× uitvoer ingekort'`; `perNiveau = { uit: { beurten: 6, output: 6000 }, O2: { beurten: 10, output: 5000 } }`, niveau `O2` → kpi 2 waarde `'≈5000'`; zelfde teller zonder `perNiveau` → kpi 2 waarde `'≈1750'`; context `{ gebruikt: 76000, max: 100000 }` → kpi 3 waarde `'76%'`, toon `oranje`, `fractie 0.76`; snapshot `freePercent 20` → kpi 4 toon `oranje`.
- [ ] **Stap 2:** FAIL. **Stap 3:** implementeren + tab tekenen. **Stap 4:** dashboard-test `test('overzicht zonder gegevens crasht niet')` (geen atoms, geen store) en alle suites → PASS.
- [ ] **Stap 5: Commit** `futureflow: tab Overzicht`.

---

### Taak 4: Skin — tool-regels, diff- en shell-kaart, spinner

**Files:**
- Create: `futureflow/hooks/skin.tsx`, `futureflow/lib/skin.mjs`, `futureflow/lib/skin.d.mts`, `futureflow/tests/skin.test.ts`, `futureflow/tests/skin-lib.test.mjs`
- Modify: `futureflow/hooks/register.tsx`, `futureflow/hooks/dashboard.tsx` (modus uit stijl), `futureflow/NOTICE`, `futureflow/README.md`, `futureflow/types/index.d.ts`

**Interfaces:**
- Consumes: `palet`, `modusVoor` (Taak 1).
- Produces:
  - Stijl-instellingen in `$.store` sleutel `stijl`: `type Stijl = { aan: boolean; modus: 'auto' | 'licht' | 'donker'; regels: boolean; diff: boolean; shell: boolean; spinner: boolean }`, standaard `{ aan: true, modus: 'auto', regels: true, diff: true, shell: true, spinner: true }`. `leesStijl($): Promise<Stijl>` en `zetStijl($, deel: Partial<Stijl>): Promise<void>` in `skin.tsx` (export). `huidigeModus($): Promise<Modus>` (stijl-modus, of bij `auto` `modusVoor(theme)`) ook als export; het dashboard gebruikt die.
  - Pure helpers in `lib/skin.mjs`: `icoonVoor(tool: string): string` (Read `R`, Write/Edit/MultiEdit/NotebookEdit `E`, Bash `$`, Grep/Glob `⌕`, WebFetch/WebSearch `↗`, Task/Agent `◆`, `mcp__*` `◇`, anders `•`); `duurTekst(ms: number): string` (`< 60000` → seconden met één decimaal en komma, `'0,4 s'`; `≥ 60000` → `'1 m 05 s'`); `diffRegels(oud: string, nieuw: string, max = 200): { soort: '+' | '-' | ' '; tekst: string; nr: number }[]` (regel-diff; bij meer dan `max` regels afgekapt met een slotregel `{ soort: ' ', tekst: '… n regels meer', nr: 0 }`); `telling(regels): { plus: number; min: number }`.
  - `ui.render` op `ToolUse`: één regel — icoon in een groen vlakje (`groenZacht` achter `groen` tekst), toolnaam vet, korte invoer (pad, commando of patroon, afgekapt op 80 tekens), rechts tijd en bij Edit/Write `+N −M`. Openklappen zoals claude-skins (`▸`) toont de volledige invoer en het resultaat.
  - `ui.render` op `ToolResult` voor Edit/Write/MultiEdit: diff-kaart (kop met pad en `+N −M` in groen; regels met nummer, `+` op groen-tint, `-` op rood-tint). Voor Bash: shell-kaart (commando, `✓` of `✗ exit N`, stdout, stderr apart onder een rood label, elke stroom ingeklapt tot 8 + 4 regels). Andere tools: `next(e)`.
  - `ui.render` op `Spinner` en `TurnDuration`: zelfde tekst als Claude Code, in `groen`.
  - Desktop mag `Svg` gebruiken voor de kaarten; de terminal tekent ze met `Box`/`Text` en kleuren.
  - Elke hook: `stijl.aan === false` of het betreffende onderdeel uit → `next(e)`. Fout → `next(e)` + `failOpen`.
- Werkwijze: lees de genoemde claude-skins-bestanden voor de vorm van `e` per component (welke props er zijn: tool, input, result, duur, status) en hoe zij openklappen, tijd en exitcode lezen. Neem over wat nodig is, niets meer (geen thema's, geen tabellen, Mermaid, wiskunde, links, folding van prose). Let op: minify kort Bash-uitvoer al in `tool.call` in; de shell-kaart tekent wat er na minify overblijft.

- [ ] **Stap 1: Failing tests**
  - `tests/skin-lib.test.mjs`: `icoonVoor` voor `Read`, `Edit`, `Bash`, `mcp__x__y`, `Onbekend`; `duurTekst(400) === '0,4 s'`, `duurTekst(65000) === '1 m 05 s'`; `diffRegels('a\nb', 'a\nc')` → `[{ soort: ' ', tekst: 'a', nr: 1 }, { soort: '-', tekst: 'b', nr: 2 }, { soort: '+', tekst: 'c', nr: 2 }]`; `diffRegels` met 500 gewijzigde regels en `max = 200` geeft 201 items, de laatste `tekst` begint met `'… '`; `telling` telt `+` en `-`.
  - `tests/skin.test.ts`: via `$.ui.mount` voor `surface: 'desktop'` en `'terminal'`:
    - `test('ToolUse Bash toont $ en het commando')`;
    - `test('Edit-resultaat wordt een diff-kaart met +1 −1')`;
    - `test('Bash-resultaat met exit 2 toont ✗ exit 2 en stderr apart')`;
    - `test('skin uit geeft Claude Code eigen weergave')` (store `stijl.aan = false` → de hook roept `next` aan);
    - `test('kapotte invoer valt terug op next')` (ToolUse zonder input);
    - `test('licht thema gebruikt inkt #3D3D3D')` (config `theme = 'light'`).
- [ ] **Stap 2:** FAIL. **Stap 3:** implementeren. **Stap 4:** alle suites + `claude plugin validate futureflow` → PASS.
- [ ] **Stap 5:** NOTICE/README aanvullen (claude-skins, MIT, `cf0d39f`). **Commit** `futureflow: FFAI-skin (tool-regels, diff, shell, spinner)`.

---

### Taak 5: Tab Stijl

**Files:**
- Modify: `futureflow/hooks/dashboard.tsx`, `futureflow/tests/dashboard.test.ts`, `futureflow/hooks/skin.tsx` (subcommando's)

**Interfaces:**
- Consumes: `leesStijl`, `zetStijl`, `huidigeModus` (Taak 4); `openDashboard` (Taak 2).
- Produces:
  - Tab Stijl: vinkje `Skin aan` (hotkey `s`); keuze thema `auto · licht · donker` (drie `Button`s, actieve groen); vinkjes `Tool-regels`, `Diff-kaart`, `Shell-kaart`, `Groene spinner`; uitlegregel: "Uit = Claude Code's eigen weergave." Op desktop een klein voorbeeld (`Svg`) van een tool-regel en een diff in het gekozen thema.
  - `/futureflow stijl` opent deze tab; `/futureflow stijl uit|aan|licht|donker|auto` past de instelling direct aan en antwoordt met één regel tekst.
  - Na elke wijziging `$.ui.invalidate` zodat al getekende regels het nieuwe thema krijgen.

- [ ] **Stap 1: Failing tests**: `test('stijl uit zet aan op false')`, `test('stijl licht zet modus licht')`, `test('vinkje diff uit schakelt alleen diff uit')` (via de `Button`-press van de tab, zoals bestaande tests op knoppen drukken), `test('stijl-tab tekent op terminal zonder Svg')`.
- [ ] **Stap 2:** FAIL. **Stap 3:** implementeren. **Stap 4:** alle suites → PASS.
- [ ] **Stap 5: Commit** `futureflow: tab Stijl`.

---

### Taak 6: Live laten zien

- [ ] **Stap 1:** versie in `futureflow/.claude-plugin/plugin.json` naar `0.2.0`; `claude plugin validate futureflow`.
- [ ] **Stap 2:** terminal: `claude -p --plugin-dir futureflow "/futureflow"` en `"/futureflow stijl"` → tekstversie zonder fouten; `~/.claude/futureflow/mod.log` zonder nieuwe fouten.
- [ ] **Stap 3:** desktop: Colin opent een nieuwe Code-tab-sessie, typt `/futureflow`, klikt de vier tabs door, laat Claude een bestand wijzigen en `ls` draaien, en zet Stijl op licht en donker. Bevindingen → fix met test, of akkoord.
- [ ] **Stap 4: Commit** `futureflow 0.2.0: dashboard en stijl`.
