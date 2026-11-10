# futureflow 6: Accounts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wisselen tussen Colins eigen, apart betaalde Claude-abonnementen in de terminal: kopie van een login bewaren, verbruik per account zien, met de hand wisselen, en automatisch wisselen vóór een limiet — eerst naar een ander abonnement met ruimte, pas als alle abonnementen vol zitten naar de API (bestaande switch), en terug zodra een abonnement weer ruimte heeft.

**Architecture:** Binnen de bestaande mod `futureflow/`. Alles met de Keychain, `~/.claude.json`, de locks van Claude Code en het netwerk zit in een nieuwe Node-CLI `cli/accounts.mjs` (alleen builtins). Pure logica (keuze van het account, de ketting met `beslis`, maskeren, poll-plan, sessie-telling) in `lib/accounts.mjs` met `.d.mts`; tests met `node --test`. De mod (`hooks/accounts.tsx`) tekent tab 7 en roept de CLI aan via `$.process.run(['/usr/bin/env','node',…])`, altijd ná `next(e)`.

**Tech Stack:** Claude Code mods (hooks-module, `$`-API, build 2.1.322), Node-builtins (globale `fetch`), macOS `/usr/bin/security`.

**Spec:** `docs/superpowers/specs/2026-11-08-futureflow-supermod-design.md`, sectie 6 Accounts (bijgewerkt 10-11-2026). **Bron:** claude-swap (MIT), github.com/realiti4/claude-swap, commit `5ac68bfbfb7f7ecfbf9f724d9bd82fcb5fcc022d`. Onderzoek met bestand:regel-verwijzingen: zie "Wat claude-swap doet" hieronder.

## Wat claude-swap doet (samenvatting voor de builder)

Verwijzingen naar `src/claude_swap/` in die commit.

