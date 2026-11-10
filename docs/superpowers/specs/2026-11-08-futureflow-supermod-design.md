# FutureFlowAI supermod — ontwerp

Datum: 8 november 2026 · Claude Code op deze Mac: **2.1.319** · Minimale versie: **2.1.287** (mods; ook de eis van cache-tax en claude-skins)

## Waarom

Colin heeft losse mods uitgeprobeerd (agent-slots, minify, voice-chat) en voorbeelden van anderen bekeken (cache-tax, claude-skins, claude-swap). Hij wil alles wat daarbij geleerd is samenbrengen in één plugin van FutureFlowAI die:

- **tokens bespaart, in en uit**, en het contextvenster zuinig gebruikt;
- **voorkomt dat de Mac vastloopt** als agents te veel tegelijk starten;
- Claude Code er **als een FutureFlowAI-product** laat uitzien, in licht en donker;
- bij grote taken laat zien **wat er gedaan is, wat nog moet en hoeveel procent tot het doel**;
- **automatisch tussen zijn eigen Claude-accounts wisselt** voordat een limiet stopt wat de agent aan het doen is;
- alles bedienbaar maakt vanuit **één dashboard**.

Succes: Colin werkt een dag lang met alleen deze plugin aan, ziet in het dashboard wat hij bespaard heeft, loopt niet tegen een limiet of een vastgelopen Mac aan, en de statusbalk vertelt hem bij elke grote taak waar Claude staat.

## Doelen

1. Eén plugin `futureflow` in deze repo, met zes onderdelen: **Slots, Minify, Cache, Skin, Voortgang, Accounts**, plus het **Dashboard**.
2. De plugin **vervangt** `agent-slots` en `minify` (besluit Colin). Bestaande instellingen en tellers gaan mee; de gebruiker hoeft niets opnieuw in te stellen.
3. Werkt in de terminal en in de Code-tab van de desktop-app.

## Niet-doelen

- voice-chat blijft een losse plugin *(mijn keuze; Colin heeft er niet op gereageerd)*.
- Geen volledige kopie van claude-skins: geen Mermaid-, wiskunde- of grafiekkaarten, geen 16 thema's, geen thema-ontwerper.
- Geen eigen statusregel (`statusLine`-instelling); alles via mod-UI.
- Geen ondersteuning voor Windows/Linux bij Accounts in v1 (Keychain is macOS). De rest moet daar wel laden zonder fouten.

## Anti-doelen (dan is het mislukt, ook al werkt het)

- De plugin kost meer tokens dan hij bespaart (bv. keepwarm die ongemerkt pingt, of een statusbalk die tekst in de prompt duwt).
- Een fout in de plugin blokkeert het werk. Elk onderdeel faalt open, zoals agent-slots nu (`.catch(failOpen)`, één melding, regel in een log).
- Een accountwissel midden in een stap, waardoor een verzoek half mislukt.
- Wachtwoorden, tokens of commando-tekst in logs, store of dashboard zonder `maskSecrets`.
- Dubbel werk doordat de oude plugins nog naast de nieuwe draaien.

## Randvoorwaarden

Alle regels uit `CLAUDE.md` van deze repo gelden. De belangrijkste hier:

- Hooks-module is geen Node: alles via `$`. Keychain, netwerk naar derden en echte bestandsbewerkingen horen in een Node-script in `cli/` dat de mod start via `['/usr/bin/env','node',…]` met `PATH` inclusief `/opt/homebrew/bin`.
- Gedeelde logica in pure `lib/*.mjs` met `.d.mts`, zodat zowel de mod als `node --test` ze gebruiken. Geen dynamische `import()` in `*.test.ts`.
- Geen variabele `h` in `.tsx`.
- `prompt.compose`/`prompt.section` werken niet voor zelf geïnstalleerde plugins; teksten voor het model gaan via command hooks in `hooks/hooks.json` (zoals minify nu met `scripts/regels.sh`).
- Taal: UI en commentaar Nederlands, README Engels.
- Pluginnaam mag niet beginnen met `claude-`, `anthropic-` of `cc-plugin-`.
- Licenties: Caveman-afgeleide code (Apache-2.0) houdt `LICENSE`/`NOTICE`; cache-tax, claude-skins en claude-swap zijn MIT en krijgen een naamsvermelding met commit in README en `NOTICE`. "Caveman" niet als naam gebruiken.
- Huisstijl (FutureFlowAI `vault/brand/Brandbook.md`): groen `#32a029`, donkergrijs `#3D3D3D`, wit, zwart; "AI" in het logo groen; BR Sonoma (alleen waar een lettertype gekozen kan worden, dus niet in de terminal); toon licht informeel, warm, simpel.

