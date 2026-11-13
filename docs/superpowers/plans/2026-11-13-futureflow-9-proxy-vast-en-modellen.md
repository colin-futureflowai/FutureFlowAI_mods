# futureflow 9: vaste aanbieder, harde stop en modellen op de proxy-pagina Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De proxy houdt per sessie en model één aanbieder vast, stopt een model dat niet cachet, en de proxy-pagina krijgt een tab Modellen waar je Model 1-5 zoekt, meet, kiest en in lopende sessies wisselt.

**Architecture:** Beslisregels blijven puur in `lib/proxy.mjs`; `bridge/or-proxy.mjs` past de body aan (`provider`, `model`), houdt state in het geheugen en in kleine JSON-bestanden, en roept voor alles wat instellingen of de key raakt de bestaande CLI aan. De pagina praat alleen met `/_ff/*`.

**Tech Stack:** Node-builtins, `sh`, één HTML-bestand zonder bibliotheken, `node --test`, `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-11-13-futureflow-proxy-design.md` (secties Fase 2 en Fase 3). Vorig plan: `docs/superpowers/plans/2026-11-13-futureflow-8-proxy.md` (gebouwd, staat ongecommit in de werkmap als 0.16.0; bouw daarop voort en draai niets terug).

## Global Constraints

- Lees eerst `CLAUDE.md` (repo-root), de spec en de bestaande `lib/proxy.mjs`, `bridge/or-proxy.mjs`, `bridge/logboek.html`, `tests/proxy*.test.mjs`.
- Alle grenzen van plan 8 gelden: alleen Node-builtins; `lib/proxy.mjs` zonder Node-API's en zonder imports; alleen `127.0.0.1`; de key nooit in argv, uitvoer, log of pagina; geen headers of body in het log; tests raken nooit de echte `~/.claude`, `~/.local/bin` of poort `20817` (gebruik `OPENROUTER_DIR`, `SHIM_DIR`, `OPENROUTER_URL`, `OR_PROXY_POORT`, `SECURITY_BIN`).
- Geen aanvraag naar het echte OpenRouter en geen echte `claude-or`: dat kost geld. Op poort `20817` draait nu een proxy 0.16.0 van de gebruiker: laat die met rust.
- De proxy schrijft nooit zelf `settings.json`, de shim of de sleutelhanger: dat doet alleen de CLI.
- Niet committen, niet pushen. Geen `rm` met variabelen in shell-commando's. Geen `tsc`.
- Code-commentaar en UI-tekst in het Nederlands; README in het Engels. In de pagina alle waarden via `textContent`, nooit `innerHTML`.
- Versie wordt `0.17.0` (`plugin.json` en `PROXY_VERSIE`).

## Review Focus

- Twee missers door een pauze, een compact of een wissel van aanbieder die de proxy zelf deed: mogen nooit tot een stop leiden (Task 1).
- De vaste aanbieder geeft 429 nadat de client al bytes kreeg: geen tweede poging, de fout gaat door (Task 2).
- Twee sessies op hetzelfde model tegelijk: elk zijn eigen vaste aanbieder en eigen missertelling; een stop door de ene weigert daarna ook de andere, met dezelfde melding (Task 2).
- Een pagina op een andere site die `POST /_ff/kies` stuurt: geweigerd, er verandert niets (Task 3).
- Een meting die mislukt of `zwak` geeft bij "Meet en kies": het model wordt niet gekozen en de pagina zegt waarom (Task 3, 4).

---

### Task 1: beslisregels in `lib/proxy.mjs`

**Files:**
- Modify: `futureflow/lib/proxy.mjs`, `futureflow/lib/proxy.d.mts`
- Test: `futureflow/tests/proxy-lib.test.mjs`

**Interfaces (Produces, bovenop plan 8):**