- **Login op macOS**: Keychain generic password, service `Claude Code-credentials`, account `$USER` (`credentials.py:115-117`, `macos_keychain.py:78-95`). Inhoud: JSON `{ claudeAiOauth: { accessToken, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier, … }, mcpOAuth?, … }`. Identiteit staat los daarvan in `~/.claude.json` → `oauthAccount` (`emailAddress`, `accountUuid`, `organizationUuid`, …) (`switcher.py:3490-3506`). Met `CLAUDE_CONFIG_DIR` heet het item `Claude Code-credentials-<sha256[:8]>` (`session.py:300-311`).
- **Gedeelde velden**: `mcpOAuth`, `mcpOAuthClientConfig`, `mcpXaaIdp`, `mcpXaaIdpConfig`, `pluginSecrets` horen bij de Mac, niet bij het account; bij een wissel blijft de live versie staan (`credentials.py:229-305`).
- **Toevoegen**: identiteit uit `oauthAccount`, live credential lezen, controleren dat het token echt van dat account is (`GET /api/oauth/profile`), kopie in eigen Keychain-item (`switcher.py:4016-4105`). Nooit `/logout` tussen accounts (README:58).
- **Wisselen** (`switcher.py:7446-7760`): onder drie locks (eigen → Claude Code's credential-locks → `~/.claude.json.lock`), alleen lokale I/O: uitgaande login terug in zijn kopie, doel + live gedeelde velden in het live item, alleen `oauthAccount` vervangen (atomisch), terugdraaien bij een fout.
- **Locks van Claude Code** (`claude_locks.py:1-31`, `46-91`): mappen (`mkdir`), `~/.claude/.oauth_refresh.lock` dan `~/.claude.lock` (stale na 60 s), `~/.claude.json.lock` (stale na 10 s); vasthouden = mtime elke 3 s aanraken; max 9 s wachten per lock.
- **Keychain schrijven** (`macos_keychain.py:43-62`, `161-204`): `/usr/bin/security -i` met de opdracht `add-generic-password -U -a … -s … -X <hex>` op stdin; alleen als die regel > 4032 bytes is via argv.
- **Lopende sessies**: Claude Code leest de Keychain met ~30 s cache; bestaat `~/.claude/.credentials.json`, dan bumpt claude-swap zijn mtime (nooit aanmaken) (`credentials.py:1042-1128`, README:243).
- **Verbruik**: `GET https://api.anthropic.com/api/oauth/usage`, `Authorization: Bearer`, `anthropic-beta: oauth-2025-04-20` → `five_hour`/`seven_day` met `utilization` (%) en `resets_at` (`oauth.py:494-504`, `720-768`). Rate limit ~28-30 per uur per identiteit: vloer 180 s per account, 300-600 s voor een stil account, 600 s als uitgeput, na een 429 minstens 360 s en ×1.5 tot 1800 s (`poll_policy.py:3-153`).
- **Refresh**: `POST https://platform.claude.com/v1/oauth/token` `{grant_type:"refresh_token", refresh_token, client_id}` (publieke client-id van Claude Code, `oauth.py:20-21`, `242-325`). Elk refresh-token werkt één keer; de opvolger altijd bewaren. `invalid_grant` = lijn dood, opnieuw inloggen. Het actieve account ververst claude-swap nooit met een oude kopie; Claude Code roteert dat token zelf, dus de kopie moet bijgewerkt worden vanaf live (`switcher.py:4653-4742`).
- **Auto** (`docs/auto-switch.md`, `settings.py:57-63`): grens 90 %, cooldown 300 s, hysterese 10 punten, strategie `best` (blijven tot de grens, dan meeste ruimte).

## Op deze Mac gezien (10-11-2026, alleen lezen)

- `Claude Code-credentials` bestaat (`login.keychain-db`, acct = macOS-gebruiker). Live item ~11,9 KB, waarvan `mcpOAuth` ~11,4 KB en `claudeAiOauth` ~0,5 KB → het hele item past **niet** in één `security -i`-regel; alleen de account-kopie wel.
- `~/.claude/.credentials.json` en `~/.claude/.config.json` bestaan niet.
- `oauthAccount` in `~/.claude.json` heeft o.a. `accountUuid, emailAddress, organizationUuid, organizationName, organizationType, billingType, seatTier, userRateLimitTier, displayName`.
- Claude Code schrijft zelf `~/.claude/sessions/<pid>.json` met `pid, sessionId, procStart, kind, entrypoint ("cli" | "claude-desktop"), status ("busy" | "idle" | "waiting"), statusUpdatedAt`. Bruikbaar als tweede signaal voor "bezig", ook voor sessies zonder futureflow.

## Global Constraints

- UI-teksten en code-commentaar Nederlands; README Engels.
- Validator: `$` alleen aan `function`-declaraties; per event één ongematchte handler in de hele module (ongematcht nu: `session.start` register.tsx, `turn.complete` minify.tsx, `tool.call` + `session.end` slots.tsx, `prompt.submit` minify.tsx, `turn.start`/`config.set`/`ui.invalidate`/`session.measure` skins). Accounts krijgt **geen** eigen ongematchte handler: die eigenaars roepen een geëxporteerde functie van `hooks/accounts.tsx` aan (zoals `apiMeetLos`). Een gematchte `tool.call` (`{ tool: /^/ }`) voor de hartslag mag. Atoms in het bestand dat ze leest of schrijft; geen variabele `h`; render schrijft nooit state.
- `types/index.d.ts` blijft één zelfstandig bestand; nieuwe state-sleutels met prefix `accounts.`; `DashboardTab` krijgt `'accounts'`.
- Elke hook faalt open (try/catch → `failOpen` + `next(e)`). **Wisselen faalt dicht**: bij elke twijfel (onbekende identiteit, oude meting, onleesbare state, lock niet gekregen, bezige sessie) niet wisselen.
- **Geheimen alleen in de Keychain**, onder futureflow's eigen services: `futureflow-accounts` (kopie), `futureflow-accounts-vorige` (vorige generatie), `futureflow-accounts-redding` (live login die bij geen bekend account hoort); account-naam `<accountUuid>:<organizationUuid>`. Nooit in een bestand, state, store, log, toast, stdout of stderr. Tokens nooit in argv, behalve de ene uitzondering hieronder.
- Kopie = het credential-object **zonder** de gedeelde sleutels (`mcpOAuth`, `mcpOAuthClientConfig`, `mcpXaaIdp`, `mcpXaaIdpConfig`, `pluginSecrets`) → ~1 KB, gaat altijd via stdin van `security -i` met `-X <hex>`.
- Uitzondering (open vraag 1): het **live** item (`Claude Code-credentials`) is met `mcpOAuth` ~12 KB; past de `security -i`-regel niet (> 4032 bytes), dan argv met `-X <hex>`, precies zoals Claude Code en claude-swap. Werkt alleen via `/usr/bin/security` met absoluut pad.
- Getoond wordt alleen: gemaskeerd e-mailadres (`co…@domein.nl`), plan, percentages, tijden. Een vingerafdruk van een token is `sha256(token).slice(0,12)` en wordt alleen in `~/.claude/futureflow/accounts/` bewaard, nooit getoond.
- State in `~/.claude/futureflow/accounts/` (map 700, bestanden 600): `accounts.json` (lijst, actief, instellingen), `gebruik.json` (metingen + poll-plan), `config/<uuid>.json` (kopie van `oauthAccount`), `sessies/<sessionId>.json`, `wissel.lock`, `refresh-<uuid>.lock`, `log.jsonl` (zonder geheimen). Schrijven altijd atomisch (tmp met `wx` + rename).
- Alleen macOS en het standaardprofiel: staat `CLAUDE_CONFIG_DIR` of `CLAUDE_SECURESTORAGE_CONFIG_DIR` in de omgeving van de CLI, dan alleen `status` en verder exit 8 ("eigen profiel; wisselen niet ondersteund").
- **Alleen terminal.** In een sessie met `CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH` (desktop-app) toont de tab het verbruik, maar zijn toevoegen/wisselen/verwijderen/auto uit, met de tekst: "De desktop-app regelt zijn eigen login; wisselen werkt alleen voor terminal-sessies." Desktop-sessies tellen niet mee als "bezig" en nemen geen wisselbesluiten.
- Geen melding over voorwaarden (besluit Colin 10-11-2026). Wel in de tab: "Elk account is een apart betaald abonnement; futureflow wisselt alleen tussen accounts die je zelf toevoegde." en "Nooit /logout tussen accounts: log in met /login."
- CLI-spawns krijgen een vaste `env` bovenop de host (zoals `CLI_ENV` in `hooks/api.tsx`): `SECURITY_BIN=/usr/bin/security`, `ACCOUNTS_HOME=''`, `CLAUDE_JSON=''`, `CLAUDE_HOME=''`, `ACCOUNTS_API=''`, `KEYCHAIN_USER=''`.
- Netwerk nooit onder een lock, behalve een refresh van een **niet-actief** account onder zijn eigen `refresh-<uuid>.lock`.
- Checks vóór commit: `claude plugin validate futureflow`, `claude plugin test futureflow`, `node --check futureflow/cli/*.mjs`, `node --test futureflow/tests/*.test.mjs`.

## Review Focus

1. **Token-refresh van Claude Code tegelijk met een wissel.** Claude Code leest → POST → bewaart onder `~/.claude/.oauth_refresh.lock` + `~/.claude.lock`. De wissel neemt diezelfde locks in dezelfde volgorde (mkdir, stale pas na 60 s, nooit eerder overnemen), leest het live item pas ónder de lock, en schrijft het als kopie van het uitgaande account terug. Test: een vastgehouden lockmap → wissel wacht max 9 s en faalt dan zonder iets te schrijven; een lock ouder dan 60 s wordt via `<lock>.takeover` overgenomen.
2. **Wissel terwijl een sessie midden in een beurt zit.** Alleen wisselen als geen enkele bekende terminal-sessie bezig is: eigen sessiebestanden (`bezig` met hartslag < 10 min) én Claude Code's `~/.claude/sessions/<pid>.json` (`entrypoint: "cli"`, pid levend, `status` `busy` of `waiting`), eigen sessie uitgezonderd. Onleesbaar = bezig. De check gebeurt opnieuw ónder `wissel.lock`. Max 10 min wachten, daarna niet wisselen maar melden.
3. **Een kapotte Keychain-kopie.** Elke schrijfactie: eerst de oude kopie naar `futureflow-accounts-vorige`, dan schrijven, terug lezen, JSON parsen en vergelijken; mislukt dat, de vorige terugzetten en exit 5. Een kopie die geen `claudeAiOauth.refreshToken` heeft of niet te parsen is wordt nooit naar het live item geschreven. Het live item wordt vóór het schrijven bewaard (in geheugen en, als het bij geen bekend account hoort, in `futureflow-accounts-redding`) en bij een fout teruggezet; `~/.claude.json` wordt pas geschreven als het live item klopt, en bij een fout daar wordt het live item teruggezet.
4. **Twee sessies besluiten tegelijk.** `wissel.lock` met `O_EXCL` (pid + tijd; stale als de pid dood is of na 120 s). Onder de lock opnieuw: actief account nog gelijk aan `--van`, cooldown (5 min sinds `laatsteWissel` in `accounts.json`) en sessies. De tweede sessie krijgt exit 6 ("al gewisseld / niets te doen") en doet niets.
5. **Uitloggen maakt een bewaard refresh-token ongeldig.** `/logout` kan het token van het account dat je verlaat intrekken; een refresh met een al gebruikt token geeft `invalid_grant`. Dan: account op `opnieuw-inloggen` (uit de rotatie, rood in de tab), nooit naar dat account wisselen, nooit de kopie overschrijven met iets dat niet bij dat account hoort. Vóór elke wissel wordt het doel "vers gemaakt" (refresh als het access-token binnen 10 min verloopt); faalt dat met `invalid_grant`, dan geen wissel. Bij toevoegen en in de tab staat: "Nooit /logout tussen accounts."

---

### Task 1: Spike — wat een wissel doet met nieuwe en lopende terminal-sessies

Alleen uitvoeren met Colins eigen tweede account bij de hand (Colin logt zelf in; de builder vraagt dat eerst). Zonder tweede account: overslaan, in de spec onder "Bevindingen" zetten "Spike 6 niet uitgevoerd (geen tweede account)" en verder bouwen met de aannames onderaan deze taak. Niets van de spike komt in `futureflow/`.

**Files:** Create (wegwerp, buiten de repo) `/tmp/ff-accounts-spike/spike.mjs`. Modify `docs/superpowers/specs/2026-11-08-futureflow-supermod-design.md` (Bevindingen).

**Interfaces:** `node /tmp/ff-accounts-spike/spike.mjs kopie <naam>` (live `claudeAiOauth` + `trustedDeviceToken` → Keychain service `futureflow-spike`, account `<naam>`; `oauthAccount` → `/tmp/ff-accounts-spike/<naam>.json` mode 600) en `… wissel <naam>` (onder de drie lockmappen: live item = kopie + live gedeelde velden, via stdin of argv-hex; `oauthAccount` vervangen, atomisch). Print alleen gemaskeerde e-mail, lengtes en tijden.

- [ ] Voorbereiden: `security find-generic-password -s "Claude Code-credentials"` (zonder `-w`) noteert `mdat`; `cp -p ~/.claude.json /tmp/ff-accounts-spike/claude.json.bak` (600). Met account A ingelogd: `spike kopie A`.
- [ ] Colin opent een **nieuwe** terminal en doet `/login` met account B (geen `/logout`). Daarna `spike kopie B`. Live = B.
- [ ] Terminal-sessie T1 starten (op B), één vraag stellen, `/status` noteren (e-mail). T1 laten wachten tussen beurten.
- [ ] `spike wissel A`. Meten in T1: (a) direct een vraag → welk account (`/status`, `/usage`), lukt het verzoek; (b) na 35 s nog een vraag → idem. Noteren of `/status` het nieuwe e-mailadres toont (leest T1 `~/.claude.json` opnieuw?).
- [ ] Nieuwe sessie T2 starten → `/status` moet A tonen.
- [ ] Tijdens een lange beurt in T1 (bv. "tel tot 200 met een pauze per regel") `spike wissel B` → gaat het lopende verzoek goed, en welk account gebruikt de volgende stap? (Alleen meten; de mod zal dit nooit doen.)
- [ ] Desktop-app: in een open Code-tab `echo $CLAUDE_CODE_USER_EMAIL` en `/status` vóór en na een wissel → verwachting: ongewijzigd.
- [ ] Vastleggen: `~/.claude/sessions/<pid>.json` van T1 — staat `status` al op `idle` als de mod `turn.complete` krijgt (log een regel in de spike-mod of vergelijk `statusUpdatedAt` met het einde van de beurt)? Is `sessionId` daar gelijk aan `$.session.id` van de mod?
- [ ] Terugzetten: `spike wissel <origineel>`, `security delete-generic-password -s futureflow-spike -a A` en `-a B`, map weg. Controle: `/status` in een nieuwe sessie toont het oorspronkelijke account.
- [ ] Bevindingen in de spec (sectie "Bevindingen vooraf", kopje "Spike accounts 10-11-2026"): pakt een lopende sessie de wissel op, na hoeveel seconden, toont `/status` het nieuwe account, desktop ongewijzigd, `sessionId` = `$.session.id`, status-timing.
- [ ] Commit `futureflow: spike accounts (bevindingen)`.

**Aannames als de spike niet kan:** nieuwe terminal-sessies gebruiken het nieuwe account; een lopende terminal-sessie pakt het binnen ~30 s op (claude-swap README:243), en tot dan werkt het oude token nog (het oude account zit pas op de marge, niet op 100 %), dus de mod wacht niet extra. Desktop ongewijzigd. De eigen sessie sluit de CLI op twee manieren uit: `--ikzelf <$.session.id>` (eigen bestand en record met die `sessionId`) én het record met `pid === process.ppid` van de CLI (de Claude Code-sessie die hem startte; `/usr/bin/env` doet een exec, dus de ouder is Claude Code — controleren in deze spike met een CLI die `process.ppid` logt, gestart via `$.process.run`). Zo werkt het ook als `sessionId` ≠ `$.session.id`.

### Task 2: Pure logica `lib/accounts.mjs`

**Files:** Create `lib/accounts.mjs`, `lib/accounts.d.mts`, `tests/accounts-lib.test.mjs`.

**Interfaces:**
- Typen: `Venster = { label: '5u' | '7d' | string; pct: number; resetsAt?: number }`; `Meting = { vensters: Venster[]; gemetenOp: number; fout?: string }`; `Account = { id: number; sleutel: string /* accountUuid:orgUuid */; email: string; plan: string; inRotatie: boolean; status: 'ok' | 'opnieuw-inloggen' | 'onbekend' }`; `Instellingen = { auto: boolean; marge5u: number; marge7d: number; strategie: 'meeste-ruimte'; wachttijd: number; hysterese: number; stand: 'stil' | 'vragen'; maxWacht: number }`.
- `STANDAARD_INSTELLINGEN = { auto: false, marge5u: 90, marge7d: 90, strategie: 'meeste-ruimte', wachttijd: 5*60_000, hysterese: 10, stand: 'stil', maxWacht: 10*60_000 }`, `instellingenVan(ruw)` (onzin → standaard; marges 50-99).
- `maskEmail(e: string): string` — `colin@futureflowai.com` → `co…@futureflowai.com`; korter dan 3 tekens voor de `@` → `…@domein`.
- `planLabel(claudeAiOauthZonderTokens: { subscriptionType?: string; rateLimitTier?: string }): string` — `max` + `default_claude_max_20x` → `Max 20x`, `team` → `Team`, `pro` → `Pro`, onbekend → `?`.
- `ruimte(m: Meting | undefined, i: Instellingen, nu: number): number | null` — kleinste (marge − pct) over de vensters die nog niet gereset zijn (een venster met `resetsAt ≤ nu` telt als 0 %); `null` als er geen meting is of die ouder is dan `VERS = 15 min`.
- `kiesAccount(s: { accounts: Account[]; actief: number | null; metingen: Record<number, Meting>; instellingen: Instellingen; nu: number; laatsteWissel: number }): { naar: number; reden: string } | null` — strategie *meeste ruimte*: alleen als auto aan, buiten de wachttijd, en het actieve account op of boven een marge zit (ruimte ≤ 0); kandidaten = `inRotatie`, `status: 'ok'`, niet actief, ruimte > 0; de kandidaat met de meeste ruimte, mits ruimte ≥ ruimte(actief) + hysterese; geen verse meting = geen kandidaat.
- `ketting(s: { …kiesAccount-invoer; api: ApiToestand /* uit lib/api.mjs */; sessieLimieten: {label, percent, resetsAt?}[] }): { soort: 'account'; naar: number; reden: string } | { soort: 'api'; naar: 'api' | 'abonnement'; reden: string; door?: Door } | { soort: 'terug'; naar: number; reden: string } | null` — besluit van Colin:
  1. Modus abonnement: eerst `kiesAccount`; geeft die een account → `account`.
  2. Modus abonnement en **elk** account in de rotatie (met verse meting, status ok) zit op of boven een marge → `beslis` uit `lib/api.mjs` met de sessielimieten → `api`.
  3. Modus api met `overgeschakeldDoor`: heeft een account in de rotatie weer ruimte ≥ hysterese → `terug` naar het account met de meeste ruimte (modus abonnement + Keychain op dat account); anders de bestaande `beslis`-terugregel.
  4. Minder dan twee accounts in de rotatie → precies het oude gedrag (`beslis`), zodat plan 3 ongewijzigd blijft.
  5. Een keuze met de hand (`api.handmatigTot`) en de wachttijd van beide (accounts en API) gaan altijd voor.
- `pollPlan(p: { vorig?: { interval: number; pct?: number }; nieuwPct?: number; actief: boolean; uitgeput: boolean; recent429: boolean; retryAfter?: number; resetsAt?: number; nu: number; rnd: () => number }): { volgende: number; interval: number }` — de getallen van claude-swap `poll_policy.py`: vloer 180 s, actief max 300 s, kandidaat 300 → 600 s, uitgeput 600 s, beweging ≥ 1 punt halveert (vloer 180), na een 429 minstens 360 s en ×1.5 tot 1800 s, `Retry-After` + 60 s, jitter ±10 %, nooit later dan `resetsAt + 60 s`.
- `telBezig(p: { eigen: { sessie: string; status: 'bezig' | 'tussen' | 'weg'; hartslag: number }[]; claude: { pid: number; sessionId?: string; entrypoint?: string; status?: string; statusUpdatedAt?: number; levend: boolean }[]; ikzelf: string; nu: number }): { bezig: number; wie: string[] }` — eigen bestand `bezig` met hartslag < 10 min telt; Claude Code-record telt als `entrypoint === 'cli'`, `levend`, `status` `busy` of `waiting`; dezelfde sessie één keer; `ikzelf` nooit; onbekende `status` bij een levende cli-pid = bezig.

- [ ] Tabeltest `kiesAccount`/`ketting` (minstens deze rijen): actief 92 % 5u, B 30 % → account B; actief 92 %, B 85 % (ruimte 5 < hysterese-verschil) → null; actief 92 %, B 95 % en C 91 % → api; in api, B weer 20 % → terug B; in api, B 85 % → null (wacht op hysterese); binnen 5 min na wissel → null; auto uit → null; B `opnieuw-inloggen` → overgeslagen; B meting 20 min oud → overgeslagen; B niet in rotatie → overgeslagen; één account → zelfde uitkomst als `beslis`; `handmatigTot` in de toekomst → null; 7d boven marge en 5u laag → telt als vol; venster met `resetsAt` voorbij → 0 %.
- [ ] Tests `maskEmail`, `planLabel`, `pollPlan` (vloer, 429-floor, reset-klem, jitter met vaste `rnd`), `telBezig` (dode pid, desktop, eigen sessie, oude hartslag, `waiting`).
- [ ] Commit `futureflow: accounts-logica`.

### Task 3: CLI `cli/accounts.mjs` — opslag, toevoegen, lijst, verwijderen

**Files:** Create `cli/accounts.mjs`, `tests/accounts-cli.test.mjs`, `tests/fixtures/nep-security.mjs` (nep-`security`: keychain in een JSON-bestand uit env `NEP_KEYCHAIN`, logt argv en stdin naar `NEP_LOG`, ondersteunt `-i`, `find-generic-password [-w]`, `add-generic-password -U -a -s -X|-w`, `delete-generic-password`, exit 44).

**Interfaces:**
- Env (tests): `ACCOUNTS_HOME` (standaard `~/.claude/futureflow/accounts`), `CLAUDE_JSON` (standaard `~/.claude.json`), `CLAUDE_HOME` (standaard `~/.claude`: locks, `.credentials.json`, `sessions/`), `SECURITY_BIN` (standaard `/usr/bin/security`), `KEYCHAIN_USER` (standaard `$USER` → `os.userInfo().username` → `claude-code-user`), `ACCOUNTS_API` (basis-URL voor tests; standaard echte hosts).
- Uitvoer altijd één JSON-regel op stdout. Exitcodes: 1 gebruik, 2 bestand onleesbaar/kapot (niets geschreven), 3 niet ingelogd of identiteit klopt niet, 4 onbekend account, 5 Keychain-fout, 6 niets te doen (al actief / ander proces wisselde), 7 bezig (sessies of lock), 8 eigen profiel, 9 opnieuw inloggen nodig.
- `add [--label <tekst>]`: leest `oauthAccount` uit `CLAUDE_JSON` en het live item; weigert een API-key-login of een item zonder `claudeAiOauth.refreshToken`; controleert de identiteit met `GET /api/oauth/profile` (Bearer, timeout 5 s; `account.uuid` moet gelijk zijn aan `accountUuid`) — buiten elke lock; daarna onder `~/.claude/.oauth_refresh.lock` + `~/.claude.lock` het live item opnieuw lezen (zelfde vingerafdruk van het refresh-token als vóór de profielcheck, anders exit 3 "login veranderde, probeer opnieuw") en de kopie schrijven. Bestaat het account al: kopie bijwerken, id/label/rotatie houden. `config/<uuid>.json` = `oauthAccount`. Nieuwe id = hoogste + 1. Antwoord `{ id, email (gemaskeerd), plan, nieuw }`.
- `list` / `status --json`: `{ actief, profiel: 'standaard'|'eigen', accounts: [{ id, email, plan, inRotatie, status, label?, gebruik: { '5u'?: {pct, resetsAt}, '7d'?: {pct, resetsAt} }, gemetenOp?, leeftijdS?, fout? }], instellingen, laatsteWissel?, wacht?: { sinds, wie } }`. Actief = account waarvan `accountUuid:organizationUuid` gelijk is aan `oauthAccount` nu (niet wat `accounts.json` denkt). Geen netwerk.
- `remove <id>`: Keychain-items (`futureflow-accounts`, `-vorige`) en `config/<uuid>.json` weg; het actieve account verwijderen mag (de live login blijft), maar dan staat er "blijft ingelogd; futureflow beheert het niet meer".
- `zet <id> rotatie aan|uit`, `instellingen '<json>'` (alleen bekende velden via `instellingenVan`).
- `sync`: is de live login een bekend account (identiteit uit `oauthAccount`, én refresh-token-vingerafdruk ≠ die van de kopie, én live `expiresAt` ≥ kopie), dan onder de credential-locks de kopie bijwerken (oude naar `-vorige`). Twijfel over de identiteit (geen profielcheck gedaan voor deze vingerafdruk) → eerst `GET /api/oauth/profile` buiten de lock, uitkomst per vingerafdruk onthouden in `accounts.json`. Zo blijft de kopie van het actieve account niet achter als Claude Code zijn token roteert.
- Hulpfuncties in de CLI: `keychainLees(svc, acct)`, `keychainSchrijf(svc, acct, waarde)` (`-X` hex via `security -i`; > 4032 bytes → argv, alleen toegestaan voor `Claude Code-credentials`), `keychainWis`; `metLocks(namen, fn)` (proper-lockfile: `mkdir`, max 9 s met 250-500 ms pauzes, stale 60 s credential / 10 s config, overnemen via `<lock>.takeover` met hercontrole, `utimes` elke 3 s, `rmdir` in `finally`; volgorde altijd `wissel.lock` → `.oauth_refresh.lock` → `~/.claude.lock` → `~/.claude.json.lock`); `schrijfAtomisch(pad, tekst, mode)` (zoals `cli/api.mjs`: tmp `wx`, stat vergelijken, rename, max 3 pogingen); `isMain` via realpath.

- [ ] Tests met tijdelijke mappen en de nep-`security`: `add` (identiteit klopt / klopt niet / API-key-login / login verandert tussendoor), tokens nooit in `NEP_LOG`-argv voor `futureflow-accounts*`, kopie zonder `mcpOAuth`; `list` maskeert e-mail en toont geen token-tekens (zoek de nep-tokens in alle uitvoer en in alle bestanden onder `ACCOUNTS_HOME`); `remove`; `sync` werkt de kopie bij na een "rotatie" en weigert als `oauthAccount` en token niet bij elkaar horen; lock vastgehouden → wacht en exit 7; stale lock (> 60 s) → overgenomen; `CLAUDE_CONFIG_DIR` gezet → exit 8.
- [ ] `node --check`, commit `futureflow: accounts-cli opslag`.

### Task 4: CLI — wisselen en sessies tussen beurten

**Files:** Modify `cli/accounts.mjs`, `tests/accounts-cli.test.mjs`.

**Interfaces:**
- `sessie <sessionId> bezig|tussen|weg`: alleen voor tests en de terminal-tekstversie; de mod schrijft zijn bestand zelf met `$.fs.write` (`sessies/<sessionId>.json` = `{ sessie, status, sinds, hartslag, terminal: true }`). De CLI ruimt bestanden op met `status: 'weg'` of hartslag > 24 u.
- `bezig --ikzelf <sessionId>` → `{ bezig, wie }` via `telBezig` uit eigen bestanden + `CLAUDE_HOME/sessions/*.json`, zonder het record met `sessionId === ikzelf` of `pid === process.ppid` (pid levend met `process.kill(pid, 0)`; pid-hergebruik: `procStart` vergelijken met `ps -o lstart= -p <pid>` binnen 120 s, zoals claude-swap `process_detection.py`).
- `switch <id> [--van <id>] [--ikzelf <sessionId>] [--auto]`:
  1. Buiten locks: profiel standaard? doel bekend, status ok? Doel vers maken: verloopt zijn access-token binnen 10 min → refresh (Task 5) onder `refresh-<uuid>.lock`; `invalid_grant` → status `opnieuw-inloggen`, exit 9. Identiteit van de live login vaststellen (zoals `sync`).
  2. `wissel.lock` (`O_EXCL`; inhoud pid + tijd; stale als pid dood of > 120 s). Onder de lock opnieuw: actief nog `--van` (anders exit 6), bij `--auto` cooldown (`laatsteWissel` + `wachttijd`, anders exit 6), `bezig` met `--ikzelf` (> 0 → exit 7 met `wie`).
  3. Credential-locks + config-lock. Alleen lokale I/O: live item lezen (snapshot S), `CLAUDE_JSON` lezen (snapshot C, kapot → exit 2). Uitgaand: hoort S bij een bekend account (identiteit uit C en vingerafdruk-check van stap 1), dan S zonder gedeelde velden naar zijn kopie (oude naar `-vorige`); anders S in `futureflow-accounts-redding` (één slot, overschrijft alleen een oudere redding).
  4. Doel T = kopie van het doel + gedeelde velden van S. Schrijven naar `Claude Code-credentials`/`KEYCHAIN_USER`, terug lezen en vergelijken; fout → S terugschrijven, exit 5.
  5. Bestaat `CLAUDE_HOME/.credentials.json`, dan atomisch herschrijven met T (mtime bumpen); nooit aanmaken.
  6. `CLAUDE_JSON`: alleen `oauthAccount` vervangen door `config/<uuid>.json`, atomisch met stat-vergelijk; fout → live item terug naar S, exit 2.
  7. `accounts.json`: `actief`, `laatsteWissel = { tijd, van, naar, auto }`; regel in `log.jsonl` (ids, gemaskeerde e-mail, reden; geen tokens).
- `freshen <id>`: alleen stap 1 (voor de knop "controleer login").

- [ ] Tests: volledige wissel A→B→A met nep-keychain (live item heeft `mcpOAuth` dat blijft; `oauthAccount` vervangen, andere sleutels in `CLAUDE_JSON` byte-gelijk; kopie A bijgewerkt met het live token); groot live item (> 4 KB) gaat via argv-hex, de kopieën nooit; schrijffout live item → S terug; kapot `CLAUDE_JSON` → niets geschreven; tweede gelijktijdige `switch --van A` (twee processen) → één wint, ander exit 6; `bezig` (nep `sessions/<pid>.json` met levende pid = `process.pid` van de test, `entrypoint: cli`, `status: busy`) → exit 7; desktop-record telt niet; eigen sessie telt niet; `invalid_grant` bij vers maken → exit 9 en status `opnieuw-inloggen`.
- [ ] Commit `futureflow: accounts wisselen`.

### Task 5: CLI — verbruik ophalen en refresh

**Files:** Modify `cli/accounts.mjs`, `tests/accounts-cli.test.mjs` (lokale `http.createServer` als nep-API via `ACCOUNTS_API`).

**Interfaces:**
- `usage --refresh [--id <n>] [--nu]`: per account alleen als `nu ≥ volgende` uit `gebruik.json` (met `--nu`: alleen de vloer van 180 s). `GET <api>/api/oauth/usage` met `Authorization: Bearer`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: futureflow-accounts/<versie>`, timeout 5 s. `five_hour` → `5u`, `seven_day` → `7d` (`utilization` null → venster zonder pct, telt niet als vol); per-model-vensters bewaren maar niet beslissen (v1). Daarna `pollPlan`. Mislukt: laatste goede meting blijft, alleen `fout`/backoff bijwerken; 429 → `Retry-After` + 60 s.
- Token kiezen: actief account → access-token uit het **live** item (nooit refreshen; verlopen → overslaan met `fout: 'token verlopen, ververst bij het volgende bericht'`); niet-actief → kopie; verlopen (`expiresAt` − 5 min) → refresh.
- Refresh (alleen niet-actieve accounts): onder `refresh-<uuid>.lock` (`O_EXCL`, stale 60 s): kopie opnieuw lezen (een ander proces kan net ververst hebben → dan die gebruiken), `POST <platform>/v1/oauth/token` `{ grant_type: 'refresh_token', refresh_token, client_id }` (client-id als constante met bronvermelding claude-swap `oauth.py:21`). Succes → **eerst** de nieuwe kopie schrijven (oude naar `-vorige`, terug lezen) en pas dan gebruiken; mislukt het schrijven, dan de nieuwe credential in `futureflow-accounts-redding` en status `onbekend` met uitleg. 400/401/403 met `error: 'invalid_grant'` → status `opnieuw-inloggen`; de rest is tijdelijk (backoff).
- Plan opnieuw bepalen bij `add` en eens per 6 uur uit de kopie (`subscriptionType`, `rateLimitTier`), geen extra netwerk.

- [ ] Tests: vloer 180 s (twee aanroepen kort na elkaar → één HTTP-verzoek); 429 met `Retry-After` → volgende poging pas daarna; actief verlopen token → geen refresh-verzoek; niet-actief verlopen → refresh, nieuwe kopie bewaard vóór het usage-verzoek (volgorde in de nep-server-log); `invalid_grant` → `opnieuw-inloggen`; schrijffout na refresh → opvolger in `redding`; nooit een token in stdout/stderr/bestanden.
- [ ] Commit `futureflow: accounts verbruik`.

### Task 6: Mod — tab Accounts, sessiebestanden en automatisch wisselen

**Files:** Create `hooks/accounts.tsx`, `tests/accounts.test.ts`. Modify `hooks/paneel.ts` (TABS + `'accounts'`), `hooks/dashboard.tsx` (NAMEN `accounts: 'Accounts'`, render, `/futureflow accounts`), `hooks/register.tsx` (`startAccounts`), `hooks/skins/register.tsx` (`turn.start` → `accountsBeurtStart`, `session.measure` → `accountsMeetLos`; AbovePrompt → `accountsRij`; commentaar `futureflow:`), `hooks/minify.tsx` (`turn.complete` → `accountsBeurtKlaar` ná `next(e)`), `hooks/slots.tsx` (`session.end` → `accountsSessieEinde`), `hooks/api.tsx` (`apiMeet` laat het besluit aan `ketting` als er ≥ 2 accounts in de rotatie zijn; `wissel` exporteren), `types/index.d.ts`.

**Interfaces:**
- `startAccounts($)`: registreert `/accounts` (`/accounts` opent tab 7; `/accounts lijst`, `/accounts toevoegen`, `/accounts wissel <n>`); desktop-detectie via `$.env.get('CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH')` → atom `accounts.desktop`; in de terminal: eigen sessiebestand `tussen` schrijven (`$.fs.write`, pad uit `HOME`).
- `accountsBeurtStart($)` → bestand `bezig` + hartslag; gematchte `tool.call` `{ tool: /^/ }` in `accounts.tsx` werkt de hartslag bij (max één keer per 30 s, try/catch, nooit de aanroep laten mislukken); `accountsBeurtKlaar($, e)` → bestand `tussen`, daarna `accountsMeetLos`; `accountsSessieEinde($)` → `weg`.
- `accountsMeetLos($)`: los van de beurt; max één keer per 60 s; alleen als auto aan of er een automatische API-wissel is om terug te draaien. CLI `sync`, `usage --refresh`, `status --json` → `ketting(...)` met de sessielimieten (`$.session.usage().rateLimits` via `limietenVan`) en de API-toestand. Uitkomst:
  - `account`/`terug`: stand *stil* → CLI `switch <id> --van <actief> --ikzelf <$.session.id> --auto` (bij `terug` daarna `wissel($, 'abonnement', …)` uit `api.tsx`); stand *vragen* → atom `accounts.vraag` = `{ naar, reden }`, de rij boven de prompt toont knoppen "Wissel" / "Niet nu" (niet nu = 30 min niet opnieuw vragen).
  - `api`: bestaande `wissel($, 'api', …)` uit `api.tsx`.
  - Exit 7 (bezig): atom `accounts.wacht` = `{ sinds, wie }`; volgende poging bij de volgende `accountsMeetLos`; na `maxWacht` (10 min) melding "Wacht op een sessie die bezig is; nog niet gewisseld." en geen nieuwe pogingen tot de volgende beurt van deze sessie.
- Melding in **alle** sessies: elke sessie leest bij `turn.start`/`session.measure` `accounts.json` → `laatsteWissel` (`$.fs.read`, geen CLI); is die nieuwer dan wat de sessie al toonde, dan 10 s een groene regel "Gewisseld naar account N (<gemaskeerde e-mail>)". (Als de Cache-guard er komt: de eerste send na een wissel geen guard-vraag.)
- `accountsTab($, e, kleuren)` (skin-stijl zoals `apiTab`): per account een rij `● 2  co…@futureflowai.com  Max 20x  5u ▰▰▰▱▱ 62% (reset 14:05)  7d ▰▱▱▱▱ 18% (ma 17-11)  · 3 min geleden`, actief in accentkleur, `opnieuw-inloggen` rood met "log in met /login en kies Toevoegen"; knoppen per rij `acc-wissel-<id>`, `acc-rotatie-<id>`, `acc-weg-<id>` (verwijderen met een tweede klik ter bevestiging); bovenaan `acc-toevoegen` ("Huidige login toevoegen"), `acc-ververs` (`usage --refresh --nu`); instellingen: vinkje `acc-auto`, Inputs `acc-marge5u`, `acc-marge7d` (50-99), strategie-tekst "meeste ruimte", wachttijd 5 min (tekst), knoppen `acc-stil` / `acc-vragen`. Onderaan de uitleg: apart betaalde abonnementen, alleen eigen toegevoegde accounts, nooit `/logout`, alleen terminal (desktop houdt zijn eigen login), sessies zonder futureflow tellen mee via Claude Code's sessiebestanden. In de desktop: alles alleen-lezen plus de desktopzin.
- Atoms: `accounts.status`, `accounts.versie`, `accounts.vraag`, `accounts.wacht`, `accounts.melding`, `accounts.desktop`. Tab ververst zoals Connectors: bij openen, na een klik en elke 30 s zolang de tab open is; tekenen start geen CLI.

- [ ] Hook-tests met nep-CLI: tab toont rijen en gemaskeerde e-mail; desktop → geen knoppen; klik wissel roept `switch <id> --van <actief> --ikzelf <id>`; auto bij 92 % met B op 30 % → `switch`; alle accounts vol → `api.tsx` `wissel` naar api; in api en B weer 20 % → `switch B` + terug naar abonnement; exit 7 → wacht-melding, na 10 min de melding "nog niet gewisseld"; stand vragen → geen switch, wel `accounts.vraag`; `turn.start`/`turn.complete` schrijven het sessiebestand; een fout in de hartslag laat de tool-aanroep doorgaan.
- [ ] validate + alle tests groen, commit `futureflow: tab Accounts en automatisch wisselen`.

### Task 7: Afronden

- [ ] Versie 0.5.0; README (Engels) sectie Accounts (credit claude-swap met commit), `NOTICE` (claude-swap MIT, commit, wat overgenomen is: lock-protocol, poll-getallen, wisselvolgorde), `CLAUDE.md` futureflow-sectie (Keychain-services, exitcodes, sessiebestanden, ketting, valkuilen uit de spike).
- [ ] Hele-branch review met de Review Focus hierboven; fixes.
- [ ] Live terminal-check (met Colin, twee echte accounts): toevoegen ×2, lijst met verbruik, wissel met de hand en `/status` in een nieuwe sessie, één automatische wissel met een lage testmarge (50 %), "bezig" in een tweede terminal houdt de wissel tegen, desktop-tab alleen-lezen. Geen tweede account → alleen de checks zonder wissel en dat noteren.
- [ ] Commit.

## Open vragen voor Colin

1. Het live Keychain-item is ~12 KB (vooral `mcpOAuth`). Schrijven via `security -i` kan dan niet; claude-swap en Claude Code zelf zetten het dan hex-gecodeerd in argv (heel kort zichtbaar voor `ps` op deze Mac). Akkoord, of alleen wisselen als het past (dan werkt wisselen nu niet)?
2. Gebruik je een van de accounts ook tegelijk op een andere machine? (Verbruik telt dan mee in hetzelfde venster; het usage-endpoint deelt zijn budget per account.)
