# futureflow 8: proxy voor claude-or (fase 1 en 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `claude-or` loopt via een eigen lokale proxy die elke aanvraag ongewijzigd doorgeeft, het verbruik meeleest, per aanvraag een regel logt en een logboek-pagina toont.

**Architecture:** Pure regels in `lib/proxy.mjs`; het proces `bridge/or-proxy.mjs` (http-server op `127.0.0.1:20817`) gebruikt ze. De CLI kopieert de bestanden naar `~/.claude/futureflow/openrouter/proxy/` en zet de proxy-URL in het eigen settings-bestand; de shim start de proxy als die niet draait. Body en antwoord blijven in deze fase ongewijzigd.

**Tech Stack:** Node (alleen builtins: `node:http`, `node:https`, `node:fs`, `node:path`, `node:os`), `sh` in de shim, `/usr/bin/curl` voor de levenscheck, hooks-module in TSX, `node --test` en `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-11-13-futureflow-proxy-design.md`

## Global Constraints

- Lees eerst `CLAUDE.md` in de repo-root (regels voor futureflow, hooks en tests) en de spec.
- Alleen Node-builtins in `lib/proxy.mjs`, `bridge/or-proxy.mjs` en `cli/api.mjs`. `lib/proxy.mjs` gebruikt geen Node-API's en importeert niets (het wordt los gekopieerd).
- De proxy luistert alleen op `127.0.0.1`. Standaardpoort `20817`.
- De OpenRouter-key komt nooit in argv, stdout, stderr, een log of een testuitvoer. De proxy logt geen headers en geen body.
- `ANTHROPIC_BASE_URL` naar de proxy alleen in `~/.claude/futureflow/openrouter/settings.json`, nooit in `~/.claude/settings.json`.
- Tests raken nooit de echte `~/.claude`, `~/.local/bin` of poort `20817`: gebruik `OPENROUTER_DIR`, `SHIM_DIR`, `OPENROUTER_URL` (lokale nep-upstream) en `OR_PROXY_POORT` (vrije poort).
- Code-commentaar en UI-tekst in het Nederlands; README in het Engels. Geen variabele `h` in `.tsx`. Hotkeys alleen cijfer of kleine letter. Tekenen schrijft geen state en start geen CLI.
- Geen `rm` met variabelen in shell-commando's.
- Niet committen en niet pushen: Colin vraagt daar zelf om. Sla de commit-stappen over.
- Versie wordt `0.16.0`.

## Review Focus

- Een gestreamd antwoord waarvan een SSE-regel over twee chunks verdeeld is: de usage moet toch kloppen (Task 1).
- De client breekt een stream af (Esc in Claude Code): de proxy sluit de upstream-verbinding, schrijft één logregel en blijft draaien (Task 2).
- OpenRouter is onbereikbaar: 502 in Anthropic-vorm, geen crash, logregel met `fout` (Task 2).
- Een pagina op een andere site probeert `/_ff/stop` of `/_ff/log` te lezen: geweigerd op `Host` en `Origin` (Task 3).
- De poort is bezet door iets anders dan onze proxy: de shim start `claude` niet en zegt waarom (Task 4).

---

### Task 1: pure regels in `lib/proxy.mjs`

**Files:**
- Create: `futureflow/lib/proxy.mjs`, `futureflow/lib/proxy.d.mts`
- Test: `futureflow/tests/proxy-lib.test.mjs`

**Interfaces (Produces):**

```ts
export const PROXY_POORT: number            // 20817
export const PROXY_VERSIE: string           // '0.16.0', gelijk aan plugin.json (test)
export const PROXY_STIL_MS: number          // 1_800_000
export const LOG_MAX_BYTES: number          // 10 * 1024 * 1024
export const TELT_VENSTER_MS: number        // 300_000
export const TELT_MIN_TOKENS: number        // 1024
export const RAAK_GRENS: number             // 50
export function proxyUrl(poort?: number): string                       // 'http://127.0.0.1:20817'
export function doorHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[]>
export type Info = { model?: string; stream: boolean; baan?: string }
export function aanvraagInfo(bodyTekst: string): Info
export type Gebruik = { in: number; uit: number; read: number; write: number; aanbieder?: string; kosten?: number }
export function gebruikUitJson(obj: unknown): Gebruik
export function maakSseLezer(): { voeg(tekst: string): void; uit(): Gebruik }
export type Telling = 'raak' | 'mis' | 'telt-niet'
export type Regel = { t: number; sessie: string; pad: string; model?: string; baan?: string; stream: boolean; status: number;
  aanbieder?: string; in: number; uit: number; read: number; write: number; aandeel: number; telling: Telling; ms: number; kosten?: number; fout?: string }
export function logRegel(a: { t: number; sessie?: string; pad: string; info: Info; status: number; gebruik: Gebruik; ms: number; fout?: string; vorige?: Regel }): Regel
export type Stand = Record<string, Record<string, { aanvragen: number; raak: number; mis: number; in: number; read: number; aanbieder?: string; laatst: number }>>
export function werkStandBij(stand: Stand, regel: Regel): Stand
export function geldigeHost(host: unknown, poort: number): boolean
export function isEigenPad(pad: string): boolean                        // '/' en alles onder '/_ff/'
export function foutAntwoord(bericht: string): { type: 'error'; error: { type: 'api_error'; message: string } }
```