```ts
export const MIS_WISSEL: number        // 2: zoveel missers op rij → andere aanbieder
export const MIS_STOP: number          // 2: zoveel missers op rij ná een wissel → model stoppen
export const SLECHT_MS: number         // 86_400_000
export type AanbiederStand = { raak: number; mis: number; fout: number; laatst: number; slechtTot?: number }
export type Aanbieders = Record<string /* model */, Record<string /* aanbieder */, AanbiederStand>>
export function werkAanbiederBij(a: Aanbieders, model: string, aanbieder: string, wat: 'raak' | 'mis' | 'fout' | 'slecht', nu: number): Aanbieders
export function slechte(a: Aanbieders, model: string, nu: number): string[]
// Beste bekende aanbieder: niet slecht, raak > 0, hoogste raak/(raak+mis), bij gelijk de nieuwste; `zonder` slaat namen over.
export function kiesAanbieder(a: Aanbieders, model: string, nu: number, zonder?: string[]): string | undefined
// Zet provider in de body. Heeft de body al `provider`, dan ongewijzigd (zelfde object terug).
export function metAanbieder(body: Record<string, unknown>, vast: string | undefined, negeer: string[]): Record<string, unknown>
export function probeerOpnieuw(status: number): boolean      // 429, 404 en 500-599
export type Baan = { mis: number; gewisseld: boolean }
export type Besluit = { baan: Baan; actie: 'niets' | 'wissel' | 'stop' }
export function besluit(baan: Baan | undefined, telling: Telling): Besluit
export type Rijen = Partial<Record<'m1' | 'm2' | 'm3' | 'm4' | 'm5', string>>
export type RijHistorie = Partial<Record<keyof Rijen, Array<{ id: string; t: number }>>>
export function wisselModel(id: string | undefined, nu: Rijen, historie: RijHistorie): string | undefined
export function isZwak(metingen: unknown, model: string): boolean
export function stopBericht(model: string, poort: number): string
export function zwakMeting(aandeel: number, nu: number): { oordeel: 'zwak'; aandeel: number; raak: 0; van: number; gemeten: number }
export function geldigeSchrijf(a: { host: unknown; origin: unknown; xff: unknown; contentType: unknown; poort: number }): boolean
```

Regels:
- `logRegel` krijgt een optioneel `gewisseld?: boolean`; is dat waar, dan is de telling `telt-niet`. De regel krijgt ook `vast?: boolean` (er stond een vaste aanbieder in de body).
- `metAanbieder`: met `vast` → `provider: { order: [vast], allow_fallbacks: false }`; zonder `vast` en met `negeer` niet leeg → `provider: { ignore: negeer }`; anders de body ongewijzigd.
- `besluit`: `telt-niet` → teller blijft, `niets`. `raak` → teller 0, `niets`. `mis` → teller + 1; bereikt hij `MIS_WISSEL` en `gewisseld` is false → `wissel`, teller 0, `gewisseld: true`; bereikt hij `MIS_STOP` en `gewisseld` is true → `stop`.
- `wisselModel`: ids vergelijken zonder `[1m]`-achtervoegsel; staat `id` in de huidige rijen → `id`; staat het in de historie van rij N (nieuwste vermelding wint bij meerdere rijen) → het huidige id van rij N zonder `[1m]`; anders `id`.
- `isZwak`: `metingen[model]?.oordeel === 'zwak'`, op het id zonder `[1m]`.
- `stopBericht`: `futureflow: <model> cachet niet in deze sessie en is gestopt om kosten te voorkomen. Kies een ander model met /model of op http://127.0.0.1:<poort>/.`
- `geldigeSchrijf`: geldige host (`geldigeHost`), `xff === '1'`, content-type begint met `application/json`, en `origin` ontbreekt of is `http://127.0.0.1:<poort>` of `http://localhost:<poort>`.

- [ ] **Step 1: Falende tests** voor elke functie hierboven, met minstens: de reeks `mis, mis` → `wissel`; daarna `telt-niet, mis, mis` → `stop`; `mis, raak, mis` → `niets`; `kiesAanbieder` slaat een aanbieder over tot `slechtTot` voorbij is; `metAanbieder` laat een body met eigen `provider` ongemoeid; `wisselModel('a/oud', { m1: 'b/nieuw[1m]' }, { m1: [{ id: 'a/oud', t: 1 }] })` → `'b/nieuw'`; `geldigeSchrijf` weigert `origin: 'http://evil.example'` en een ontbrekende `x-ff`.
- [ ] **Step 2:** tests draaien → falen. **Step 3:** implementeren. **Step 4:** `node --test futureflow/tests/proxy-lib.test.mjs` → groen.

