# futureflow 3: Voortgang, Slots-stijl, Connectors en API-switch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De voortgangsbalk voor lange taken, de tab Slots in de skin-stijl, een tab Connectors (context per connector, uitzetten per map) en een tab API (key in de sleutelhanger, handmatig en automatisch wisselen tussen abonnement en API).

**Architecture:** Alles binnen de bestaande mod `futureflow/`. Pure logica in `lib/*.mjs` (met `.d.mts`), node-tests in `tests/*.test.mjs`. Bestanden buiten de plugin (`~/.claude.json`, `~/.claude/settings.json`, sleutelhanger) alleen via Node-CLI's in `cli/` (atomisch schrijven: tijdelijk bestand + rename), aangeroepen met `$.process.run(['/usr/bin/env','node',…], { env: { PATH } })`. Hooks in `hooks/*.tsx`, tests in `tests/*.test.ts(x)`.

**Tech Stack:** Claude Code mods (hooks-module, `$`-API, build 2.1.319), Node-builtins, macOS `/usr/bin/security`.

**Spec:** `docs/superpowers/specs/2026-11-08-futureflow-supermod-design.md` (sectie 5 Voortgang, 7 Dashboard) en de aanvulling onderaan dit plan.

## Global Constraints

- UI-teksten en code-commentaar Nederlands; README Engels.
- Validator: `$` alleen aan `function`-declaraties doorgeven, nooit aan pijl-functies; per event één ongematchte handler in de hele module (ongematcht nu: `session.start` register.tsx, `turn.complete` minify.tsx, `tool.call` + `session.end` slots.tsx, `prompt.submit` minify.tsx, `turn.start`/`config.set`/`ui.invalidate`/`session.measure` skins); atoms in het bestand dat ze leest of schrijft; geen variabele `h`; render schrijft nooit state.
- `types/index.d.ts` blijft één zelfstandig bestand zonder `import`; nieuwe `$.state`-sleutels onder `futureflow` met prefix (`voortgang.`, `connectors.`, `api.`).
- Elke hook faalt open (try/catch → `failOpen($, err)` + `next(e)`); een fout in `tool.call` mag de aanroep nooit laten mislukken.
- Geheimen nooit in state, store, log, toast of argv: de API-key gaat via stdin naar `cli/api.mjs`, die hem via stdin aan `/usr/bin/security -i` geeft. Alleen `sk-ant-…` + laatste 4 tekens wordt getoond. Formaat-check `^sk-ant-[A-Za-z0-9_-]{20,}$`.
- Sleutelhanger-item: service `futureflow-anthropic-api`, account `futureflow`.
- `apiKeyHelper` = `/usr/bin/security find-generic-password -s futureflow-anthropic-api -a futureflow -w`. futureflow zet of verwijdert alleen deze exacte waarde; een andere bestaande `apiKeyHelper` laat hij staan en meldt hij.
- Wisselen geldt voor nieuwe terminal-sessies; de lopende sessie houdt zijn login. De desktop-app regelt zijn eigen login (dit staat in de tab).
- Connectors uitzetten = `projects[<cwd>].disabledMcpServers` in `~/.claude.json` (zelfde lijst als `/mcp`), geldt vanaf de volgende sessie in die map.
- Dashboard-tabs worden: overzicht, slots, minify, stijl, connectors, api (hotkeys 1-6).
- Checks vóór commit: `claude plugin validate futureflow`, `claude plugin test futureflow`, `node --test futureflow/tests/*.test.mjs`.

## Review Focus

1. Een `~/.claude.json` die Claude Code tegelijk schrijft: de CLI leest, wijzigt alleen `projects[cwd].disabledMcpServers` en schrijft atomisch; een kapot of ontbrekend bestand wordt niet overschreven (fout terug).
2. Auto-switch heen-en-weer: na een switch naar API ziet de sessie geen abonnementslimieten meer; terug pas na de `resetsAt` van het venster dat de switch veroorzaakte, plus minstens 5 min wachttijd tussen twee switches.
3. Een bestaande eigen `apiKeyHelper` van Colin wordt nooit overschreven of verwijderd.
4. Takenlijst uit drie bronnen (TaskCreate/TaskUpdate, TodoWrite, `mcp__ccd_turn__update_plan`) met onvolledige of foute invoer: nooit een crash, hoogstens geen balk.
5. Een key die je typt maar die niet klopt (geen `sk-ant-`): niets opgeslagen, één regel uitleg.