Regels die de signatuur niet vastlegt:
- `doorHeaders` laat weg (hoofdletterongevoelig): `host`, `connection`, `content-length`, `accept-encoding`, `keep-alive`, `transfer-encoding`, `upgrade`, en alles dat met `proxy-` begint; zet `accept-encoding: identity`. Alle andere headers (ook `authorization`, `x-api-key`, `anthropic-*`, `x-session-id`) blijven.
- `aanvraagInfo`: ongeldige JSON → `{ stream: false }`. `baan` = 8 hex-tekens FNV-1a (zelfde rekenwijze als `cacheBlok` in `lib/openrouter.mjs`) over de systeemtekst (string, of de `text` van alle blokken achter elkaar; eerste 2000 tekens) plus `\n` plus de toolnamen met `,` ertussen. Zonder `system` en zonder `tools` geen `baan`.
- Usage-velden: `input_tokens` → `in`, `output_tokens` → `uit`, `cache_read_input_tokens` → `read`, `cache_creation_input_tokens` → `write`; geen getal of < 0 → 0. `aanbieder` uit `provider` (string) op het bovenste niveau of in `message`. `kosten` alleen als `usage.cost` een eindig getal ≥ 0 is.
- `maakSseLezer`: verwerkt `data:`-regels van `message_start` (`message.usage`, `message.provider`) en `message_delta` (`usage`); latere waarden > 0 overschrijven eerdere; een regel die over chunks verdeeld is, wordt pas verwerkt als de regel compleet is; `data: [DONE]` en kapotte JSON worden overgeslagen.
- `logRegel`: `sessie` ontbreekt → `'onbekend'`; `aandeel` = `round(100 * read / (in + read + write))`, 0 bij totaal 0; `fout` afgekapt op 200 tekens; `telling` volgens de spec (sectie Fase 1), waarbij `vorige` de laatste 2xx-regel van dezelfde sessie, model en baan is.
- `werkStandBij`: telt per `sessie` → `model`; `in` is de som van `in + read + write`, `read` de som van `read`; `aanbieder` en `laatst` van de nieuwste regel. Regels zonder `model` tellen niet mee.

- [ ] **Step 1: Schrijf de falende tests** in `tests/proxy-lib.test.mjs`. Minstens:
  - `PROXY_VERSIE` is gelijk aan `version` in `.claude-plugin/plugin.json`.
  - `doorHeaders({ Host: 'x', Authorization: 'Bearer k', 'Accept-Encoding': 'gzip', 'x-session-id': 's', 'Proxy-Authorization': 'p' })` geeft `authorization`/`Authorization` en `x-session-id` terug, geen host of proxy-header, en `accept-encoding` = `identity`.
  - `aanvraagInfo('{"model":"a/b","stream":true,"system":"S","tools":[{"name":"Read"}]}')` → `model: 'a/b'`, `stream: true`, `baan` matcht `/^[0-9a-f]{8}$/`; dezelfde system als blokkenlijst `[{type:'text',text:'S'}]` geeft dezelfde `baan`; een andere toolnaam geeft een andere; `aanvraagInfo('{kapot')` → `{ stream: false }`.
  - `gebruikUitJson({ provider: 'Wafer', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 30, cache_creation_input_tokens: 5, cost: 0.01 } })` → `{ in: 10, uit: 2, read: 30, write: 5, aanbieder: 'Wafer', kosten: 0.01 }`; `gebruikUitJson(null)` → alles 0.
  - SSE-lezer: `message_start` met `usage.input_tokens: 100, cache_read_input_tokens: 400` en `message_delta` met `usage.output_tokens: 7`, aangeboden in chunks die midden in een `data:`-regel breken → `{ in: 100, uit: 7, read: 400, write: 0 }`.
  - `logRegel`: zonder `vorige` → `telt-niet`; met `vorige` 60 s eerder, invoer 5000 tokens waarvan 4000 uit cache → `raak` en `aandeel: 80`; 500 uit cache → `mis`; `vorige` 6 min eerder → `telt-niet`; invoer 800 → `telt-niet`; invoer minder dan de helft van `vorige` → `telt-niet`; status 429 → `telt-niet`.
  - `werkStandBij` telt twee regels van één sessie en model op.
  - `geldigeHost('127.0.0.1:20817', 20817)` en `'localhost:20817'` → true; `'evil.example:20817'`, `'127.0.0.1:1'`, `undefined` → false.
  - `isEigenPad('/')`, `'/_ff/stand'` → true; `'/v1/messages'`, `'/_ffx'` → false.
