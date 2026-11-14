# futureflow 10: proxy draait door, houdt de cache warm en meldt dat een sessie wacht Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een open `claude-or`-sessie loopt nooit meer tegen een gestopte proxy, de cache blijft tot 20 minuten na de laatste aanvraag warm, en na 4, 10 en 15 minuten wachten komt er een melding met geluid.

**Architecture:** Tijdregels puur in `lib/proxy.mjs`; `bridge/or-proxy.mjs` houdt per sessie de laatste aanvraag van de hoofdbaan in het geheugen, plant pings en meldingen, en houdt aangemelde processen bij. De shim meldt de sessie aan. De mod is alleen vangnet.

**Tech Stack:** Node-builtins, `sh`, `/usr/bin/curl`, `/usr/bin/osascript`, `/usr/bin/afplay`, `node --test`, `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-11-13-futureflow-proxy-design.md`, sectie "Fase 2b". Uitgangspunt: futureflow 0.17.0 (commit `0481dfe`, werkmap schoon).

## Global Constraints

- Lees eerst `CLAUDE.md` (bullets "Proxy (0.16.0)" en "Proxy 0.17.0"), de spec, en de bestaande `lib/proxy.mjs`, `bridge/or-proxy.mjs`, `bridge/logboek.html`, `tests/proxy*.test.mjs`, en `shimTekst` in `lib/openrouter.mjs`.
- Alle grenzen van plan 8 en 9 gelden: alleen Node-builtins; `lib/proxy.mjs` zonder Node-API's en zonder imports; alleen `127.0.0.1`; geen headers, body of key in log, uitvoer of pagina; tests raken nooit de echte `~/.claude`, `~/.local/bin` of poort `20817`.
- De bewaarde aanvraag en headers staan alleen in het geheugen. Niets daarvan naar schijf, log, `/_ff/*` of een melding.
- Geen aanvraag naar het echte OpenRouter, geen echte `claude-or`. Op poort `20817` kan een proxy van de gebruiker draaien: laat die met rust.
- Tests laten geen echte melding of geluid horen: `OSASCRIPT_BIN` en `AFPLAY_BIN` wijzen in tests naar nep-scripts.
- Niet committen, niet pushen. Geen `rm` met variabelen in shell-commando's. Geen `tsc`.
- Code-commentaar en UI-tekst in het Nederlands; README in het Engels. Pagina: alleen `textContent`.
- Versie wordt `0.18.0` (`plugin.json` en `PROXY_VERSIE`).

## Review Focus

- Een echte aanvraag komt binnen terwijl een ping onderweg is: de ping telt nergens mee en een late ping plant geen nieuwe (Task 2).
- Een ping komt koud terug (cache al weg): het warm houden stopt meteen, er volgt geen tweede dure ping (Task 2).
- De sessie is klaar met een tool-aanroep als laatste antwoord (een tool draait lang): wel warm houden, geen melding (Task 1, 2).
- Een aangemeld proces-id bestaat niet meer: de proxy stopt na de stiltetijd en blijft niet eeuwig draaien (Task 2).
- Een mapnaam met aanhalingstekens of een backslash: de melding toont hem veilig en er wordt geen AppleScript uitgevoerd dat de gebruiker niet bedoelde (Task 1).

---

### Task 1: tijdregels in `lib/proxy.mjs`

**Files:** Modify `futureflow/lib/proxy.mjs`, `futureflow/lib/proxy.d.mts`; Test `futureflow/tests/proxy-lib.test.mjs`

**Interfaces (Produces):**

```ts
export const WARM_STAP_MS: number          // 240_000
export const WARM_MAX_MS: number           // 1_200_000
export const MELD_MS: readonly number[]    // [240_000, 600_000, 900_000]
export type WarmInstelling = { warm: boolean; warmMs: number; meldingen: boolean }
export function warmInstelling(ruw: unknown): WarmInstelling       // standaard { warm: true, warmMs: WARM_MAX_MS, meldingen: true }; warmMs begrensd op 240_000…3_600_000
// Tijdstippen (ms na de laatste echte aanvraag) waarop een ping hoort: stap, 2·stap, … zolang < warmMs.
export function pingMomenten(warmMs: number, stap?: number): number[]
// Het antwoord wacht op de gebruiker: stop_reason is er en is niet 'tool_use' en niet 'pause_turn'.
export function wachtOpGebruiker(stopReason: unknown): boolean
// Body voor een ping: zelfde aanvraag met max_tokens 1 en stream false; `thinking` weg (budget past niet bij 1 token).
export function pingBody(body: Record<string, unknown>): Record<string, unknown>
// Een ping is goed als de status 2xx is en minstens RAAK_GRENS % uit de cache kwam.
export function pingGoed(status: number, gebruik: Gebruik): boolean
export function mapNaam(ruw: unknown): string                      // alleen letters, cijfers, spatie, . _ -; hoogstens 40 tekens; leeg → 'sessie'
export function meldTekst(a: { map: string; wachtMs: number; warmTotMs: number | null }): { titel: string; tekst: string }
export function meldScript(a: { titel: string; tekst: string }): string   // AppleScript voor `display notification`
```