## Onderdelen

### 1. Slots (uit agent-slots)

Gedrag ongewijzigd ten opzichte van agent-slots 0.5.0 (`agent-slots/DESIGN.md` is de bron): zware Bash-commando's inpakken, Playwright-browserslots, `Agent`/`Workflow`/`start_session` onder de geheugengrens, cloud-overflow, aan/uit machinebreed.

- De CLI `agent-slot` en zijn state in `~/.claude/agent-slots/` blijven **in gedrag en opslag gelijk**, want andere agents (Orca-workers) gebruiken ze. De shim in `~/.local/bin` blijft werken. Alleen teksten die de oude pluginnaam noemen (bv. `agent-slots:cloud-worker` in `cli/agent-slot.mjs`) gaan naar `futureflow:…` *(mijn keuze)*.
- Tijdens de overgang (oude plugin nog aan) leest en bedient de tab *Agent slots* gewoon de gedeelde state in `~/.claude/agent-slots/`; alleen het inpakken van commando's laat futureflow dan aan de oude plugin over *(mijn keuze)*.
- Skill `cloud-overflow` en agent `cloud-worker` gaan mee, onder de nieuwe pluginnaam.
- Het eigen dashboard `/agent-slots` vervalt; de inhoud wordt de tab *Agent slots* in het Dashboard.

### 2. Minify (uit minify)

Gedrag ongewijzigd ten opzichte van minify 0.2.1 (`minify/DESIGN.md`): niveaus O1–O3/uit, regels via `scripts/regels.sh`, tooluitvoer inkorten (Bash en `mcp__*`), `/minify bestand`, meting per niveau.

- State blijft in `~/.claude/minify/` en `$.store`. Omdat de pluginnaam verandert, is `$.store` mogelijk leeg: de builder zoekt uit of de store per plugin is, en zo ja, zet de tellers één keer over (of begint opnieuw en zegt dat in de changelog).
- `/minify` blijft als commando bestaan (spiergeheugen), maar opent de tab *Minify* in het Dashboard.

### 3. Cache (eigen versie, naar cache-tax, MIT)

Doel: geen dure "koude send" zonder dat Colin het weet.

- **Waarschuwing bij koude cache** (*guard*). Standaard **vragen**: is volgens de klok van één uur de cache koud en is de context ≥ 50.000 tokens, dan vraagt de plugin vóór het versturen *Toch versturen* / *Niet versturen*, met de geschatte prijs. Andere standen: *tonen* (prijs tonen en versturen) en *uit*.
- **Warm houden in pauze** (*keepwarm*). Standaard **uit**. Aan te zetten in het dashboard of met `/keepwarm [duur]`, voor een begrensd venster (90m, 2u, 6u). Werkt zoals cache-tax: na ~50 min stilte één `$.model.fork` zonder tools over het transcript; stoppen als de fork niets uit de cache leest of veel schrijft.
- **Teller**: aantal voorkomen koude sends en geschatte besparing → Dashboard *Overzicht*.
- Prijzen per model uit een tabel in `lib/`, met de bron en datum erbij. Op een abonnement zijn het API-equivalente bedragen; zo labelen.
- Moet rekening houden met **Accounts**: na een wissel is de cache per definitie koud (de cache hoort bij een account). De eerste send na een wissel krijgt géén guard-vraag (de wissel was al een bewuste keuze), wel een regel in de statusbalk.

### 4. Skin (eigen versie, naar claude-skins, MIT)