- [ ] **Step 2:** `node --test futureflow/tests/proxy-lib.test.mjs` → faalt (module ontbreekt).
- [ ] **Step 3:** Schrijf `lib/proxy.mjs` en `lib/proxy.d.mts`.
- [ ] **Step 4:** `node --test futureflow/tests/proxy-lib.test.mjs` → groen.

### Task 2: het proxy-proces

**Files:**
- Create: `futureflow/bridge/or-proxy.mjs`
- Test: `futureflow/tests/proxy.test.mjs`

**Interfaces:**
- Consumes: alles uit Task 1 via `import … from '../lib/proxy.mjs'`.
- Produces: het proces `node bridge/or-proxy.mjs`. Env: `OR_PROXY_POORT` (standaard `PROXY_POORT`), `OPENROUTER_URL` (standaard `https://openrouter.ai/api`; `http://` mag, voor tests), `OPENROUTER_DIR` (standaard `~/.claude/futureflow/openrouter`), `OR_PROXY_STIL_MS` (standaard `PROXY_STIL_MS`). Schrijft `<OPENROUTER_DIR>/log.jsonl`. Exitcode 0 bij stil-stop en `/_ff/stop`; 2 als de poort bezet is (één regel op stderr).

Gedrag:
- Luistert op `127.0.0.1:<poort>`.
- `GET /_ff/stand` → `{ versie: PROXY_VERSIE, sinds, poort, sessies: <Stand> }`.
- `POST /_ff/stop` → `{ ok: true }`, daarna stoppen zodra er geen aanvraag meer loopt. Met een `Origin`-header: 403.
- Eigen paden (`isEigenPad`) met een ongeldige `Host` → 403. `/_ff/log` en `/` komen in Task 3; tot dan 404.
- Elk ander pad: de hele body bufferen, `aanvraagInfo` bepalen, doorsturen naar `<OPENROUTER_URL><pad+query>` met `doorHeaders` (en de juiste `host` en `content-length`). Status en antwoordheaders ongewijzigd terug (zonder `content-length` als er gestreamd wordt), de body chunk voor chunk doorgeven.
- Meelezen: `content-type` begint met `text/event-stream` → `maakSseLezer`; anders de JSON-body (hoogstens 5 MB bufferen voor het meelezen; groter = geen usage) → `gebruikUitJson`. Een foutbody levert `fout` = `error.type` als die er is.
- Na afloop één `logRegel` toevoegen aan `log.jsonl` (append; vóór het schrijven roteren naar `log.1.jsonl` als het bestand ≥ `LOG_MAX_BYTES` is) en de stand bijwerken. De laatste 2xx-regel per `sessie|model|baan` staat in een Map in het geheugen (hoogstens 2000 sleutels; de oudste valt weg).
- Sluit de client de verbinding voortijdig: upstream afbreken, logregel met `fout: 'afgebroken'`.
- Upstream onbereikbaar of een netwerkfout vóór de eerste byte: 502 met `foutAntwoord('futureflow-proxy: OpenRouter is niet bereikbaar')`, logregel met `fout`.
- Stil-timer: geen lopende aanvraag en `OR_PROXY_STIL_MS` lang geen aanvraag → stoppen.
- Vangt `uncaughtException` niet af om door te draaien: één regel op stderr zonder inhoud van aanvragen, exit 1.