### Task 2: vaste aanbieder, terugval, harde stop en modelwissel in de proxy

**Files:**
- Modify: `futureflow/bridge/or-proxy.mjs`, `futureflow/cli/api.mjs`
- Test: `futureflow/tests/proxy.test.mjs`, `futureflow/tests/openrouter-cli.test.mjs`

**Interfaces:**
- Bestanden in `<OPENROUTER_DIR>`: `aanbieders.json` (`Aanbieders`, door de proxy, hoogstens eens per 2 s en bij stoppen geschreven, atomisch), `rijen.json` (`{ nu: Rijen, historie: RijHistorie }`, door de CLI), `cache.json` (bestaat; de proxy leest het bij elke aanvraag als de mtime veranderde en schrijft er alleen een `zwakMeting` voor één model in bij).
- CLI: `zetOpenrouter` schrijft na een geslaagde keuze `rijen.json`: `nu` = de effectieve ids van rij 1-4 (leeg = Model 1) en rij 5 alleen als gekozen; `historie` krijgt per rij het vorige id met tijd als het veranderde (hoogstens 10 per rij). `werkProxyBij` schrijft `<OR_DIR>/proxy/cli.json` = `{ "cli": "<absoluut pad van cli/api.mjs>" }` en kopieert ook `lib/openrouter.mjs` naar `<OR_DIR>/proxy/lib/`.
- `/_ff/stand` krijgt `vast: { [sessie]: { [model]: aanbieder } }` en `gestopt: string[]` (modellen die `cache.json` zwak noemt en die de proxy in deze run heeft geweigerd of gestopt).

Volgorde per aanvraag naar `/v1/messages` met een JSON-body (andere paden en kapotte JSON gaan ongewijzigd door, zoals in plan 8):
1. `model` = `wisselModel(model, rijen.nu, rijen.historie)`; gewijzigd → in de body zetten en in de logregel `van: <oud id>`.
2. `isZwak(cache.json, model)` → geen upstream-aanvraag; antwoord met de status uit de meting hieronder en `foutAntwoord(stopBericht(model, poort))`; logregel met `fout: 'gestopt'`.
3. Vaste aanbieder voor `sessie|model`, anders `kiesAanbieder`; `metAanbieder` met `slechte(...)` als `negeer`.
4. Versturen. Is de status `probeerOpnieuw` en stond er een vaste aanbieder in: `werkAanbiederBij(…, 'fout')`, één keer opnieuw met `kiesAanbieder(…, zonder: [die])` of los met `ignore`; dit gebeurt vóór er iets naar de client gaat. De tweede poging telt als `gewisseld`.
5. Na afloop: de aanbieder uit het antwoord wordt de vaste voor `sessie|model` als er nog geen was; `werkAanbiederBij` met `raak` of `mis`; `besluit` per `sessie|model|baan`:
   - `wissel`: aanbieder `slecht` tot `nu + SLECHT_MS`, vaste aanbieder voor `sessie|model` weg (de volgende aanvraag kiest opnieuw en telt als `gewisseld`), logregel `actie: 'wissel'`.
   - `stop`: `zwakMeting` in `cache.json` (bestaande velden van andere modellen blijven), daarna de CLI los starten met `openrouter poort` (stdin `{}`) zodat de startcheck klopt; logregel `actie: 'stop'`.
- `/api/hello` gaat door maar krijgt geen logregel.
- De CLI start de proxy via `process.execPath` met het pad uit `proxy/cli.json`; ontbreekt dat bestand, dan geen CLI-aanroep en een regel `fout: 'geen-cli'` in het log.