Eén FutureFlowAI-thema, in **licht**, **donker** en **auto** (volgt het thema van Claude Code via `config.set { key: 'theme' }`).

In v1:
- **Tool-regels**: icoon per soort tool, tijd, regels gewijzigd; openklappen toont invoer en antwoord.
- **Diff-kaart** voor Edit/Write met `+N −M` en genummerde regels, groen voor toevoegingen, rood (`#d4483b`) voor verwijderingen.
- **Shell-kaart** met status (`✓` of `✗ exit N`), stderr apart, lange uitvoer ingeklapt.
- **Spinner** en beurt-duur in FFAI-groen.
- Alles aan/uit per onderdeel in de tab *Stijl*, plus een knop "Claude Code's eigen weergave".

Niet in v1: tabellen-, Mermaid-, wiskunde-, grafiekkaarten, quiet mode, thema-ontwerper, eigen kleuren per kleur.

De mockup (`.superpowers/brainstorm/…/supermod-v1.html`, sectie 3) geeft de richting, niet de pixels. In de terminal: tekst en kleur; in de desktop: vectorkaarten, en BR Sonoma als dat lettertype beschikbaar is.

### 5. Voortgang — statusbalk

Een balk boven het invoerveld (`ui.render` op `AbovePrompt`), **de enige** `AbovePrompt`-weergave van de plugin. Andere onderdelen (wissel, cache) zetten er kort een melding in.

- **Ingeklapt** (vorm A, besluit Colin): `FutureFlowAI ▰▰▰▰▱▱▱ 57%  ▸ 5/7 <huidige stap>`.
- **Uitgeklapt** (vorm B, besluit Colin): doel, alle stappen met ✓ klaar / ▸ bezig / ○ te doen, het percentage, en onderaan *n klaar · n bezig · n te gaan · tijd bezig · context %*.
- Klikken (desktop) of een commando (terminal, bv. `/futureflow balk`) wisselt tussen de twee. De keuze wordt onthouden. Start ingeklapt.
- **Percentage** = afgeronde stappen / alle stappen van de huidige takenlijst.
- **Doel** = titel van het plan; anders de eerste regel van de opdracht waarmee de lijst ontstond, ingekort.
- Verschijnt alleen als er een takenlijst is. Bij 100% een paar seconden ✓, daarna weg.
- **Bron van de stappen** — *eerst nagaan, dan bouwen*:
  - Terminal: Claude Code's eigen takenlijst-tools (TodoWrite / Task*), via `tool.call`.
  - Desktop-app: daar loopt de lijst via `mcp__ccd_turn__update_plan`. Nagaan of een mod die `tool.call` ziet en de invoer kan lezen.
  - Ziet de mod geen van beide betrouwbaar, dan valt hij terug op een eigen lijst die Claude invult (bv. een kleine tool of een vaste regel in de tekst die de mod herkent). Die terugval wordt pas gebouwd als de check negatief is.

### 6. Accounts (eigen versie, naar claude-swap, MIT)

Besluit Colin: eigen wisselaar met instelbare marges voor automatisch wisselen. Alleen voor intern gebruik; geen melding over voorwaarden (besluit Colin 10-11-2026). Elk account is een apart betaald abonnement, en futureflow wisselt alleen tussen accounts die de gebruiker zelf toevoegde.

- **Ketting met de API-switch** (besluit Colin 10-11-2026): eerst naar het volgende abonnement met ruimte; pas als **alle** abonnementen in de rotatie boven hun marge zitten naar de API (de bestaande switch van plan 3, `beslis` in `lib/api.mjs`); terug van API naar een abonnement zodra er een weer ruimte heeft. Met minder dan twee accounts in de rotatie blijft het gedrag van plan 3 ongewijzigd. Plan: `docs/superpowers/plans/2026-11-10-futureflow-6-accounts.md`.
- **Alleen terminal** (besluit Colin 10-11-2026): de desktop-app houdt zijn eigen login; de tab zegt dat.