- [ ] **Step 1: Schrijf de falende tests** in `tests/proxy.test.mjs`. Hulp in het testbestand: een nep-upstream (`node:http`) die aanvragen bewaart en per pad een JSON-antwoord of een SSE-stroom in losse chunks geeft; `start({ stil })` die een vrije poort zoekt, de proxy als kind start met `OPENROUTER_DIR` in een tijdelijke map en wacht tot `/_ff/stand` antwoordt. Tests:
  - JSON: `POST /v1/messages` met body `{"model":"a/b","max_tokens":1}` en headers `authorization: Bearer test-key`, `x-session-id: s1` → de upstream kreeg exact dezelfde bytes, `authorization` en `x-session-id`; het antwoord is byte-gelijk; `log.jsonl` heeft één regel met `sessie: 's1'`, `model: 'a/b'`, `status: 200`, de usage van de upstream en `telling: 'telt-niet'`; het bestand bevat nergens `test-key`.
  - Query blijft: `GET /v1/models?x=1` komt bij de upstream aan als `/v1/models?x=1`.
  - SSE: het gestreamde antwoord komt compleet en in volgorde aan; de logregel heeft `stream: true` en de usage uit `message_start` + `message_delta`.
  - Twee aanvragen met dezelfde sessie, model, system en tools, waarvan de tweede 5000 invoertokens met 4000 uit cache meldt → tweede regel `telling: 'raak'`; `/_ff/stand` toont `aanvragen: 2`, `raak: 1`.
  - Upstream-fout 429 met body `{"type":"error","error":{"type":"rate_limit_error","message":"x"}}` → client krijgt 429 en dezelfde body; logregel `status: 429`, `fout: 'rate_limit_error'`.
  - Upstream onbereikbaar (`OPENROUTER_URL` naar een dichte poort) → 502, body is `foutAntwoord(...)`, proxy draait nog.
  - Client breekt een SSE-stroom af → upstream ziet de verbinding sluiten, logregel `fout: 'afgebroken'`, proxy draait nog.
  - `/_ff/stand` met `Host: evil.example` → 403; `POST /_ff/stop` met `Origin: http://x` → 403; `POST /_ff/stop` zonder → 200 en het proces eindigt met code 0.
  - Stil-stop: met `OR_PROXY_STIL_MS=300` eindigt het proces vanzelf met code 0.
  - Poort bezet: een tweede proxy op dezelfde poort eindigt met code 2.
- [ ] **Step 2:** `node --test futureflow/tests/proxy.test.mjs` → faalt.
- [ ] **Step 3:** Schrijf `bridge/or-proxy.mjs`.
- [ ] **Step 4:** `node --test futureflow/tests/proxy.test.mjs` → groen; `node --check futureflow/bridge/or-proxy.mjs`.

### Task 3: logboek

**Files:**
- Create: `futureflow/bridge/logboek.html`
- Modify: `futureflow/bridge/or-proxy.mjs`
- Test: `futureflow/tests/proxy.test.mjs`

**Interfaces:**
- Produces: `GET /_ff/log?na=<ms>&max=<n>` → JSON-array van `Regel`, oudste eerst, alleen `t > na`, hoogstens `max` (standaard 500, bovengrens 2000) nieuwste regels; leest `log.jsonl` (en `log.1.jsonl` als `log.jsonl` minder dan `max` regels geeft); kapotte regels overslaan. `GET /` → `logboek.html` (naast het script gelezen), `content-type: text/html; charset=utf-8`, `cache-control: no-store`, en `content-security-policy: default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'`.

Pagina (Nederlands, één bestand, geen externe bronnen, licht en donker via `prefers-color-scheme`):
- Kop "FutureFlowAI · OpenRouter-logboek" met versie en "draait sinds".
- Samenvatting per sessie en model uit `/_ff/stand`: aanvragen, raak, mis, % uit cache, aanbieder, laatste aanvraag. `mis` > 0 valt op.
- Tabel met aanvragen, nieuwste boven: tijd, sessie (eerste 8 tekens), model, aanbieder, status, in, uit, % uit cache, telling, duur, fout.
- Filters: sessie en model (keuzelijsten uit de data), en "alleen missers en fouten".
- Ververst elke 3 s met `na` = de nieuwste `t`; houdt hoogstens 2000 regels in beeld. Alle waarden gaan via `textContent` in de pagina, nooit via `innerHTML`.
- Leeg log: "Nog geen aanvragen. Start een sessie met claude-or."

