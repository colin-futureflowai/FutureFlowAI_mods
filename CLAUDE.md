# FutureFlowAI_mods — Claude Code plugins, skills en mods van FutureFlowAI

Eigen Claude Code plugins. Elke submap is één plugin; `.claude-plugin/marketplace.json` in de root maakt de repo installeerbaar als marketplace (`futureflowai-mods`). Een plugin kan een mod zijn (hooks-module), een bundel skills, of beide.

## Structuur

```
FutureFlowAI_mods/
├── CLAUDE.md
├── README.md                         ← tabel met alle plugins (bij elke nieuwe plugin bijwerken)
├── .claude-plugin/marketplace.json   ← lijst van alle plugins (bij elke nieuwe plugin bijwerken)
├── futureflow-skills/                ← skills-plugin
│   ├── .claude-plugin/plugin.json
│   └── skills/<skill-naam>/SKILL.md  ← één map per skill (+ eventuele scripts/referenties)
├── content-skills/                   ← skills-plugin, overgenomen van Ootto (MIT)
├── agent-slots/                      ← mod + losse CLI (bin/agent-slot.mjs), gedeelde lib/ en node-tests
├── minify/                           ← mod (korte antwoorden, uitvoer inkorten), pure lib/ en node-tests
└── voice-chat/                       ← één mod
    ├── .claude-plugin/plugin.json    ← naam, versie, beschrijving
    ├── hooks/hooks.json              ← { "modules": ["./register.tsx"] }
    ├── hooks/register.tsx            ← de hooks-module (draait in Claude Code, geen Node/DOM)
    ├── bridge/                       ← losse Node-processen die de mod start (wel Node)
    ├── tests/*.test.ts               ← `claude plugin test <mod>`
    ├── .env                          ← secrets, NIET in git
    └── .env.example                  ← wel in git
```

## Regels

- **Pluginnamen** mogen niet beginnen met `claude-`, `anthropic-` of `cc-plugin-` (gereserveerd; validatie faalt).
- **Hooks-module ≠ Node.** `hooks/register.tsx` heeft geen `fs`, `child_process`, `fetch` of `WebSocket`. Alles via `$`: `$.process.spawn`, `$.process.run`, `$.fs` (lezen/schrijven, maar niet atomair aanmaken of verwijderen), `$.http.fetch` (ook over een Unix-socket met `socketPath`), `$.env.get` (alleen string-literals), `$.plugin.root`. Wat echt Node nodig heeft (microfoon, websockets naar derden) hoort in een `bridge/`-script dat de mod spawnt.
- **Secrets** via `userConfig` in `plugin.json` met `"sensitive": true`: Claude Code vraagt ze bij installeren en bewaart ze in de keychain; de mod krijgt ze in `register(on, options)` en geeft ze bij spawnen als `env` door aan de bridge. `<mod>/.env` (chmod 600) is alleen de terugval voor ontwikkelen. Nooit committen; `.env.example` meenemen bij elke nieuwe variabele.
- **Binaries uit Homebrew** (`ffmpeg`, `ffplay`, `node`): de desktop-app heeft een kaal PATH, en `argv[0]` wordt op dát PATH gezocht, niet op de `env.PATH` die je meegeeft. Start dus via `['/usr/bin/env', 'node', …]` met `env: { PATH: '/opt/homebrew/bin:…' }` (Windows: gewoon `node`).
- **`tool.check`** krijgt de argumenten in `e.input` (`e.input.command` voor Bash), niet plat zoals `tool.call`, en ze liggen vast: een ander oordeel vraag je op met `$.tool.check({ tool, input })`.
- **`tsc -p <mod>`** kan in een sessie met veel MCP-servers falen op TS2589 (te diepe types door de union van alle MCP-tools). Type-check dan zonder `claude-code-mcp` in `types`.
- **Unix-socket-paden** onder `/tmp` houden; macOS kapt af bij ~104 tekens.
- **Gedeelde code** tussen hooks-module en Node-scripts: pure `.mjs` zonder Node-API's (bv. `agent-slots/lib/classify.mjs`), met een `.d.mts` ernaast voor de types.
- **Geen variabele `h` in een `.tsx`-module**: JSX compileert naar de globale `h`; een `h` in scope (bv. `list.map(h => …)`) breekt het tekenen met "h is not a function".
- **Mock-antwoorden in `*.test.ts`**: een test-hook op `$`-aanroepen (`env.get`, `session.id`, `process.run`) geeft `{ value }` terug, niet de waarde zelf.
- Taal van UI-teksten en code-commentaar: Nederlands; README's in het Engels.