- **CLI** `cli/accounts.mjs` (Node, alleen builtins). macOS Keychain via `/usr/bin/security`. Opslag van kopieën en instellingen in `~/.claude/futureflow/accounts/` (chmod 700); geheimen alleen in de Keychain, nooit in een bestand of log.
- **Toevoegen**: Colin logt in Claude Code in met een account en kiest *Account toevoegen*. De CLI maakt een kopie van de huidige login. Niet `/logout` gebruiken tussen accounts (claude-swap: kan het refresh-token intrekken); dat staat in de uitleg.
- **Lijst**: per account plan, verbruik 5 uur en 7 dagen, resettijden, leeftijd van de meting. Verbruik ophalen zoals claude-swap dat doet; niet vaker dan nodig (claude-swap: elke paar minuten, sneller vlak voor een wissel).
- **Wisselen met de hand**: knop per account in het dashboard, en `/accounts wissel <n>`.
- **Automatisch wisselen**, standaard **uit**, instellingen in het dashboard:
  - marge 5-uursvenster (standaard 90%), marge 7-dagenvenster (standaard 90%, apart instelbaar);
  - per account aan/uit in de rotatie;
  - strategie: *meeste ruimte* (standaard); andere strategieën van claude-swap zijn optioneel;
  - wachttijd na een wissel (standaard 5 min) en een kleine hysterese tegen heen-en-weer wisselen;
  - stand *stil* (standaard, mijn keuze) of *eerst vragen* in de statusbalk.