Regels:
- `maakSseLezer().uit()` en `gebruikUitJson` geven ook `stop?: string` terug (`stop_reason` uit `message_delta.delta` of het bovenste niveau). Voeg `stop` toe aan het type `Gebruik`.
- `meldTekst`: titel `claude-or wacht · <map>`; tekst `Al <n> min stil. Cache blijft warm tot <n> min.` of, zonder warm houden of als het voorbij is, `Al <n> min stil. De volgende beurt is zonder cache.` Minuten afgerond naar beneden.
- `meldScript`: `display notification "<tekst>" with title "<titel>"`, met `\` en `"` in beide strings geëscaped. Geen `sound name` (het geluid komt van `afplay`).

- [ ] **Step 1: Falende tests:** `pingMomenten(1_200_000)` → `[240000, 480000, 720000, 960000]`; `pingMomenten(240_000)` → `[]`; `warmInstelling({ warmMs: 5 })` → `warmMs: 240000`; `warmInstelling('x')` → de standaard; `wachtOpGebruiker('end_turn')` → true, `'tool_use'`, `undefined` → false; `pingBody({ max_tokens: 8000, stream: true, thinking: { type: 'enabled' }, model: 'a' })` → `max_tokens: 1`, `stream: false`, geen `thinking`, `model: 'a'`, en het origineel blijft ongewijzigd; `pingGoed(200, { read: 900, in: 100, … })` → true, bij `read: 0` of status 429 → false; `mapNaam('a"b\\c$(x)')` bevat geen `"`, `\`, `$`, `(`; `meldScript` met `"` in de tekst geeft een string waarin dat aanhalingsteken als `\"` staat; de SSE-lezer geeft `stop: 'end_turn'` uit een `message_delta` met `delta.stop_reason`.
- [ ] **Step 2:** falen. **Step 3:** implementeren. **Step 4:** `node --test futureflow/tests/proxy-lib.test.mjs` → groen.

### Task 2: aanmelden, warm houden en meldingen in de proxy

**Files:** Modify `futureflow/bridge/or-proxy.mjs`; Test `futureflow/tests/proxy.test.mjs`

**Interfaces:**
- Env (naast de bestaande): `OR_PROXY_WARM_STAP_MS`, `OR_PROXY_MELD_MS` (komma's), `OSASCRIPT_BIN` (standaard `/usr/bin/osascript`), `AFPLAY_BIN` (standaard `/usr/bin/afplay`), `OR_PROXY_GELUID` (standaard `/System/Library/Sounds/Glass.aiff`), `OR_PROXY_LEEFT_MS` (controle van aangemelde processen, standaard 30 000).
- `<OPENROUTER_DIR>/proxy.json` = `WarmInstelling`; alleen de proxy schrijft het (atomisch); ontbreekt het of is het kapot → de standaard.
- `POST /_ff/sessie` `{ pid: number, sessie: string, map: string }` (met `geldigeSchrijf`) → `{ ok: true }`. `pid` moet een positief geheel getal zijn, anders 400.
- `GET /_ff/warm` → `WarmInstelling`; `POST /_ff/warm` `{ warm?, warmMs?, meldingen? }` (met `geldigeSchrijf`) → de nieuwe `WarmInstelling`, bewaard in `proxy.json`.
- `/_ff/stand` krijgt `wacht: { [sessie]: { map: string, sinds: number, wachtOpGebruiker: boolean, warmTot: number | null, pings: number, pingRead: number, warmGestopt?: string } }` en `aangemeld: number` (levende aangemelde processen).

Gedrag:
- **Doordraaien.** De stil-stop gaat alleen door als er geen levend aangemeld proces is (`process.kill(pid, 0)`, elke `OR_PROXY_LEEFT_MS` gecontroleerd; een dood proces wordt afgemeld) en er `OR_PROXY_STIL_MS` lang geen echte aanvraag was. Pings tellen niet als aanvraag voor de stil-timer.
- **Hoofdbaan.** Per sessie de baan met de grootste invoer (`in + read + write`) van de laatste 2xx-aanvraag. Van die baan bewaart de proxy in het geheugen: body (na modelwissel en vaste aanbieder, zoals verstuurd), headers zoals doorgestuurd, pad, tijd, en of het antwoord op de gebruiker wacht (`wachtOpGebruiker(stop)`).
- **Pings.** Na elke 2xx-aanvraag van de hoofdbaan plant de proxy de momenten uit `pingMomenten(warmMs, stap)`, als `warm` aan staat. Een ping stuurt `pingBody(body)` naar hetzelfde pad met dezelfde headers. Een ping krijgt een logregel met `ping: true` en `telling: 'telt-niet'`, en raakt de vaste aanbieder, `aanbieders.json`, `besluit` en de stil-timer niet. `pingGoed` onwaar → geen verdere pings voor die sessie, `warmGestopt` = `'koud'` of `'fout'`, logregel `actie: 'warm-stop'`.
- Elke nieuwe echte aanvraag van die sessie annuleert geplande pings en meldingen en begint opnieuw. Een ping die nog onderweg is als er een echte aanvraag komt, wordt afgebroken of genegeerd en plant niets.
- **Meldingen.** Als `meldingen` aan staat en het laatste antwoord van de hoofdbaan op de gebruiker wacht: op elk moment uit `MELD_MS` eerst `AFPLAY_BIN <geluid>` en dan `OSASCRIPT_BIN -e <meldScript(meldTekst(...))>`, beide los gestart, fouten genegeerd (één logregel met `fout: 'melding'` mag). `map` uit de aanmelding (`mapNaam`), anders `'sessie'`. Geen melding als het antwoord op een tool-aanroep eindigde.
- Bij stoppen van de proxy alle timers weg.

- [ ] **Step 1: Falende tests** (korte tijden via env, nep-upstream die usage en `stop_reason` per aanvraag instelbaar teruggeeft, nep-scripts voor `osascript` en `afplay` die hun argumenten naar een bestand schrijven):
  - Aanmelden met het pid van een levend hulpproces: na de stiltetijd draait de proxy nog; nadat het hulpproces stopt, eindigt hij met code 0. Zonder aanmelding stopt hij na de stiltetijd zoals nu.
  - `POST /_ff/sessie` zonder `x-ff` → 403; met `pid: -1` → 400.
  - Na één aanvraag (antwoord `end_turn`, grote invoer uit cache) ziet de upstream daarna pings met `max_tokens: 1`, `stream: false`, dezelfde `authorization` en `x-session-id`, en bij vier momenten binnen het venster precies vier pings; het log heeft vier regels met `ping: true`; `/_ff/stand.sessies` telt nog `aanvragen: 1`.
  - Een ping met 0 % uit cache → daarna geen pings meer, `warmGestopt: 'koud'`, logregel `actie: 'warm-stop'`.
  - Een echte aanvraag tussen twee pings zet de reeks terug (de volgende ping komt een stap ná die aanvraag).
  - Antwoord `end_turn` → de nep-`afplay` en nep-`osascript` zijn op de drie momenten aangeroepen, en het script bevat de mapnaam uit de aanmelding en `claude-or wacht`. Antwoord `tool_use` → pings wel, meldingen niet.
  - `POST /_ff/warm { warm: false }` → geen pings; `{ meldingen: false }` → geen meldingen; `proxy.json` bevat de keuze en een herstart van de proxy leest hem terug.
  - In `log.jsonl`, `proxy.json` en `/_ff/stand` staat nergens de test-key of tekst uit de body.
- [ ] **Step 2:** falen. **Step 3:** implementeren. **Step 4:** `node --test futureflow/tests/*.test.mjs` → groen; `node --check futureflow/bridge/or-proxy.mjs`.

### Task 3: shim meldt de sessie aan

**Files:** Modify `futureflow/lib/openrouter.mjs`; Test `futureflow/tests/openrouter-lib.test.mjs`, `futureflow/tests/openrouter-cli.test.mjs`

- Na het bepalen van `SID` en vóór de `exec`: `/usr/bin/curl -fsS -m 2 -X POST -H 'content-type: application/json' -H 'x-ff: 1' -d "{\"pid\":$$,\"sessie\":\"$SID\",\"map\":\"<veilige mapnaam>\"}" http://127.0.0.1:$PP/_ff/sessie >/dev/null 2>&1 || true`. De mapnaam is de laatste padcomponent van `$PWD`, in de shim teruggebracht tot letters, cijfers, punt, streepje en underscore (`tr -cd`), hoogstens 40 tekens. Mislukt het aanmelden, dan start `claude` toch.

- [ ] **Step 1: Falende tests:** de shim-tekst bevat `/_ff/sessie` en `x-ff: 1`; de shim echt gedraaid tegen een echte proxy op een vrije poort (nep-`claude` die 2 s slaapt) → `/_ff/stand.aangemeld` is 1 tijdens de slaap en `wacht`/aanmelding kent de mapnaam; een map met een spatie en een aanhalingsteken in de naam breekt de JSON niet (aanmelding lukt of wordt overgeslagen, `claude` start in beide gevallen).
- [ ] **Step 2:** falen. **Step 3:** implementeren. **Step 4:** groen.

### Task 4: pagina

**Files:** Modify `futureflow/bridge/logboek.html`; Test `futureflow/tests/proxy.test.mjs` (statisch)

- Bovenaan beide tabs een blok "Sessies": per sessie de map, "bezig" of "wacht al <n> min", "cache warm tot <tijd>" of "cache losgelaten" (met de reden bij `warmGestopt`: "een ping kwam niet meer uit de cache" of "een ping gaf een fout"), aantal pings en de tokens die de pings lazen.
- Blok "Warm houden en meldingen": schakelaar warm houden, keuze duur (10, 20, 30 minuten), schakelaar meldingen met geluid, en één dimme regel: "Een ping leest de hele context uit de cache en kost dus een beetje; na de ingestelde tijd laat de proxy de cache los."
- In het logboek: pings herkenbaar (label "ping") en standaard verborgen achter een vinkje "toon pings".

- [ ] **Step 1: Falende tests:** de pagina bevat `Warm houden`, `toon pings`, `/_ff/warm`, geen `innerHTML`, geen externe URL.
- [ ] **Step 2:** falen. **Step 3:** bouwen. **Step 4:** groen; bekijk de pagina in een browser-tool tegen de nep-upstream (een wachtende sessie, een gestopte warm-reeks, de schakelaars, smal, licht en donker) en meld wat je zag.

### Task 5: vangnet in de mod, docs, versie

**Files:** Modify `futureflow/hooks/api.tsx` of `futureflow/hooks/herstart.tsx` (waar `opOpenrouter()` bekend is), `futureflow/hooks/minify.tsx` (alleen de aanroep in de bestaande `turn.complete`), `futureflow/.claude-plugin/plugin.json`, `futureflow/lib/proxy.mjs` (`PROXY_VERSIE`), `CLAUDE.md`, `futureflow/README.md`; Test `futureflow/tests/openrouter.test.ts` of `api.test.ts`

- `bewaakProxy($)`: alleen in een `claude-or`-sessie (`opOpenrouter()`); hoogstens eens per 60 s; `$.http.fetch` naar `<proxy-URL>/_ff/stand` met een korte time-out; geen antwoord → de proxy los starten met `$.process.spawn(['/usr/bin/env', 'node', <~/.claude/futureflow/openrouter/proxy/bridge/or-proxy.mjs>], { env: { PATH met Homebrew vooraan, OPENROUTER_DIR, OR_PROXY_POORT } })` en één toast "Proxy van futureflow opnieuw gestart". Fouten gaan naar `failOpen`; de beurt mislukt er nooit door. Aangeroepen los (zonder `await`) bij `session.start` (via `startApi`) en in de bestaande `turn.complete` van minify, ná `next(e)`.
- `plugin.json` en `PROXY_VERSIE` naar `0.18.0`.
- `CLAUDE.md`: bullet "Proxy 0.18.0" na "Proxy 0.17.0": aanmelden via de shim, wanneer de proxy stopt, warm houden (hoofdbaan, momenten, wat een ping is en niet meetelt, stoppen bij een koude ping), meldingen (wanneer wel en niet, `afplay` + `osascript`), `proxy.json`, de nieuwe paden en env-variabelen, het vangnet, en wat niet live getest is. `README.md` (Engels) bijwerken.

- [ ] **Step 1: Falende tests:** in een `claude-or`-sessie met een proxy die niet antwoordt start `turn.complete` één keer de proxy en toont de toast; een tweede beurt binnen 60 s start niets; buiten `claude-or` gebeurt niets; antwoordt de proxy, dan geen spawn.
- [ ] **Step 2:** falen. **Step 3:** implementeren en docs bijwerken.
- [ ] **Step 4: Alles controleren:**

```bash
claude plugin validate futureflow
claude plugin test futureflow
node --test futureflow/tests/*.test.mjs
node --check futureflow/bridge/or-proxy.mjs
node --check futureflow/cli/api.mjs
pgrep -fl or-proxy
```

Verwacht: validatie "passed" met dezelfde waarschuwingen, alle tests groen (uitgangsstand: 444 plugin-tests, 312 node-tests), en geen testproxy's meer. Time-outs van 5000 ms in tests die je niet aanraakte bij een drukke machine: opnieuw draaien en eerlijk melden.