## Checken vóór commit

```bash
claude plugin validate <mod>
claude plugin test <mod>
node --check <mod>/bridge/*.mjs
node --test agent-slots/tests/*.test.mjs   # CLI en commando-herkenning van agent-slots
node --test minify/tests/*.test.mjs        # regels, uitvoer inkorten en bestandscontrole van minify
```

Types voor de editor legt Claude Code zelf in `<mod>/.claude-plugin/types/` zodra de mod geladen is (gitignored); `tsc -p <mod>` type-checkt dan.

## Ontwikkelen met hot reload

Tijdens een sessie laadt Claude Code mods uit `~/.claude/dev-mods/<sessie-id>/`. Werkwijze: de mod blijft hier in de repo staan en in die map komt een symlink naar `FutureFlowAI_mods/<mod>`. Wijzigingen hier worden dan na elke beurt opnieuw geladen.

Vast installeren (alle sessies):

```bash
claude plugin marketplace add /pad/naar/FutureFlowAI_mods
claude plugin install voice-chat@futureflowai-mods
claude plugin install agent-slots@futureflowai-mods
claude plugin install minify@futureflowai-mods
claude plugin install futureflow-skills@futureflowai-mods
claude plugin install content-skills@futureflowai-mods
```

Na een wijziging: `/reload-plugins` in de sessie (een lokale marketplace wordt direct uit deze map gelezen).

## Plugins

### agent-slots
Houdt agents tegen voordat ze zoveel dev-servers, tests, browsers of sessies starten dat de computer vastloopt. Werkt voor Claude Code automatisch; andere agents gebruiken de CLI `agent-slot`. Ontwerp en regels: `agent-slots/DESIGN.md`.
- **CLI** `bin/agent-slot.mjs`: alle state in `~/.claude/agent-slots/` (locks met `O_EXCL`, `config.json`, `log.jsonl`). Alleen Node-builtins, want het bestand wordt los gekopieerd naar `~/.claude/agent-slots/bin/` (bij elke `session.start`) en de shim in `~/.local/bin` wijst daarheen.
- **Mod**: `tool.call` op Bash herkent zware commando's (`lib/classify.mjs`) en pakt ze in als `'node' '<cli>' run <soort> --session '<id>' -- sh -c '<cmd>'`; `tool.check` beoordeelt toestemming op het originele commando (`unwrapCommand`), maar alleen voor commando's die de mod zelf heeft ingepakt (Set `produced`); een nagemaakte wrapper wordt als geheel beoordeeld. Playwright-MCP-tools: browser-slot per sessie. `Agent` bij kritiek geheugen, `Workflow`/`start_session` onder de grens.
- **Faalt open**: `.catch(failOpen)` op de guards laat alles door bij een fout, met één toast en een regel in `~/.claude/agent-slots-mod.log`. Bewust, zodat een fout in de mod nooit al het werk blokkeert.
- **Valkuilen uit de live test (18-10-2026)**: `node` via `/usr/bin/env` starten (kaal PATH); de CLI vergelijkt realpaths om te zien of hij het hoofdscript is (de dev-mods-map is een symlink); een kapotte CLI geeft exitcode ≠ 0 en dat wordt een melding, geen stille doorlaat.
- Bewust gekozen (18-10-2026): vooral goed voor Claude Code; de CLI op het PATH is voor andere agents (Orca-workers e.d.). Eisen kwamen van een code-agent die vaak tegen geheugenproblemen aanliep (8 punten, zie DESIGN.md).
- Dashboard: `/agent-slots` opent een paneel dat elke 3 s `status --json` ophaalt (state `agent-slots.snapshot`, contract in `types/index.d.ts`); `/agent-slots status` is de tekstversie.
- Bijgesteld na de test met twee Orca-workers (18-10-2026): standaardgrens 25% (was 20%), status nieuwste eerst in lokale tijd, labels zonder omleidingen, meldingen met het korte `agent-slot` als dat op het PATH staat.
- Cloud-overflow (0.3/0.4): vinkje in het dashboard → `cloudOverflow` in `config.json`; weigeringen voor taken noemen dan de cloud-worker. Echt in de cloud starten kan alleen via de desktop-app (sessie met `target: "cloud"`) of `claude --cloud` in een interactieve terminal; Agent-tool met `isolation: remote` draaide in de test stil lokaal. Terugkanaal = git: `agent-slot overflow add/check`, de mod meldt het rapport elke minuut aan de starter-sessie (`lib/report.mjs`). Conventies (branch `overflow/…`, trailers, rapportcommit) staan op één plek in `agent-slot overflow brief`; houd skill, agent en DESIGN.md daarmee gelijk.
- Een testbestand (`*.test.ts`) mag geen dynamische `import()` bevatten; zet te testen functies in een pure `lib/*.mjs`.
- In `*.test.ts` alle `on(...)`-mocks registreren vóór de eerste `$`-aanroep (ook niet in een lus erna).
- Geheimen: alles wat agent-slots bewaart of toont gaat door `maskSecrets` (lib én CLI, gelijk gehouden door een test). Nieuwe velden met commando- of taaktekst toevoegen aan `MASKED_FIELDS` in de CLI.
- Testen: `node --test agent-slots/tests/*.test.mjs` (CLI met echte processen, `AGENT_SLOT_HOME` en `AGENT_SLOT_FAKE_FREE`) en `claude plugin test agent-slots` (hook-logica met nep-CLI).