**Meting vooraf (geen kosten, alleen nep-upstream):** stel vast welke status Claude Code het netst toont bij een weigering. Start de proxy op een vrije poort met `OPENROUTER_URL` naar de nep-upstream en `cache.json` met een zwak model; draai `env -i HOME=<tijdelijke map> PATH=… ANTHROPIC_BASE_URL=http://127.0.0.1:<poort> ANTHROPIC_API_KEY=test claude -p "x" --model <zwak model> --output-format json` met status 400 (`invalid_request_error`) en vergelijk met 403; kies de status waarbij Claude Code niet opnieuw probeert en het bericht toont. Lukt dit niet binnen een redelijke tijd (bijvoorbeeld omdat `claude` zonder login niet start), neem dan 400 en meld dat het niet gemeten is. Leg de uitkomst vast in `CLAUDE.md`.

- [ ] **Step 1: Falende tests** (proxy tegen de nep-upstream, die per aanvraag de ontvangen body bewaart en `provider` in het antwoord kan zetten):
  - Eerste aanvraag heeft geen `provider` in de upstream-body; antwoord noemt `Wafer`; de tweede aanvraag van dezelfde sessie en model heeft `provider: { order: ['Wafer'], allow_fallbacks: false }`; een andere sessie zonder historie gaat weer los.
  - Een body die zelf `provider` bevat, komt byte-gelijk aan.
  - Vaste aanbieder geeft 429 → de upstream ziet een tweede aanvraag zonder die aanbieder (`ignore` of een andere `order`); de client krijgt het tweede antwoord (200); `aanbieders.json` telt `fout: 1`.
  - Vier aanvragen met grote invoer en 0 % uit cache: na de derde (tweede misser) logregel `actie: 'wissel'` en de aanbieder is `slecht`; na nog een koude en twee missers logregel `actie: 'stop'`, `cache.json` noemt het model `zwak`, de CLI is aangeroepen met `openrouter poort` (nep-CLI via `proxy/cli.json` die zijn argumenten wegschrijft), en de volgende aanvraag bereikt de upstream niet en geeft `stopBericht`.
  - Missers met een pauze langer dan het venster ertussen leiden niet tot `wissel`. Maak het venster in de test klein met een nieuwe env-variabele `OR_PROXY_VENSTER_MS` (standaard `TELT_VENSTER_MS`), die de proxy aan `logRegel` doorgeeft.
  - Een tweede sessie op een gestopt model krijgt dezelfde weigering.
  - `rijen.json` met `nu: { m1: 'b/nieuw' }` en historie `a/oud` in m1: een aanvraag met `model: 'a/oud'` komt bij de upstream aan als `b/nieuw`; de logregel heeft `model: 'b/nieuw'` en `van: 'a/oud'`.
  - `/api/hello` komt niet in `log.jsonl`.
  - CLI: `modus openrouter --m1 a --m2 b` schrijft `rijen.json` met `nu.m1 = a`, `nu.m2 = b`, `nu.m3 = a`; daarna `--m1 c` zet `historie.m1[0].id = a`; `proxy/cli.json` wijst naar het CLI-bestand; `proxy/lib/openrouter.mjs` is gelijk aan de bron.
- [ ] **Step 2:** falen. **Step 3:** implementeren (met de meting). **Step 4:** `node --test futureflow/tests/*.test.mjs` → groen; `node --check futureflow/bridge/or-proxy.mjs`.

### Task 3: paden voor instellingen

**Files:**
- Modify: `futureflow/bridge/or-proxy.mjs`
- Test: `futureflow/tests/proxy.test.mjs`

**Interfaces (Produces):** alle GET-paden met host-check; alle POST-paden met `geldigeSchrijf`, anders 403 zonder iets te doen. De proxy draait de CLI als kind (`process.execPath <cli> …`), nooit met een key in argv; de uitvoer van de CLI is JSON.