---

### Task 1: Voortgangsbalk

**Files:** Create `lib/voortgang.mjs`, `lib/voortgang.d.mts`, `hooks/voortgang.tsx`, `tests/voortgang-lib.test.mjs`, `tests/voortgang.test.tsx`. Modify `hooks/register.tsx`, `hooks/skins/register.tsx` (AbovePrompt), `hooks/dashboard.tsx` (Overzicht toont de lijst), `types/index.d.ts`.

**Interfaces:**
- `lib/voortgang.mjs`:
  - `type Stap = { id: string; titel: string; status: 'klaar' | 'bezig' | 'open' }`, `type Lijst = { doel: string; stappen: Stap[]; begin: number }`.
  - `pasToe(lijst: Lijst | null, tool: string, input: unknown, result: unknown, nu: number, opdracht: string): Lijst | null` — verwerkt `TaskCreate` (`subject`, id uit result `task.id`/`taskId` of anders tellend), `TaskUpdate` (`taskId`, `status` completed→klaar, in_progress→bezig, pending→open, deleted→weg), `TodoWrite` (`todos: [{content,status}]` vervangt de lijst), `mcp__ccd_turn__update_plan` (`items: [{content,status}]` vervangt; `advance: true` zet de bezig-stap op klaar en de eerste open op bezig; `done: number[]` 1-based klaar; `start: n` bezig). Onbekend of fout → lijst ongewijzigd.
  - `percentage(l: Lijst): number` (afgerond, klaar/alle), `telling(l)` → `{ klaar, bezig, open }`, `huidige(l): Stap | undefined` (bezig, anders eerste open).
  - `doelVan(opdracht: string): string` — eerste regel, max 60 tekens met `…`.