- [ ] **Step 1: Falende tests** (toevoegen aan `tests/proxy.test.mjs`): na drie aanvragen geeft `/_ff/log` drie regels; `?na=<t van de eerste>` geeft twee; `?max=1` geeft de nieuwste; een kapotte regel in `log.jsonl` wordt overgeslagen; `/_ff/log` met `Host: evil.example` → 403; `GET /` → 200, `text/html`, de CSP-header, en de body bevat `OpenRouter-logboek`; de pagina bevat geen `http://` of `https://` naar een andere host en geen `innerHTML`.
- [ ] **Step 2:** test draaien → faalt.
- [ ] **Step 3:** Schrijf `logboek.html` en de twee paden.
- [ ] **Step 4:** tests groen. Start de proxy los tegen een nep-upstream, stuur een paar aanvragen en bekijk `http://127.0.0.1:<poort>/` in een browser-tool als die beschikbaar is; meld anders dat de pagina niet bekeken is.

### Task 4: CLI en shim

**Files:**
- Modify: `futureflow/lib/openrouter.mjs`, `futureflow/lib/openrouter.d.mts`, `futureflow/cli/api.mjs`
- Test: `futureflow/tests/openrouter-lib.test.mjs`, `futureflow/tests/openrouter-cli.test.mjs`

**Interfaces:**
- Consumes: `PROXY_POORT`, `PROXY_VERSIE`, `proxyUrl` uit `lib/proxy.mjs`.
- Produces:
  - `orInstellingen(k)` zet `env.ANTHROPIC_BASE_URL` op `proxyUrl()`; de rest blijft.
  - `shimTekst(settingsPad: string, poortPad?: string, proxy?: { script: string; poort?: number }): string`. Zonder `proxy`: `<map van settings>/proxy/bridge/or-proxy.mjs` en `PROXY_POORT`.
  - CLI: `werkProxyBij()` kopieert `bridge/or-proxy.mjs`, `bridge/logboek.html` en `lib/proxy.mjs` naar `<OR_DIR>/proxy/bridge/` en `<OR_DIR>/proxy/lib/` (alleen schrijven bij verschil, atomisch zoals de andere bestanden), en stuurt `POST /_ff/stop` naar een draaiende proxy waarvan `versie` ≠ `PROXY_VERSIE` (time-out 2 s; geen antwoord = niets doen). Aangeroepen in `zetOpenrouter` en `poort()` als het eigen settings-bestand bestaat.
  - `poort()` vervangt in het eigen settings-bestand `env.ANTHROPIC_BASE_URL` door `proxyUrl()` alleen als de waarde exact de oude OpenRouter-URL (`OR_URL`) is; uitvoer krijgt `proxy: true|false` (of het settings-bestand nu naar de proxy wijst).
  - `status` geeft `orProxy: boolean` en `orLogboek: string` (de URL) als het eigen settings-bestand naar de proxy wijst.
  - Poort in CLI en shim: `OR_PROXY_POORT` uit de omgeving, anders `PROXY_POORT`.

Shim, na de startcheck en vóór de `exec` (tekst vrij, gedrag vast):
- `curl -fsS -m 2 http://127.0.0.1:<poort>/_ff/stand` via `/usr/bin/curl`. Lukt dat niet: de proxy los starten met `PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" nohup /usr/bin/env node '<script>' >/dev/null 2>&1 &`, en hoogstens 5 s (stappen van 0,2 s) wachten tot `/_ff/stand` antwoordt.
- Antwoordt hij dan nog niet: `claude-or: de proxy van futureflow start niet (poort <poort>). Open /futureflow, tab 2 Wisselen en klik Gebruik nu, of kijk of iets anders poort <poort> gebruikt.` op stderr en `exit 1`.
- Bestaat het proxy-script niet: dezelfde melding met "klik Gebruik nu", `exit 1`.
- Het antwoord van `/_ff/stand` moet `"versie"` bevatten; iets anders op die poort telt als niet gestart.

Let op: het opruimen van oude OpenRouter-regels in `~/.claude/settings.json` (`ruimOp`, `eigenBasis`, `pasToe`/`haalWeg`) blijft de oude `OR_URL` herkennen; `test` en `cachetest` in de CLI blijven rechtstreeks naar OpenRouter gaan.