- `GET /_ff/instellingen` → `{ rijen: Rijen, uitleg: Record<rij, string>, metingen: Record<id, CacheMeting>, poort: { ok: boolean | null, redenen: Array<{ id, reden }> }, heeftKey: boolean, cli: boolean, aanbieders: Aanbieders, gestopt: string[] }`. `rijen`, `poort` en `heeftKey` uit de CLI (`status`, en `openrouter poort` met stdin `{}`); zoek in `cli/api.mjs` op welk statusveld zegt dat er een OpenRouter-key is, en voeg zo'n veld toe als het ontbreekt (alleen een boolean). `uitleg` = `SLOT_UITLEG` uit de gekopieerde `lib/openrouter.mjs`.
- `GET /_ff/modellen?ververs=1` → de uitvoer van `openrouter modellen [--ververs]`, per model aangevuld met `teKlein`, `zwak` (uit `cacheStand` met de metingen) en `kiesId` (`modelIdVoor`), allemaal via de gekopieerde `lib/openrouter.mjs`.
- `POST /_ff/meet` `{ model }` → zet het model in de rij en geeft `{ ok: true }`; metingen lopen één voor één (`openrouter cachetest --model <id>`, time-out 240 s). `GET /_ff/meet` → `{ bezig: string | null, rij: string[], laatste: { model, ok, oordeel?, raak?, van?, fout? } | null }`.
- `POST /_ff/kies` `{ rij: 'm1'…'m5', model: string | null, meet?: boolean }`:
  - `model: null` op m2-m5 maakt de rij leeg; op m1 → 400 "Model 1 is verplicht".
  - Ongeldig id (`geldigModel`) → 400.
  - Met `meet: true` en zonder meting: eerst meten; is de uitslag `zwak` of mislukt de meting → 409 `{ ok: false, fout }`, niets gekozen.
  - Dan `modus openrouter --m1 … --m5` met de nieuwe set. Exit 7 → 409 met de foutregel van de CLI; exit 0 → `{ ok: true, rijen }`.
  - Eén keuze tegelijk: loopt er al één, dan 409 "bezig".

- [ ] **Step 1: Falende tests** met een nep-CLI (script in de testmap, via `proxy/cli.json`) die per commando vaste JSON geeft en zijn argumenten wegschrijft: `instellingen` geeft rijen en poort door; `modellen` voegt `teKlein` toe bij een model met 100k context en `zwak` bij een `qwen/`-id; `kies` zonder `x-ff` → 403 en de nep-CLI is niet aangeroepen; met `Origin: http://evil.example` → 403; geldig → de nep-CLI kreeg `modus openrouter` met de juiste `--m…`-vlaggen en geen key; exit 7 van de nep-CLI → 409 met de fouttekst; `meet: true` met uitslag `zwak` → 409 en geen `modus`-aanroep; `model: null` op m1 → 400; twee `kies` tegelijk → de tweede 409; in geen enkel antwoord en in geen argv staat de test-key die de test als `authorization` meestuurt.
- [ ] **Step 2:** falen. **Step 3:** implementeren. **Step 4:** groen.

### Task 4: tab Modellen op de pagina

**Files:**
- Modify: `futureflow/bridge/logboek.html`
- Test: `futureflow/tests/proxy.test.mjs` (alleen statische controles, zoals in plan 8)