- `hooks/voortgang.tsx`: `registerVoortgang(on)`; `tool.call` met matcher `/^(TaskCreate|TaskUpdate|TodoWrite|mcp__ccd_turn__update_plan)$/` (meten na `next`, alleen hoofdsessie `e.agentId === undefined`); `prompt`-tekst voor het doel uit `voortgang.opdracht` (minify's `prompt.submit` roept `onthoudOpdracht($, tekst)` aan). Exporteert `voortgangRij($: Engine, e: any, kleuren: { accent: string; mut: string; fg: string }): Promise<RenderElement | null>` en `voortgangLijst($)` voor het dashboard; `/futureflow balk` wisselt in/uit.
- Atoms: `voortgang.lijst: Lijst | null`, `voortgang.open: boolean` (onthouden in store `voortgang.open`), `voortgang.klaarSinds: number`.

- [ ] Tests lib: alle drie bronnen; advance/done/start; 100% → `percentage` 100; foute invoer (`null`, string, ontbrekende velden) geeft lijst ongewijzigd.
- [ ] Render: ingeklapt (vorm A) één regel `FutureFlowAI ▰▰▰▰▱▱▱ 57%  ▸ 5/7 <huidige stap>` ("AI" in accentkleur); uitgeklapt (vorm B) doel, elke stap met `✓`/`▸`/`○`, onderaan `n klaar · n bezig · n te gaan · <tijd> bezig`. Knop `voortgang-wissel` (hotkey `v`) wisselt; geen lijst → `null`; bij 100% nog 5 s een ✓-regel, daarna `null` (via `voortgang.klaarSinds` en de klok, geen state-write in render).
- [ ] In `hooks/skins/register.tsx` AbovePrompt: de voortgangsrij boven de verbruiksbalk (kleuren uit de actieve skin: `ok` als accent, `muted`, `fg`); bij skin uit of fout tekent alleen de voortgangsrij met de standaardkleuren. Commentaar `futureflow:`.
- [ ] Dashboard Overzicht: onder de KPI's de lijst uitgeklapt.
- [ ] Hook-tests: TaskCreate×3 + TaskUpdate → rij toont `33%` en de juiste stap; update_plan-invoer werkt ook; `/futureflow balk` klapt uit.
- [ ] validate + tests groen, commit `futureflow: voortgangsbalk`.

### Task 2: Tab Slots in skin-stijl

**Files:** Modify `hooks/slots.tsx` (`slotsTab`), `tests/slots.test.ts` alleen waar teksten wijzigen.

- [ ] Zelfde gegevens en knoppen (keys ongewijzigd), maar getekend als de skin: kopjes in accentkleur, geheugen als blokmeter `▰▰▰▱▱▱▱▱ 38% vrij (6,1 van 16 GB)` gekleurd ok/warn/err (≥ vloer / tussen kritiek en vloer / onder kritiek), slots als lijst met `●` per soort en `bezet n/max`, weigeringen gedimd met tijd; desktop: kaarten-Svg zoals Overzicht (`kaartenSvg`-stijl) voor geheugen en slots. Kleuren via `skinPrefs($)` + `resolveSkin`/`forTheme` (exporteer `actieveKleuren($)` uit `hooks/skins/register.tsx`: `{ accent, mut, fg, ok, warn, err, vlak }`, terugval FFAI-palet).
- [ ] Tests groen, commit `futureflow: tab Slots in skin-stijl`.

### Task 3: Tab Connectors

**Files:** Create `lib/connectors.mjs` + `.d.mts`, `cli/connectors.mjs`, `hooks/connectors.tsx`, `tests/connectors-lib.test.mjs`, `tests/connectors-cli.test.mjs`, `tests/connectors.test.ts`. Modify `hooks/paneel.ts` (TABS), `hooks/dashboard.tsx`, `types/index.d.ts`.

**Interfaces:**
- `lib/connectors.mjs`: `perServer(mcpTools: {name, serverName, tokens, isLoaded}[], uit: string[]): { server, tools, tokens, inContext, uit }[]` gesorteerd op `tokens` aflopend; uitgezette servers zonder tools komen er ook in (tokens 0, `uit: true`).
- `cli/connectors.mjs` (alleen builtins, `CLAUDE_JSON` env voor tests, standaard `~/.claude.json`): `list --cwd <map>` → JSON `{ uit: string[] }`; `zet --cwd <map> --server <naam> --uit|--aan` → leest, wijzigt alleen `projects[cwd].disabledMcpServers`, schrijft atomisch (tmp + rename, zelfde mode); ontbrekend of onleesbaar bestand → exit 2 met melding, niets geschreven.
- `hooks/connectors.tsx`: `connectorsTab($, e)`; leest `$.session.usage({ breakdown: 'summary' })` → `context.breakdown.mcpTools` en de CLI-lijst; per server een rij: naam, aantal tools, tokens nu in context / schema totaal, balkje t.o.v. het contextvenster, knop `conn-<server>` "Uit vanaf volgende sessie"/"Weer aan". Bovenaan: totaal MCP-tokens en % van het venster. Uitleg: "Geldt vanaf de volgende sessie in deze map, net als /mcp."
- Atom `connectors.versie: number` (na een klik ophogen om opnieuw te tekenen).

- [ ] Tests lib, CLI (tijdelijke CLAUDE_JSON: andere sleutels en projecten blijven exact; kapot bestand niet overschreven), hook (rijen, klik roept CLI met juiste argv).
- [ ] Commit `futureflow: tab Connectors`.

### Task 4: Tab API en de switch

**Files:** Create `lib/api.mjs` + `.d.mts`, `cli/api.mjs`, `hooks/api.tsx`, `tests/api-lib.test.mjs`, `tests/api-cli.test.mjs`, `tests/api.test.ts`. Modify `hooks/paneel.ts`, `hooks/dashboard.tsx`, `hooks/register.tsx` (start), `hooks/minify.tsx` (turn.complete roept `apiTurnComplete`), `types/index.d.ts`.

**Interfaces:**
- `lib/api.mjs`:
  - `geldigeKey(s: string): boolean`, `masker(s): string` (`sk-ant-…ABCD`).
  - `HELPER` (exacte string uit Global Constraints).
  - `beslis(s: { modus: 'abonnement'|'api'; auto: boolean; hoog: number; laag: number; limieten: {label: string; percent: number; resetsAt?: number}[]; overgeschakeldDoor?: { label: string; resetsAt?: number }; laatsteWissel: number; nu: number }): { naar: 'api'|'abonnement'; reden: string } | null` — naar API als auto aan, modus abonnement en een limiet ≥ `hoog`; terug als modus api, `overgeschakeldDoor` gezet en (`nu` ≥ zijn `resetsAt`, of een gemeten limiet van dat venster < `laag`); nooit binnen 5 min na `laatsteWissel`.
  - `kosten(usage: {model, input_tokens, output_tokens, cache_read_input_tokens?, cache_creation_input_tokens?}, prijzen): number` (USD) met prijstabel `PRIJZEN` per modelfamilie (opus/sonnet/haiku, per miljoen tokens; waarden uit de officiële prijspagina, in de lib met datum).
- `cli/api.mjs` (builtins; `SETTINGS_JSON` en `SECURITY_BIN` env voor tests): `zet-key` (key via stdin, formaatcheck, dan `security -i` met stdin `add-generic-password -U -s … -a futureflow -w <key>\n`), `wis-key`, `status` → `{ heeftKey, staart, modus, vreemdeHelper }` (staart = laatste 4 via `find-generic-password -w`, nooit de hele key op stdout), `modus api|abonnement` → schrijft/verwijdert alleen onze `apiKeyHelper` (atomisch); een andere helper → exit 3.
- `hooks/api.tsx`: `apiTab($, e)`: `Input` key `api-key` (placeholder `sk-ant-…`, onSubmit → CLI `zet-key` met stdin; daarna veld leeg, toast "Key bewaard in de sleutelhanger"), status-regel (masker of "geen key"), knoppen `api-abonnement` / `api-api` (handmatig), vinkje `api-auto`, marges `api-hoog`/`api-laag` als Input (getal 50-100 / 0-90), kosten vandaag en deze maand (store `api.kosten` per dag), uitleg terminal-only en "geldt voor nieuwe terminal-sessies". `startApi($)` leest status; `apiMeet($)` vanuit `session.measure`-pad: de skins-handler `session.measure` roept hem aan (zelfde regel als turn.complete); `apiTurnComplete($, e)` telt kosten als modus api en roept `beslis`. Bij een wissel: CLI `modus`, toast met reden, store `api.toestand` `{ modus, auto, hoog, laag, overgeschakeldDoor, laatsteWissel }`.
- Atoms `api.toestand`, `api.status`.

- [ ] Tests lib (`beslis`-tabel incl. wachttijd en reset), CLI (nep-`security` script dat argv/stdin logt: key nooit in argv; vreemde helper blijft), hook (verkeerde key → niets opgeslagen + uitleg; knop API roept `modus api`; auto-wissel bij 92% met toast).
- [ ] Commit `futureflow: tab API en wissel abonnement/API`.

### Task 5: Afronden

- [ ] Versie 0.4.0, README (Engels) secties Progress, Connectors, API; `CLAUDE.md` futureflow-sectie aanvullen; spec-aanvulling hieronder in de spec zetten.
- [ ] Hele-branch review, fixes, live terminal-check (balk met TaskCreate, tab Connectors, tab API zonder echte key), commit.

## Aanvulling op de spec (besluiten Colin, 9-11-2026)

- Connectors uitzetten per projectmap, zoals `/mcp`; context per connector zichtbaar.
- API-key in de macOS-sleutelhanger.
- Automatisch naar API vanaf 90% van het 5u- of 7d-venster, terug na de reset (onder 50%); marges instelbaar.
- Kosten: melding bij elke wissel en geschatte API-kosten vandaag/deze maand in het dashboard; geen harde stop.
- Voortgangsbalk tekent in dezelfde balk boven de prompt als de verbruiksmeters van de skin.
- Gemeten: met `apiKeyHelper` in de settings gebruikt een gewone terminal-sessie de helper in plaats van het abonnement (nep-key → "Invalid API key · Fix external API key"); een vanuit de desktop-app geërfde omgeving negeert hem.
- Gemeten bijwerking: in API-modus laadt Claude Code de claude.ai-connectors niet ("claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set"). De tab API en de wisselmelding zeggen dat.