- **Eén wisselaar voor de hele Mac** (besluit Colin). De Keychain-login geldt machinebreed, dus een wissel raakt alle draaiende sessies, ook Orca-workers en andere desktop-tabbladen. Elke sessie met futureflow meldt in gedeelde state (`~/.claude/futureflow/accounts/`, locks met `O_EXCL` zoals agent-slots) of hij bezig is of tussen beurten zit; een wissel gebeurt pas als **geen enkele** bekende sessie bezig is. Sessies zonder futureflow (bv. andere agents) zijn niet te zien; dat staat in de uitleg. Een sessie die niet meer reageert telt na een time-out niet meer mee. Maximale wachttijd instelbaar (standaard 10 min, mijn keuze); daarna wisselt hij toch niet maar meldt hij in de statusbalk dat hij wacht. De melding "gewisseld naar account N" en het overslaan van de guard-vraag gelden in **alle** sessies.
- **Wanneer**: alleen **tussen twee beurten** (`turn.complete`, vóór de volgende send), nooit midden in een stap. Liefst op een goedkoop moment: als de cache toch al koud is, of op tijd vóór de grens. Na de wissel: melding in de statusbalk ("gewisseld naar account 2"), groen.
- **Desktop-app — eerst testen.** Nagaan of sessies in de Code-tab dezelfde Keychain-login gebruiken als de terminal. Zo nee: Accounts werkt in v1 alleen in de terminal (besluit Colin); de tab in de desktop toont dan het verbruik maar markeert wisselen als niet beschikbaar, en desktop-sessies tellen niet mee als "bezig".
- **macOS-cache**: Claude Code leest de Keychain met ~30 s vertraging. De builder test of een draaiende sessie de wissel oppakt zonder herstart, en bepaalt hoe lang de plugin wacht voordat de volgende send gaat.
- Moet de sloten van Claude Code respecteren bij het schrijven van de login (claude-swap houdt Claude Code's eigen credential-locks vast, zodat een wissel niet botst met een token-refresh). De builder neemt dat mechanisme over.
- Faalt dicht voor wisselen (bij twijfel niet wisselen), open voor de rest (Claude Code blijft werken).

### 7. Dashboard

`/futureflow` opent een paneel naast de chat (`Pane`); in de terminal een tekstversie. Navigatie links: **Overzicht · Agent slots · Minify · Cache · Accounts · Stijl · Voortgang**.

- **Overzicht**: tokens bespaard (in; ingekorte uitvoer — gemeten, exact), tokens bespaard (uit; door minify — **schatting**, zo gelabeld: gemiddelde uitvoer per beurt op het huidige niveau tegenover het gemiddelde zonder minify; zolang er te weinig beurten zonder minify zijn, een vaste aanname uit de Caveman-meting met die bron erbij) *(mijn keuze)*, cache warm/koud + resttijd, contextvenster %, voorkomen koude sends en geschat bedrag, actief account + verbruik.
- **Agent slots**: aan/uit, vrij geheugen, grens, bezette slots, cloud-overflow (alles wat het huidige agent-slots-dashboard heeft).
- **Minify**: aan/uit, niveau O1/O2/O3/uit, tooluitvoer inkorten aan/uit, statistieken.
- **Cache**: guard uit/tonen/vragen, keepwarm aan/uit + venster, teller.
- **Accounts**: lijst, wissel-knoppen, toevoegen, automatisch wisselen + marges, stil/vragen.
- **Stijl**: thema licht/donker/auto, skin-onderdelen aan/uit, statusbalk standaard ingeklapt/uitgeklapt.
- **Voortgang**: de huidige takenlijst in het groot.

Richting: mockup sectie 2. Kaarten met een groene schakelaar, FFAI-logo met groene "AI" linksboven. Ververst zoals het agent-slots-dashboard nu (elke 3 s bij open paneel, niet daarbuiten).

## Overgang van de oude plugins

1. Nieuwe map `futureflow/` met `.claude-plugin/plugin.json` (versie 0.1.0), `hooks/`, `lib/`, `cli/`, `scripts/`, `skills/`, `agents/`, `tests/`, `types/`.
2. Code van `agent-slots/` en `minify/` verhuist naar `futureflow/` (git mv waar het kan, zodat de geschiedenis blijft).
3. Bij `session.start` controleert de plugin of `agent-slots` of `minify` nog geïnstalleerd en aan staan. Zo ja: één melding met het commando om ze te verwijderen. Zolang ze er staan, schakelt `futureflow` zijn eigen Slots/Minify-onderdeel **uit** om dubbel werk te voorkomen.
4. `marketplace.json`, README-tabel en `CLAUDE.md` bijwerken; oude mappen weg zodra de nieuwe plugin live getest is (aparte commit).

## Gebruikte bronnen

- cache-tax — github.com/karanb192/cache-tax, MIT, v2.4.0
- claude-skins — github.com/hellosverre/claude-skins, MIT, v0.5.16
- claude-swap — github.com/realiti4/claude-swap, MIT
- Caveman — via minify (Apache-2.0, commit `9b68f7e`)

Commit-hashes vastleggen bij overnemen, zoals bij content-skills.

## Testen

- `claude plugin validate futureflow`, `claude plugin test futureflow`, `node --check futureflow/cli/*.mjs`, `node --test futureflow/tests/*.test.mjs`. Bestaande tests van agent-slots en minify verhuizen mee en blijven groen.
- Live test in terminal én desktop-app, met minstens: statusbalk tijdens een taak van ≥ 5 stappen, guard op een koude cache (testknop zoals `/cache-tax guard test`), handmatige wissel tussen twee echte accounts, één automatische wissel met een lage testmarge, Mac onder druk met agent-slots aan.

## Besluiten van Colin

- Eén supermod die agent-slots en minify vervangt.
- Statusbalk: vorm A ingeklapt, vorm B uitgeklapt.
- Eigen account-wisselaar met instelbare marges voor automatisch wisselen.
- Een wissel wacht tot álle sessies tussen twee beurten zitten.
- Werkt wisselen niet in de desktop-app, dan is Accounts in de terminal genoeg voor v1.
- Dashboard en richting van de mockup: "gaat de goede kant op, bouw het zo uit".

## Mijn keuzes (Colin kan ze terugdraaien)

- Pluginnaam `futureflow`, dashboard-commando `/futureflow`.
- voice-chat blijft los.
- Skin is een subset van claude-skins met één FFAI-thema.
- Keepwarm standaard uit, guard standaard *vragen*.
- Automatisch wisselen standaard uit; als het aan staat, standaard *stil* en alleen tussen beurten.
- Geen guard-vraag direct na een accountwissel.

## Aan de builder

- Precieze bestandsindeling binnen `futureflow/`, opdeling van `register.tsx` in modules.
- Hoe het verbruik per account wordt opgehaald (volg claude-swap).
- Terugval voor de bron van de stappen, als de check in de desktop negatief is.
- Prijstabel en de formule voor de schatting (volg cache-tax).
- Iconen en exacte kleuren van de donkere variant, binnen de huisstijl.

## Bevindingen vooraf

Uitgezocht op 8-11-2026 met een wegwerp-mod (`/tmp/ff-spike`, logt op `tool.call`), Claude Code in de terminal (`claude -p --plugin-dir`).

**Takenlijst in de terminal.** De tools zijn `TaskCreate` en `TaskUpdate` (één taak per aanroep, geen hele lijst in één keer). `TodoWrite` kwam niet voorbij. Ze staan niet standaard aan in `claude -p`: zonder `CLAUDE_CODE_ENABLE_TODO_TOOLS=true` heeft de sessie geen takenlijst-tool (ook niet met `CLAUDE_CODE_ENABLE_TASKS`). De mod ziet de aanroepen wel via `tool.call`; de argumenten staan daar plat op `e` (naast `e.tool`), niet in `e.input`. Echte voorbeelden:

```
TaskCreate {"subject":"a","description":"Stap a"}
TaskUpdate {"taskId":"1","status":"completed"}
```

- Titel = `subject`, uitleg = `description`; `taskId` is een tellende string (`"1"`, `"2"`, …), toegekend in volgorde van aanmaken.
- Status zit alleen in `TaskUpdate.status` (gezien: `completed`; verwacht ook `pending` en `in_progress`, niet gelogd).
- Een lijst is dus de optelsom van `TaskCreate`-aanroepen met daarna statuswijzigingen; de mod moet die zelf bijhouden.
- Open: de interactieve terminal en de desktop kunnen `TodoWrite` of `mcp__ccd_turn__update_plan` gebruiken; dat is niet gecontroleerd.

**Login in de desktop (al vastgesteld in een Code-tab-sessie).** De omgeving bevat `CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_ACCOUNT_UUID` en `CLAUDE_CODE_ORGANIZATION_UUID`: de desktop-app regelt de login zelf. De Keychain-item `Claude Code-credentials` (acct = macOS-gebruiker) bestaat. Werkhypothese: wisselen via de Keychain werkt niet in de desktop.

**Nog open (Taak 5):** de desktopcheck van de takenlijst-tools (`/tmp/ff-spike` blijft staan voor een symlink in `~/.claude/dev-mods/<sessie-id>/`) en de login-check (tweede account via `/login`, daarna in een open Code-tab `echo $CLAUDE_CODE_USER_EMAIL`).

## Uitbreiding 9-11-2026

Besluiten van Colin bij plan 3 (`docs/superpowers/plans/2026-11-09-futureflow-3-voortgang-connectors-api.md`), met wat de eindreview daaraan toevoegde.

- Connectors uitzetten per projectmap, zoals `/mcp`; context per connector zichtbaar. De projectmap is de git-root van de sessiemap (een worktree is zijn eigen map), anders de map zelf. Alleen servers die `/mcp` kan uitzetten krijgen een knop (claude.ai-connectors, servers van plugins en uit de eigen configuratie); servers van de app en van mods staan op één regel zonder knop.
- API-key in de macOS-sleutelhanger.
- Automatisch naar API vanaf 90% van het 5u- of 7d-venster, terug na de reset (onder 50%); marges instelbaar. Terug pas als geen gemeten venster meer boven de grens staat. Een wissel met de hand gaat voor tot de reset van het venster (met de hand naar API zet auto nooit terug); auto uit- en aanzetten beëindigt dat.
- Kosten: melding bij elke wissel en geschatte API-kosten vandaag/deze maand in het dashboard; geen harde stop. Prijzen per model, met bron en datum in `lib/api.mjs`.
- Voortgangsbalk tekent in dezelfde balk boven de prompt als de verbruiksmeters van de skin. `mcp__ccd_turn__wrap_up` sluit de lijst af.
- Gemeten: met `apiKeyHelper` in de settings gebruikt een gewone terminal-sessie de helper in plaats van het abonnement (nep-key → "Invalid API key · Fix external API key"); een vanuit de desktop-app geërfde omgeving negeert hem.
- Gemeten bijwerking: in API-modus laadt Claude Code de claude.ai-connectors niet ("claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set"). De tab API en de wisselmelding zeggen dat.

## Uitbreiding 10-11-2026

Accounts gebouwd volgens plan 6 (`docs/superpowers/plans/2026-11-10-futureflow-6-accounts.md`), met de besluiten van Colin daaronder.

- **Spike 6 niet uitgevoerd** (geen tweede account bij het bouwen; besluit Colin). De aannames onderaan Task 1 gelden: nieuwe terminal-sessies gebruiken het nieuwe account, een lopende terminal-sessie pakt het binnen ~30 s op, de desktop-app blijft ongewijzigd. Nog live te meten met Colin: `/status` na een wissel in een lopende en een nieuwe sessie, of `sessionId` in `~/.claude/sessions/<pid>.json` gelijk is aan `$.session.id`, en hoe snel `status` daar op `idle` staat na `turn.complete`.
- Ketting: met accounts-auto aan en minstens twee accounts in de rotatie beslist alleen de tab Accounts (ook over de API-wissel); `apiMeet` doet dan niets. Een desktop-sessie neemt dan geen wisselbesluit meer, ook niet naar de API. Met accounts-auto uit of minder dan twee accounts in de rotatie blijft het API-gedrag van 9-11-2026 precies gelijk.
- Bezig telt ruimer dan het plan: elk levend record in `~/.claude/sessions/` dat geen desktop-sessie is en niet `idle` (dus ook `waiting`, onbekende status, VS Code), want twijfel = niet wisselen.
- Poll-getallen (besluit Colin, zuiniger): vloer 360 s, actief tot 600 s, kandidaat 600-900 s, uitgeput 1200 s, na een 429 ≥ 600 s ×1,5 tot 1800 s. Staat het actieve account binnen 15 punten van zijn marge, dan haalt de CLI kandidaten met een meting ≥ 10 min bij, zodat de keuze op verse metingen kan.
- Stand vragen: elke terminal-sessie met futureflow kan de vraag tonen; Niet nu geldt voor alle sessies 30 min (store). Na Wissel probeert die sessie het opnieuw bij exit 7 tot het lukt of 10 min verstreken zijn.
- Desktop-app: de tab toont het verbruik zonder knoppen, met "De desktop-app regelt zijn eigen login; wisselen werkt alleen voor terminal-sessies." Desktop-sessies schrijven geen sessiebestand.

## Uitbreiding 10-11-2026 OpenRouter

Gebouwd volgens plan 7 (`docs/superpowers/plans/2026-11-10-futureflow-7-openrouter.md`). Besluiten van Colin: optie B (Claude Code zelf op een ander model), model kiezen uit de lijst van OpenRouter, ketting abonnement → ander abonnement → Anthropic API → OpenRouter met instelbare volgorde, met de hand wisselen kan altijd, alleen de terminal.

- Tab 8 `OpenRouter` (kort `OR`): key, zoeken en kiezen van hoofd- en snel model (Claude-modellen eerst), wisselen, Test verbinding, ketting-volgorde, geschatte kosten apart van de API.
- Settings: alleen futureflow's eigen sleutels, vastgelegd in een marker en exact terug te draaien; vreemde waarden blijven staan en de wissel wordt geweigerd.
- Nog live te meten met Colin: of OpenRouter de key via `apiKeyHelper` accepteert (Claude Code stuurt hem als Bearer én als x-api-key) en of `/status` in een nieuwe sessie de base-URL toont. Werkt de helper niet, dan is de terugval `ANTHROPIC_AUTH_TOKEN` in platte tekst; die is bewust niet gebouwd.
- Niet-Claude-modellen werken niet gegarandeerd in Claude Code; webzoeken werkt niet; de claude.ai-connectors staan uit.