- Twee tabs bovenaan: **Modellen** (standaard als er nog geen aanvragen zijn, anders de laatst gekozen tab via `localStorage` in try/catch) en **Logboek** (wat er nu is, plus kolom `actie` en de vaste aanbieder).
- **Modellen**:
  - Vijf rijen "Model 1" t/m "Model 5": gekozen id of "—", de uitleg, een label met de meting (`goed 4/5`, `wisselend 3/5`, `zwak`, `niet gemeten`), de vaste of beste aanbieder met raak/mis, en knoppen **Kies** en (rij 2-5, als gevuld) **Leeg**.
  - Bovenaan één regel met de startcheck: groen "claude-or start met deze keuze" of rood "claude-or start niet: <id reden; …>".
  - Is een model gestopt: rode regel bij de rij met "gestopt: cachet niet" en knop **Meet opnieuw**.
  - **Kies** opent een paneel met een zoekveld (filtert op id en naam terwijl je typt), de knop **Ververs lijst**, en de lijst: naam, id, context, prijs in/uit per Mtok, meting, en de waarschuwingen "te klein voor Claude Code" (`teKlein`) en "cachet niet" (`zwak`). Hoogstens 200 regels in beeld, met "… verfijn je zoekopdracht".
  - Per model één knop: **Kies** (gemeten en niet zwak), **Meet en kies (~35-60k tokens)** (niet gemeten), of uitgeschakeld "cachet niet" (zwak).
  - Tijdens een meting: "Meten: <id> …" met de rij; de knoppen zijn uit. Na afloop de uitslag of de fout in gewone taal.
  - Onder de rijen, dim: "Een wissel geldt meteen voor lopende claude-or-sessies. De eerste beurt daarna is zonder cache." En als het nieuwe model een kleiner contextvenster heeft dan het vorige in die rij: een waarschuwing vóór het kiezen.
  - Zonder key (`heeftKey: false`): "Bewaar eerst een OpenRouter-key in /futureflow, tab 2 Wisselen." en geen knoppen. Zonder CLI (`cli: false`): "Open /futureflow één keer in een sessie; daarna kun je hier kiezen."
- POST-aanvragen sturen `x-ff: 1` en `content-type: application/json`.
- Licht en donker, bruikbaar op telefoonbreedte, geen externe bronnen.

- [ ] **Step 1: Falende tests:** de pagina bevat `Modellen`, `Meet en kies`, `x-ff`, geen `innerHTML`, geen URL naar een andere host; de CSP-header staat er nog.
- [ ] **Step 2:** falen. **Step 3:** bouwen. **Step 4:** groen. Bekijk de pagina in een browser-tool tegen de nep-upstream en de nep-CLI (zoeken, kiezen, meten met `zwak`, een gestopt model, licht/donker, smal); meld wat je zag of dat het niet kon.

### Task 5: mod, docs, versie

**Files:**
- Modify: `futureflow/hooks/openrouter.tsx`, `futureflow/hooks/api.tsx`, `futureflow/.claude-plugin/plugin.json`, `futureflow/lib/proxy.mjs` (`PROXY_VERSIE`), `CLAUDE.md`, `futureflow/README.md`
- Test: `futureflow/tests/openrouter.test.ts`

- De keuze Model 1-5 volgt het eigen settings-bestand: bij `session.start` (in `startApi`, los) en in `bijOpenen` van de tab leest de mod `status` (`orM1`-`orM5`); wijkt dat af van store `openrouter.keuze` en bestaat het settings-bestand, dan wordt de store gelijk aan het bestand. Geen settings-bestand → de store blijft.
- De knop `or-logboek` heet nu "Proxy" met dimme uitleg "modellen kiezen, aanvragen en cache".
- De kaart toont één rode regel als de status een gestopt model meldt (uit `cache.json`, bestaande startcheck-regel volstaat als die het al zegt; voeg dan niets toe).
- `plugin.json` en `PROXY_VERSIE` naar `0.17.0`.
- `CLAUDE.md`: bullet "Proxy 0.17.0" na "Proxy (0.16.0)": vaste aanbieder, terugval, de drempels en het ergste geval (vijf beurten), één bron (`cache.json`), de bestanden `aanbieders.json`, `rijen.json`, `proxy/cli.json`, de paden `/_ff/instellingen|modellen|meet|kies`, de eis `x-ff`, de modelwissel via de historie, de uitkomst van de meting naar de weigerstatus, en wat niet live getest is.
- `README.md` (Engels): de bullet van de proxy bijwerken.

- [ ] **Step 1: Falende tests:** status met andere `orM1`-`orM5` dan de store → na `bijOpenen` toont de kaart de ids uit de status; zonder settings-bestand blijft de store; de knop heet "Proxy".
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

Verwacht: validatie "passed" (dezelfde waarschuwingen als nu), alle tests groen (uitgangsstand: 441 plugin-tests, 284 node-tests), en alleen de proxy van de gebruiker op poort 20817 (als die nog draait). Time-outs van 5000 ms bij een drukke machine: opnieuw draaien en melden.
