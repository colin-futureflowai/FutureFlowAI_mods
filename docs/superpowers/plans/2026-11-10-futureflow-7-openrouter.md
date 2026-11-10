# futureflow 7: OpenRouter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code zelf (nieuwe terminal-sessies) op een ander model laten draaien via OpenRouter (optie B van Colin). In de tab kies je een hoofdmodel en een snel model uit de lijst van OpenRouter; wisselen kan met de hand en als laatste stap van de automatische ketting (abonnement → ander abonnement → Anthropic API → OpenRouter; volgorde van API en OpenRouter instelbaar).

**Architecture:** Binnen de mod `futureflow/`. Alles buiten de plugin (sleutelhanger, `~/.claude/settings.json`, netwerk naar openrouter.ai, cache en marker in `~/.claude/futureflow/openrouter/`) gaat via `cli/api.mjs` (nieuwe subcommando's `openrouter …`, `modus openrouter`). Pure logica (instellingen toepassen en exact weghalen, modus uit settings, modellijst sorteren/filteren, kosten, ketting-stappen) in `lib/openrouter.mjs` en `lib/api.mjs` met `.d.mts`. De mod krijgt `hooks/openrouter.tsx` (tab 8) en breidt `hooks/api.tsx` (wissel, kosten) en `lib/accounts.mjs` (`ketting`) uit.

**Tech Stack:** Claude Code mods (hooks-module, `$`-API), Node-builtins (globale `fetch`), macOS `/usr/bin/security`.

**Bron:** onderzoek `openrouter-research.md` (10-11-2026): `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_API_KEY=""`, modellen via `ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE,HAIKU}_MODEL` en `CLAUDE_CODE_SUBAGENT_MODEL`; `GET /api/v1/models?supported_parameters=tools` werkt zonder key; prijzen in USD per token (strings).

## Global Constraints

- Alleen de terminal: de desktop-app houdt zijn login. Geldt voor nieuwe terminal-sessies. Op OpenRouter laadt Claude Code de claude.ai-connectors niet.
- Key in de sleutelhanger, service `futureflow-openrouter`, account `futureflow`; alleen via stdin (hook → CLI → `security -i`); nooit in argv, state, store, log, toast of uitvoer (alleen de laatste 4 tekens). Formaat `^sk-or-[A-Za-z0-9_-]{20,}$`.
- Settings atomisch (tmp + rename, opnieuw lezen bij een tussentijdse wijziging), alleen futureflow's eigen sleutels, vastgelegd in een marker (`~/.claude/futureflow/openrouter/marker.json`) zodat ze exact weg kunnen: `env.ANTHROPIC_BASE_URL`, `env.ANTHROPIC_API_KEY=""`, `apiKeyHelper` = `/usr/bin/security find-generic-password -s futureflow-openrouter -a futureflow -w`, `env.ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE}_MODEL` = hoofdmodel, `env.ANTHROPIC_DEFAULT_HAIKU_MODEL` en `env.CLAUDE_CODE_SUBAGENT_MODEL` = snel model, `env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`.
  - Een sleutel die al met precies die waarde bestaat (van de gebruiker) wordt niet opgenomen in de marker en blijft dus staan bij terugwisselen. Een andere waarde op een van onze sleutels: weigeren (exit 3), niets geschreven.
  - Terug naar abonnement of API: alleen sleutels uit de marker weghalen, en alleen als de waarde nog gelijk is. Een vreemde `apiKeyHelper` of `ANTHROPIC_BASE_URL`: weigeren met uitleg (vreemde base-URL blokkeert API en OpenRouter, niet terug naar abonnement).
  - Modi `abonnement | api | openrouter` op één plek: `MODI` en `modusVan(data)` in `lib/api.mjs`, gebruikt door CLI en mod.
- Terugval (gedocumenteerd, niet gebouwd): als OpenRouter de helper niet accepteert, is het alternatief `env.ANTHROPIC_AUTH_TOKEN` in platte tekst. Daarom de knop "Test verbinding" → `api openrouter test --model <snel>`: één `POST https://openrouter.ai/api/v1/messages` (Anthropic-formaat, `max_tokens: 1`, `Authorization: Bearer <key uit de sleutelhanger, binnen de CLI>`), uitkomst alleen ok/fout. Alleen op de knop, nooit automatisch.
- Modellijst: `api openrouter modellen [--ververs]` → cache `modellen.json`, hoogstens één keer per 6 uur opnieuw (of op de knop). Uitvoer per model: id, naam, context, prijs in/uit per Mtok.
- CLI-spawns krijgen een vaste env (`SECURITY_BIN`, `SETTINGS_JSON=''`, `CLAUDE_JSON=''`, `OPENROUTER_DIR=''`, `OPENROUTER_URL=''`).
- Validator: `$` alleen aan `function`-declaraties; geen nieuwe ongematchte handlers; geen `h` in `.tsx`; `types/index.d.ts` één zelfstandig bestand.
- Layout breekt zelf af (`flexWrap`); `viewport.columns` is de hele terminal, niet het paneel: niet zelf rekenen.
- UI-teksten en commentaar Nederlands, README Engels. Tests raken nooit de echte sleutelhanger, settings of netwerk (behalve één keer `openrouter modellen` met de hand, alleen lezen).

## Review Focus

- Exact terugdraaien: na openrouter → abonnement is settings.json byte-gelijk aan vóór de wissel (zelfde opmaak), ook met vooraf bestaande eigen env-regels.
- Nooit vreemde waarden overschrijven of weghalen; weigeren met exit 3.
- Key lekt nergens (argv, stdout, stderr, foutmelding van de test-aanroep).
- Ketting: OpenRouter alleen met key + modellen + aangezet in de volgorde; terug naar een abonnement met ruimte; keuze met de hand gaat voor.

### Task 1: Pure logica

- [ ] `lib/api.mjs`: `MODI`, `modusVan(data)` (abonnement/api/openrouter, vreemdeHelper, vreemdeBasis), `toestandVan` met `modus` openrouter en `stappen` (deelverzameling van `api`, `openrouter`, standaard `['api']`), `beslis` met `stappen` en `beschikbaar` (eerste beschikbare stap; terug vanaf api én openrouter).
- [ ] `lib/openrouter.mjs`: `OR_SERVICE`, `OR_HELPER`, `OR_URL`, `geldigeOrKey`, `geldigModel`, `orInstellingen(model, snel)`, `pasToe(data, gewenst)` → `{ data, marker }` of `{ vreemd }`, `haalWeg(data, marker)`, `modellenVan(ruw)`, `sorteer(lijst, zoek)` (Claude eerst), `orKosten(usage, prijs)`, `perMtok`.
- [ ] `lib/accounts.mjs` `ketting`: `stappen`/`beschikbaar` doorgeven; terug vanaf elke niet-abonnement-modus.
- [ ] Tabel-tests `tests/openrouter-lib.test.mjs`, uitbreiding `api-lib`/`accounts-lib`.

### Task 2: CLI

- [ ] `api openrouter zet-key|wis-key|modellen [--ververs]|test --model <id>`; `api modus openrouter --model <id> --snel <id>`; `status` met `orHeeftKey`, `orStaart`, `vreemdeBasis`, `orModel`, `orSnel`.
- [ ] Marker eerst schrijven, dan settings; terug: settings, dan marker weg. `OPENROUTER_DIR`, `OPENROUTER_URL` voor tests.
- [ ] Tests `tests/openrouter-cli.test.mjs`: nep-security, tijdelijke settings, lokale http-server (modellen, cache 6 u, test ok/fout zonder key in uitvoer), heen-en-terug byte-gelijk, vreemde waarden geweigerd.

### Task 3: Mod — tab OpenRouter en ketting

- [ ] `hooks/openrouter.tsx`: tab 8 (`OpenRouter`, kort `OR`): status en wisselknoppen, key, zoeken + 15 modellen (Claude-groep eerst) met knoppen Hoofd/Snel, ketting-volgorde, kosten, waarschuwingen.
- [ ] `hooks/api.tsx`: `wissel` naar openrouter (met gekozen modellen), kosten op OpenRouter apart (`openrouter.kosten`), `apiMeet` met stappen/beschikbaar; `hooks/accounts.tsx` geeft dezelfde door.
- [ ] Tests `tests/openrouter.test.ts`: tab, zoeken, model kiezen, wissel, ketting naar OpenRouter en terug, key alleen via stdin.

### Task 4: Afronden

- [ ] README (OpenRouter), CLAUDE.md `### futureflow`, spec "Uitbreiding 10-11-2026 OpenRouter", versie 0.7.0. Alle checks groen.