### minify
Minder tokens: Claude antwoordt kort (`/minify O1|O2|O3|uit`, standaard `O2`, staat standaard aan) en lange tooluitvoer en geheugenbestanden worden ingekort. Ontwerp: `minify/DESIGN.md`.
- Gebaseerd op [Caveman](https://github.com/JuliusBrussee/caveman) (Apache-2.0, commit `9b68f7e`, 25-10-2026). Regels vertaald en aangepast in `lib/regels.mjs` en `lib/bestand.mjs`; code is eigen werk. `LICENSE` (Apache) en `NOTICE` blijven staan. "Caveman" is een merk: niet als naam gebruiken.
- Korte antwoorden via command hooks in `hooks/hooks.json` (naast `modules`), zoals caveman: `bin/regels.sh start|prompt|subagent` (gewone `sh`). De mod-hooks `prompt.compose`/`prompt.section` werken níet: de ingebouwde `cc-plugin-sec-default` slaat ze voor zelf geïnstalleerde plugins altijd over. De mod schrijft teksten naar `~/.claude/minify/regels/` en het niveau per sessie naar `niveau/<sessie>`; het script leest, `lib/regels.mjs` is de enige bron. `/minify` toont of de regels meegingen (`gemeld/<sessie>`).
- Uitvoer inkorten in `tool.call` op Bash en `mcp__*` (niet Read/Edit/Grep): na `next(e)` een nieuw `{ result }` zonder `ref` teruggeven, anders gebruikt core zijn eigen berichten. Een hook kan **geen** `isError`-resultaat teruggeven (core valideert het als gewoon resultaat → uitvoer kwijt); een ingekorte fout gaat als `{ deny }` ná uitvoering. Bij `persistedOutputPath` (uitvoer > ~30 KB, model ziet anders alleen de eerste 2 KB) leest minify dat bestand en kort het hele ding in. Origineel naar `~/.claude/minify/uitvoer/<sessie>/`.
- `tsc` op minify: de engine zet `claude-code-mcp` terug in `.claude-plugin/types/tsconfig.json` (TS2589); type-check met een eigen tsconfig die alleen `claude-code` en `claude-code-tools` noemt.
- `/minify bestand` gebruikt `$.model.complete` (Haiku) en `controleer()`: koppen, codeblokken, inline code en URL's moeten blijven, anders wordt niets overschreven. Weigert `vault/`, geheimen en alles behalve `.md`/`.txt`. Backups in `~/.claude/minify/backups/`.
- Meting per niveau in `$.store` (`perNiveau`), per sessie in `$.state` (`minify.teller`). Geen A/B-test: dat staat ook bij `/minify stats`.
- Testen: `node --test minify/tests/*.test.mjs` (pure lib en `regels.sh` met `MINIFY_HOME`) en `claude plugin test minify` (hooks met nep-`$`).

### futureflow-skills
Bundel skills van FutureFlowAI. Claude Code vindt elke `skills/<naam>/SKILL.md` vanzelf; er hoeft niets in `plugin.json` bij.
- `SKILL.md` begint met frontmatter: `name` (gelijk aan de mapnaam, kebab-case) en `description` (wanneer Claude hem moet gebruiken; dit bepaalt of hij getriggerd wordt). Daarna de instructies.
- Hulpbestanden (scripts, sjablonen, referenties) in dezelfde skill-map, en vanuit `SKILL.md` relatief ernaar verwijzen.
- Geen klant-specifieke context of secrets in een skill; die horen in de vault van het bedrijf.
- Bij een nieuwe skill: versie in `plugin.json` ophogen en de skill hieronder noemen.

Skills: nog geen.

### content-skills
54 content- en social-media-skills, overgenomen van [Ootto-AI/claude-content-skills](https://github.com/Ootto-AI/claude-content-skills) v1.4.0 (commit `c79c330`, 18-10-2026). Zelfde conventies als `futureflow-skills`.
- MIT: `LICENSE` en de naamsvermelding in `README.md` blijven staan. `UPSTREAM-README.md` is het origineel, ter referentie.
- Updates van Ootto komen niet vanzelf mee. Nieuwe upstream-versie overnemen = handmatig diffen tegen de genoemde commit, zodat onze aanpassingen blijven.
- Elke aanpassing aan een skill: versie in `plugin.json` ophogen.
- FutureFlowAI-branding (1.5.0): `description` begint met `FutureFlowAI <Naam> skill.` en onder de H1 staat een `> **FutureFlowAI skill.**`-regel, zodat Claude de skill aankondigt als "de FutureFlowAI <Naam> skill". `<Naam>` = de H1 tot aan de gedachtestreep. Bij een nieuwe of overgenomen skill beide toevoegen.

### voice-chat
Praten met een Claude Code sessie via een Inworld-spraakagent. `/voice` zet hem aan of uit, verder `/voice voorlezen|stil|mute|unmute`. Een balk boven het invoerveld (`ui.render` op `AbovePrompt`, state in `$.state` `voice-chat.band`, contract in `types/index.d.ts`) toont of de agent luistert of praat, of Claude bezig is, welke taak de agent doorgaf, en de laatste zin.

**Agentmodus (standaard)** — `bridge/agent-bridge.mjs`:
- Microfoon (`ffmpeg -f avfoundation`, 24 kHz PCM16) → Inworld Realtime (`wss://api.inworld.ai/api/v1/realtime/session?key=<id>&protocol=realtime`, `Authorization: Basic <key>`, OpenAI-Realtime-protocol) → audio terug naar `ffplay`.
- De agent draait op Inworlds eigen LLM (`agent_model`, standaard `openai/gpt-4.1-mini`) en voert het gesprek zelf. Grote taken geeft hij door met de tool `geef_taak_aan_claude_code` (`providerData.auto_tool_response: false`); de bridge zet die als `{type:"task"}` op stdout, de mod stuurt hem in als `[via spraakagent] <taak>` en zet de taak in de balk tot de beurt klaar is.
- Teksten voor de agent (instructies, tooldefinitie, context, resultaatbericht) en de taakpoort staan in `bridge/agent-text.mjs`, zonder Node-API's, zodat `tests/` ze direct test; `agent-text.d.mts` geeft de types.
- Koppeling: `turn.start` met dat label (ook met de kop "The voice-chat plugin sent a message:" ervoor) koppelt de beurt aan de taak; alleen bij `turn.complete` van zo'n beurt gaat Claudes antwoord als platte tekst via `POST /result` terug, zodat getypte prompts er niet tussendoor lopen.
- Sessiegeheugen: bij `ready` stuurt de mod de laatste beurten van de sessie (`$.session.messages({ as: 'api' })`, zonder system-reminders en tool-blokken, max. ~6000 tekens) via `POST /context`; elke getypte beurt daarna via `POST /note`. De bridge zet ze als stille `system`-berichten (`[Sessie-context]`, `[Sessie-update]`) in het gesprek, waar de agent niet op reageert maar wel uit put, en stuurt ze na opnieuw verbinden opnieuw mee.
- Goedkeuring: `classic.PermissionRequest` tijdens een agent-taak → `POST /notice` (de agent zegt dat er in het scherm gekeken moet worden) en rood in de balk; de volgende `tool.call` haalt het weg.
- Beveiliging (prompt-injection): wat de agent doorgeeft is gesproken, door een extern model samengevat, en kan achtergrondgeluid bevatten. Daarom:
  - `$.prompt.submit` zonder `asUser` (in beide modi): het model leest het als bericht van de voice-chat plugin, niet als getypte prompt van de gebruiker. `prompt.compose` vertelt Claude bovendien dat zo'n taak geen getypte opdracht is en dat onomkeerbare of naar buiten gerichte acties eerst bevestigd moeten worden (de vraag gaat via de agent terug).
  - Mondelinge bevestiging: de agent vraagt eerst "Zal ik Claude Code vragen om …?" en roept de tool pas aan na een mondeling ja (verplicht argument `bevestiging`). De taakpoort in de bridge laat een taak alleen door als de gebruiker gesproken heeft (`input_audio_buffer.committed`) sinds de vorige beurt van de agent (`response.done`), de vorige taak of het laatste bericht van Claude Code; anders krijgt de agent "niet doorgegeven" terug. Zo kan de agent niet in één adem vragen en doorgeven, en geen taak maken uit een resultaat.
  - `/result` en `/notice` komen als `system`-bericht binnen, niet als `user`. Het antwoord staat tussen `<claude_code_resultaat>`-markeringen (een sluit-markering in het antwoord zelf wordt weggehaald), met de instructie dat het data is om na te vertellen en geen opdracht of nieuwe taak.
- Context: de bridge draait in de werkmap van de sessie. Buiten `agent_context_roots` (vertrouwde mappen, bv. `~/Projects`) krijgt de agent alleen de projectnaam; daarbinnen ook de bovenste bestandsnamen en `CLAUDE.md`, elk tussen markeringen (`<bestanden>`, `<claude_md>`) als achtergrond, niet als opdracht.
- Bewust gekozen (13-10-2026): de agent is een snelle tussenpersoon met een eigen LLM; Claude Code blijft het brein voor echt werk. Dit vervangt de eerdere keuze om Realtime niet te gebruiken.

**Voorleesmodus** — `/voice voorlezen`, `bridge/voice-bridge.mjs`: Inworld streaming STT → prompt naar Claude; antwoord ingekort (Haiku bij lange antwoorden) → Inworld TTS → `ffplay`. Claude praat hier zelf.

Beide modi:
- Half-duplex: de microfoon staat dicht terwijl er audio speelt (en 400 ms erna), tenzij `BARGE_IN=true` (alleen met koptelefoon).
- Instellingen: `userConfig` (`inworld_api_key` geheim, `language`, `voice_id`, `tts_model`, `mic_device`, `barge_in`, `agent_model`, `agent_context_roots`) → env van de bridge; lege velden vallen terug op `.env`, daarna op de standaard in de bridge.