- [ ] **Step 1: Falende tests.**
  - lib: `orInstellingen({ m1: 'a/b' }).env.ANTHROPIC_BASE_URL === 'http://127.0.0.1:20817'`; de shim-tekst bevat het proxy-script, `/_ff/stand` en `exit 1` bij een proxy die niet start.
  - Shim echt draaien (`sh`), met een nep-`claude` op het PATH die zijn argumenten en `FUTUREFLOW_OPENROUTER` wegschrijft: (a) proxy-script ontbreekt → exit 1, nep-`claude` niet gestart, melding op stderr; (b) proxy-script is de echte proxy op een vrije poort (`OR_PROXY_POORT`, `OPENROUTER_DIR` tmp) → nep-`claude` start en `/_ff/stand` antwoordt daarna; (c) proxy draait al → geen tweede proces, `claude` start; (d) poort bezet door een server die `hallo` antwoordt → exit 1.
  - CLI: `modus openrouter --m1 …` (met metingen in `cache.json`, zoals de bestaande tests) schrijft settings met de proxy-URL en zet de drie proxybestanden neer, gelijk aan de bron; `openrouter poort` op een settings-bestand met de oude OpenRouter-URL zet de proxy-URL en geeft `proxy: true`; een andere, vreemde `ANTHROPIC_BASE_URL` blijft staan en geeft `proxy: false`; een draaiende proxy met een andere versie (nep-server die `{ versie: 'oud' }` geeft en `/_ff/stop` bijhoudt) krijgt `POST /_ff/stop`; `status` geeft `orProxy: true` en `orLogboek`.
  - Pas bestaande tests aan die de oude base-URL verwachten.
- [ ] **Step 2:** `node --test futureflow/tests/openrouter-lib.test.mjs futureflow/tests/openrouter-cli.test.mjs` → de nieuwe tests falen.
- [ ] **Step 3:** Implementeer.
- [ ] **Step 4:** `node --test futureflow/tests/*.test.mjs` → alles groen.

### Task 5: mod, docs, versie

**Files:**
- Modify: `futureflow/hooks/openrouter.tsx`, `futureflow/hooks/api.tsx` (alleen als de status-atom het nieuwe veld moet doorgeven), `futureflow/types/index.d.ts` (als de status daar getypeerd is), `futureflow/.claude-plugin/plugin.json`, `CLAUDE.md`, `futureflow/README.md`
- Test: `futureflow/tests/openrouter.test.ts`, `futureflow/tests/paneel-ui.test.ts`

- Knop `or-logboek` ("Logboek") in de OpenRouter-kaart onder Meer, alleen als de status `orProxy` meldt, met dimme uitleg "aanvragen en cache per sessie". Klik: in de terminal `$.process.run(['/usr/bin/open', <orLogboek>])`; zonder terminal (`session.surfaces()` zonder `terminal`) of bij een fout een toast `Logboek: <url>`. De URL komt uit de status-atom; tekenen start geen CLI.
- `plugin.json` naar `0.16.0`.
- `CLAUDE.md`: nieuwe bullet "Proxy (0.16.0, …)" na "Startcheck (0.15.0)": wat de proxy doet, de bestanden en hun kopie, poort, de paden `/_ff/*`, het logformaat in één regel, de env-variabelen voor tests, de overgang via `openrouter poort`, en wat niet live getest is. In het blok Structuur de regel over `bridge/` laten kloppen voor futureflow. Bij "Checken vóór commit" geldt `node --check <mod>/bridge/*.mjs` nu ook voor futureflow.
- `futureflow/README.md` (Engels): bullet "**Local proxy** (0.16.0)" met logboek-URL.

- [ ] **Step 1: Falende tests:** de kaart toont `or-logboek` alleen met `orProxy`; een klik in de terminal start `/usr/bin/open` met de URL; zonder terminal een toast met de URL; de kaart past op 44 en 100 kolommen (bestaande opzet van `paneel-ui.test.ts`).
- [ ] **Step 2:** `claude plugin test futureflow` → de nieuwe tests falen.
- [ ] **Step 3:** Implementeer en werk de docs bij.
- [ ] **Step 4: Alles controleren:**

```bash
claude plugin validate futureflow
claude plugin test futureflow
node --test futureflow/tests/*.test.mjs
node --check futureflow/bridge/or-proxy.mjs
node --check futureflow/cli/api.mjs
```

Verwacht: validatie "passed" (waarschuwingen mogen, zoals nu), alle tests groen. Time-outs van 5000 ms in de plugin-tests bij een drukke machine: opnieuw draaien, en in het verslag zeggen dat het een time-out was.
