# futureflow — Plan 1: fundament (checks, plugin, Slots en Minify)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een werkende plugin `futureflow` die agent-slots en minify volledig overneemt, met een veilige overgang zolang de oude plugins nog geïnstalleerd zijn.

**Architecture:** Nieuwe map `futureflow/`. `hooks/register.tsx` is alleen een samensteller die `registerSlots` en `registerMinify` aanroept; elk onderdeel woont in een eigen `hooks/<onderdeel>.tsx` met pure logica in `lib/*.mjs`. Code wordt eerst **gekopieerd** (de oude plugins blijven werken vanuit dezelfde lokale marketplace); de oude mappen gaan pas weg in Taak 6, na de live test.

**Tech Stack:** Claude Code mods (TSX hooks-module, `$`-API), Node ≥ 20 (alleen builtins) voor CLI en tests, POSIX `sh` voor command hooks.

**Spec:** `docs/superpowers/specs/2026-11-08-futureflow-supermod-design.md`

## Volgorde van alle plannen

Dit is plan 1 van 6. Elk plan levert een werkende plugin op.

1. **Fundament** (dit plan): checks, plugin, Slots, Minify, overgang.
2. **Dashboard**: `/futureflow`-paneel met navigatie; tabs Overzicht, Agent slots, Minify (vervangt de losse panelen).
3. **Voortgang**: statusbalk A/B boven het invoerveld.
4. **Cache**: guard, keepwarm, teller, tab Cache.
5. **Skin**: FFAI-thema, tool-regels, diff- en shell-kaart, tab Stijl.
6. **Accounts**: wisselaar-CLI, machinebrede wisselaar, tab Accounts.

## Global Constraints

- Pluginnaam `futureflow`; versie start op `0.1.0`; minimale Claude Code `2.1.287`.
- Hooks-module heeft geen Node-API's; alles via `$`. Node-processen via `['/usr/bin/env','node',…]` met `env: { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' }`.
- Pure gedeelde code in `lib/*.mjs` met `.d.mts` ernaast. Geen dynamische `import()` in `*.test.ts`. In `*.test.ts` alle `on(...)`-mocks vóór de eerste `$`-aanroep; mocks geven `{ value }` terug.
- Geen variabele `h` in `.tsx`.
- UI-teksten en commentaar Nederlands; README Engels.
- Elk onderdeel faalt open: `.catch(failOpen)`, één toast, regel in `~/.claude/futureflow/mod.log`.
- Alles wat commando- of taaktekst bewaart of toont gaat door `maskSecrets`.
- State-paden van de CLI blijven: `~/.claude/agent-slots/` (agent-slot) en `~/.claude/minify/` (regels.sh). Nieuwe eigen state onder `~/.claude/futureflow/`.
- Licenties: minify-code blijft Apache-2.0 met `NOTICE`; de rest MIT.

## Review Focus

1. **Oude en nieuwe plugin tegelijk geïnstalleerd** → futureflow pakt geen commando's in, kort geen uitvoer in, registreert `/minify` en `/agent-slots` niet, en `regels.sh` van futureflow zegt niets (anders krijgt Claude de minify-regels twee keer). Test in Taak 2 en Taak 5.
2. **Oude plugin geïnstalleerd maar uitgeschakeld** (`enabledPlugins[...] === false`) → telt als afwezig; futureflow werkt volledig. Test in Taak 2.
3. **`installed_plugins.json` of `settings.json` ontbreekt of is kapotte JSON** → telt als "geen oude plugins", geen crash. Test in Taak 2.
4. **Minify-standaard die de gebruiker eerder op `uit` of `O1` zette** (bestand `~/.claude/minify/standaard`) → futureflow neemt die over, niet `O2`. Test in Taak 4.
5. **Sessie-id met vreemde tekens in `regels.sh`** → blijft gefilterd tot `[A-Za-z0-9_-]` (bestaand gedrag, test verhuist mee). Test in Taak 4.

---

### Taak 1: Checks vooraf (bron van de takenlijst, login in de desktop)

Weggooi-onderzoek; levert alleen bevindingen op in de spec. Geen code in de repo.

**Files:**
- Create (tijdelijk, buiten de repo): `/tmp/ff-spike/.claude-plugin/plugin.json`, `/tmp/ff-spike/hooks/hooks.json`, `/tmp/ff-spike/hooks/register.tsx`
- Modify: `docs/superpowers/specs/2026-11-08-futureflow-supermod-design.md` (nieuwe sectie `## Bevindingen vooraf`)

**Al vastgesteld (8-11-2026, in een Code-tab-sessie):** de omgeving bevat `CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_ACCOUNT_UUID` en `CLAUDE_CODE_ORGANIZATION_UUID`. De desktop-app regelt de login dus zelf. De Keychain-item `Claude Code-credentials` (acct = macOS-gebruiker) bestaat. Werkhypothese: wisselen via de Keychain werkt niet in de desktop.

- [ ] **Stap 1: Spike-mod maken** met `register.tsx` die op `tool.call` (alle tools) de toolnaam, `Object.keys(e.input ?? {})` en voor `TodoWrite`, `TaskCreate`, `TaskUpdate` en `mcp__ccd_turn__update_plan` de volledige `e.input` als JSON-regel toevoegt aan `~/.claude/futureflow/spike.log` (via `$.fs.read` + `$.fs.write`), en daarna `next(e)` teruggeeft.
- [ ] **Stap 2: Laden in de terminal**: `claude --plugin-dir /tmp/ff-spike`, vraag "maak een takenlijst van 3 stappen en vink ze een voor een af". Lees `spike.log`.
- [ ] **Stap 3: Laden in de desktop-app**: symlink `/tmp/ff-spike` in `~/.claude/dev-mods/<sessie-id>/`, zelfde vraag. Lees `spike.log`.
- [ ] **Stap 4: Login-check desktop**: Colin wisselt in een terminal met een tweede account (`/login`), en in een al open Code-tab-sessie wordt `echo $CLAUDE_CODE_USER_EMAIL` en een korte prompt gedaan. Verandert het account in de Code-tab niet, dan is de hypothese bevestigd.
- [ ] **Stap 5: Bevindingen vastleggen** in de spec: welke tool(s) de takenlijst dragen per oppervlak, de vorm van de invoer (velden voor titel, stappen, status), en of Accounts in de desktop kan wisselen. Spike-map weggooien.
- [ ] **Stap 6: Commit**

```bash
git add docs/superpowers/specs/2026-11-08-futureflow-supermod-design.md
git commit -m "futureflow: bevindingen vooraf (takenlijst, login desktop)"
```

---

### Taak 2: Plugin-skelet en herkenning van de oude plugins

**Files:**
- Create: `futureflow/.claude-plugin/plugin.json`, `futureflow/hooks/hooks.json`, `futureflow/hooks/register.tsx`, `futureflow/hooks/ctx.ts`, `futureflow/lib/oud.mjs`, `futureflow/lib/oud.d.mts`, `futureflow/tests/oud.test.mjs`, `futureflow/types/index.d.ts`, `futureflow/tsconfig.json`, `futureflow/README.md`
- Modify: `.claude-plugin/marketplace.json` (entry `futureflow` toevoegen; oude entries blijven tot Taak 6)

**Interfaces:**
- Produces:
  - `oudePlugins(installed: unknown, settings: unknown): { slots: boolean; minify: boolean }` in `lib/oud.mjs`. `installed` = geparste `~/.claude/plugins/installed_plugins.json`, `settings` = geparste `~/.claude/settings.json`. Een plugin telt als aanwezig als `agent-slots@futureflowai-mods` resp. `minify@futureflowai-mods` voorkomt in `installed.plugins` (of op het hoogste niveau als `plugins` ontbreekt) **en** `settings.enabledPlugins[naam] !== false`. Ongeldige invoer → beide `false`.
  - `type Ctx = { oud(): Promise<{ slots: boolean; minify: boolean }>; failOpen($: Engine, err: unknown): void; log($: Engine, regel: string): Promise<void> }` in `hooks/ctx.ts`; `maakCtx(): Ctx` leest beide JSON-bestanden één keer per sessie (cache in een closure) via `$.fs.read` en `$.env.get('HOME')`.
  - Bij elke `session.start`: schrijf `~/.claude/futureflow/oud` met inhoud `slots,minify` (alleen de aanwezige), of een leeg bestand als geen van beide aanwezig is. `regels.sh` (Taak 4) leest dit.
  - `register.tsx`: `export const register: Register = (on, options) => { const ctx = maakCtx(); registerSlots(on, ctx); registerMinify(on, ctx) }`. In deze taak bestaan `registerSlots`/`registerMinify` nog niet: begin met een `session.start` die alleen het `oud`-bestand schrijft en, als iets aanwezig is, één toast toont.

- [ ] **Stap 1: Failing tests** in `tests/oud.test.mjs`:
  - `test('beide oud aanwezig en aan')`: `installed = { plugins: { 'agent-slots@futureflowai-mods': [{}], 'minify@futureflowai-mods': [{}] } }`, `settings = { enabledPlugins: {} }` → `{ slots: true, minify: true }`.
  - `test('uitgeschakeld telt als afwezig')`: zelfde `installed`, `settings.enabledPlugins['minify@futureflowai-mods'] = false` → `{ slots: true, minify: false }`.
  - `test('ontbrekend of kapot telt als afwezig')`: `oudePlugins(undefined, undefined)`, `oudePlugins('x', null)`, `oudePlugins({}, {})` → elk `{ slots: false, minify: false }`.
  - `test('alleen futureflow')`: `installed.plugins` met alleen `futureflow@futureflowai-mods` → beide `false`.
- [ ] **Stap 2:** `node --test futureflow/tests/oud.test.mjs` → FAIL (module ontbreekt).
- [ ] **Stap 3: Implementeren** `lib/oud.mjs` + `.d.mts`, `hooks/ctx.ts`, `register.tsx`, `plugin.json` (`name: "futureflow"`, `version: "0.1.0"`, `license: "MIT"`, `author.name: "FutureFlowAI"`, `types: "./types/index.d.ts"`, description: "FutureFlowAI's all-in-one mod: fewer tokens in and out, a Mac that doesn't freeze, a branded look and progress you can see"), `hooks.json` (`{"modules":["./register.tsx"]}`), `tsconfig.json` zoals agent-slots, `README.md` (Engels, kort: wat het is, dat het agent-slots en minify vervangt, installatie).
- [ ] **Stap 4:** `node --test futureflow/tests/oud.test.mjs` → PASS; `claude plugin validate futureflow` → geen fouten.
- [ ] **Stap 5: Toast-tekst** bij oude plugins aanwezig (exacte tekst): `futureflow: agent-slots en/of minify staan nog aan. futureflow laat die onderdelen over aan de oude plugin tot je ze verwijdert: claude plugin uninstall agent-slots@futureflowai-mods minify@futureflowai-mods` (alleen de aanwezige namen noemen).
- [ ] **Stap 6: Commit**

```bash
git add futureflow .claude-plugin/marketplace.json
git commit -m "futureflow 0.1.0: skelet en herkenning van de oude plugins"
```

---

### Taak 3: Slots overnemen

**Files:**
- Copy: `agent-slots/cli/` → `futureflow/cli/`; `agent-slots/lib/{classify,report}.{mjs,d.mts}` → `futureflow/lib/`; `agent-slots/skills/cloud-overflow/` → `futureflow/skills/cloud-overflow/`; `agent-slots/agents/cloud-worker.md` → `futureflow/agents/`; `agent-slots/tests/{classify,cli}.test.mjs` → `futureflow/tests/slots-*.test.mjs`; `agent-slots/tests/mod.test.ts` → `futureflow/tests/slots.test.ts`; `agent-slots/DESIGN.md` → `futureflow/docs/slots.md`
- Create: `futureflow/hooks/slots.tsx` (uit `agent-slots/hooks/register.tsx`)
- Modify: `futureflow/cli/agent-slot.mjs:259` (`agent-slots:cloud-worker` → `futureflow:cloud-worker`); `futureflow/skills/cloud-overflow/SKILL.md` en `futureflow/agents/cloud-worker.md` (zelfde naamwijziging, overal waar `agent-slots:` als plugin-prefix staat); `futureflow/types/index.d.ts`; `futureflow/hooks/register.tsx`

**Interfaces:**
- Consumes: `Ctx` uit Taak 2.
- Produces: `registerSlots(on: Parameters<Register>[0], ctx: Ctx): void` in `hooks/slots.tsx`. Gedrag = agent-slots 0.5.0, met deze verschillen:
  - Elke handler begint met `if ((await ctx.oud()).slots) return next(e)` (handlers zonder `next`, zoals `command.run` en `ui.render`, worden dan niet geregistreerd: `/agent-slots` wordt alleen in `session.start` geregistreerd als `!(await ctx.oud()).slots`).
  - Atom: `atom({ plugin: 'futureflow', key: 'slots.snapshot' } as const, …)`; `PluginState['futureflow']['slots.snapshot']: SlotsSnapshot | null` in `types/index.d.ts` (types `SlotsSnapshot`, `SlotsHolder`, `OverflowJob` verhuizen mee).
  - Foutafhandeling via `ctx.failOpen`; log naar `~/.claude/futureflow/mod.log` met prefix `[slots]`.
  - CLI-pad blijft `${$.plugin.root}/cli/agent-slot.mjs`; kopie naar `~/.claude/agent-slots/bin/` en de shim blijven ongewijzigd.

- [ ] **Stap 1: Kopiëren** (cp, geen git mv) en de imports in de testbestanden naar de nieuwe paden zetten.
- [ ] **Stap 2: Nieuwe test** in `tests/slots.test.ts`: `test('pakt niets in als agent-slots nog aan staat')` — mock `fs.read` zodat `installed_plugins.json` `agent-slots@futureflowai-mods` bevat; een `tool.call` op Bash met `npm run dev` geeft de invoer ongewijzigd door (`e.input.command === 'npm run dev'`).
- [ ] **Stap 3:** `claude plugin test futureflow` → nieuwe test FAIL, rest nog niet aangesloten.
- [ ] **Stap 4: `slots.tsx` maken** volgens de interface hierboven en aansluiten in `register.tsx`.
- [ ] **Stap 5: Verifiëren**
  - `node --test futureflow/tests/slots-*.test.mjs` → PASS (zelfde aantal tests als `agent-slots/tests/*.test.mjs`)
  - `claude plugin test futureflow` → PASS
  - `node --check futureflow/cli/agent-slot.mjs` → geen uitvoer
  - `grep -rn "agent-slots:" futureflow` → geen treffers
- [ ] **Stap 6: Commit**

```bash
git add futureflow
git commit -m "futureflow: Slots overgenomen uit agent-slots 0.5.0"
```

---

### Taak 4: Minify overnemen

**Files:**
- Copy: `minify/lib/{regels,uitvoer,grafiek,bestand}.{mjs,d.mts}` → `futureflow/lib/`; `minify/scripts/regels.sh` → `futureflow/scripts/`; `minify/tests/{lib,regels-sh}.test.mjs` → `futureflow/tests/minify-*.test.mjs`; `minify/tests/mod.test.ts` → `futureflow/tests/minify.test.ts`; `minify/DESIGN.md` → `futureflow/docs/minify.md`; `minify/LICENSE` → `futureflow/LICENSES/Apache-2.0.txt`; `minify/NOTICE` → `futureflow/NOTICE` (aanvullen: welke bestanden onder Apache-2.0 vallen)
- Create: `futureflow/hooks/minify.tsx` (uit `minify/hooks/register.tsx`); `futureflow/tsconfig.check.json` (extends `./.claude-plugin/types/tsconfig.json`, `compilerOptions.types: ["claude-code", "claude-code-tools"]`)
- Modify: `futureflow/hooks/hooks.json` (de drie command hooks van minify toevoegen, pad `${CLAUDE_PLUGIN_ROOT}/scripts/regels.sh`); `futureflow/scripts/regels.sh`; `futureflow/types/index.d.ts`; `futureflow/hooks/register.tsx`

**Interfaces:**
- Consumes: `Ctx` uit Taak 2; bestand `~/.claude/futureflow/oud` uit Taak 2.
- Produces: `registerMinify(on: Parameters<Register>[0], ctx: Ctx): void` in `hooks/minify.tsx`. Gedrag = minify 0.2.1, met deze verschillen:
  - Zelfde gating als Slots, op `(await ctx.oud()).minify`; `/minify` alleen registreren als minify oud afwezig is.
  - Atoms: `plugin: 'futureflow'`, keys `minify.niveau`, `minify.teller`, `minify.reeks`, `minify.recent`; types `MinifyNiveau`, `MinifyTeller`, `MinifyInkorting` verhuizen mee.
  - `$.store`-sleutels krijgen prefix `minify.` (`minify.standaard`, `minify.perNiveau`). Is `minify.standaard` leeg, dan geldt de inhoud van `~/.claude/minify/standaard` (als dat `O1`/`O2`/`O3`/`uit` is), anders `O2`. Tellers beginnen opnieuw; dat staat in de changelog.
  - `MODEL_BESTAND` blijft `'claude-haiku-5-5'`.
- `regels.sh`: direct na het lezen van `$dir`: `[ -s "$HOME/.claude/futureflow/oud" ] && grep -q minify "$HOME/.claude/futureflow/oud" && exit 0` (respecteert `FUTUREFLOW_HOME` als die gezet is, voor tests).

- [ ] **Stap 1: Kopiëren** en imports in testbestanden bijwerken.
- [ ] **Stap 2: Nieuwe tests**
  - `tests/minify-regels-sh.test.mjs`: `test('zwijgt als oude minify nog aan staat')` — `FUTUREFLOW_HOME` met bestand `oud` = `slots,minify`, geldige regels in `MINIFY_HOME` → stdout leeg, exitcode 0.
  - `tests/minify-regels-sh.test.mjs`: `test('praat als alleen slots oud is')` — `oud` = `slots` → stdout bevat de regels.
  - `tests/minify.test.ts`: `test('neemt standaard uit het oude bestand over')` — `fs.read` van `/home/t/.claude/minify/standaard` geeft `O1`, store leeg → na `session.start` is het niveau `O1`.
  - `tests/minify.test.ts`: `test('kort niets in als oude minify aan staat')` — `installed_plugins.json` met `minify@futureflowai-mods`; een `tool.call` op Bash met 40.000 tekens uitvoer komt ongewijzigd terug.
- [ ] **Stap 3:** tests draaien → nieuwe tests FAIL.
- [ ] **Stap 4: `minify.tsx` maken**, `regels.sh` aanpassen, `hooks.json` aanvullen, aansluiten in `register.tsx`.
- [ ] **Stap 5: Verifiëren**
  - `node --test futureflow/tests/*.test.mjs` → PASS
  - `claude plugin test futureflow` → PASS
  - `claude plugin validate futureflow` → geen fouten
  - Type-check met een eigen tsconfig die alleen `claude-code` en `claude-code-tools` in `types` noemt (TS2589-valkuil): `npx tsc -p futureflow/tsconfig.check.json --noEmit` → geen fouten
- [ ] **Stap 6: Commit**

```bash
git add futureflow
git commit -m "futureflow: Minify overgenomen uit minify 0.2.1"
```

---

### Taak 5: Live test naast de oude plugins

Geen nieuwe code, tenzij de test iets vindt (dan een fix met test, apart gecommit).

- [ ] **Stap 1: Laden naast de oude plugins**: symlink `futureflow` in `~/.claude/dev-mods/<sessie-id>/` in een nieuwe terminal-sessie, met agent-slots en minify nog geïnstalleerd.
- [ ] **Stap 2: Controleren** (alle vier waar):
  - één toast met de uninstall-tekst uit Taak 2;
  - `cat ~/.claude/futureflow/oud` → `slots,minify`;
  - `npm run dev` wordt één keer ingepakt (`agent-slot status` toont één slot);
  - de minify-regels staan één keer in de context (vraag Claude hoe vaak het "minify -O2"-blok binnenkwam).
- [ ] **Stap 3: Oude plugins uitschakelen** (Colin, of met zijn akkoord): `claude plugin disable agent-slots@futureflowai-mods` en `claude plugin disable minify@futureflowai-mods`; nieuwe sessie.
- [ ] **Stap 4: Controleren**: `oud` is leeg; `/minify` en `/agent-slots` werken en tonen hun panelen; een lange Bash-uitvoer wordt ingekort met de melding van minify; `npm run dev` wordt ingepakt; niveau is gelijk aan het oude standaardniveau.
- [ ] **Stap 5: Hetzelfde in de desktop-app** (Code-tab), stap 2 en 4.
- [ ] **Stap 6:** Bevindingen in `futureflow/docs/` of als fix-commit.

---

### Taak 6: Oude plugins opruimen en documenteren

Pas na een geslaagde Taak 5 en een akkoord van Colin.

**Files:**
- Delete: `agent-slots/`, `minify/` (git rm)
- Modify: `.claude-plugin/marketplace.json` (oude entries weg), `README.md` (tabel: één regel `futureflow`, oude regels weg), `CLAUDE.md` (secties *agent-slots* en *minify* samenvoegen tot sectie *futureflow* met de huidige valkuilen; checklist "Checken vóór commit" en installatieregels bijwerken naar `futureflow/…`), `futureflow/.claude-plugin/plugin.json` (versie `0.2.0`), `futureflow/README.md` (changelog: tellers van minify beginnen opnieuw; commando's `/agent-slots` en `/minify` werken nog)

- [ ] **Stap 1:** `git rm -r agent-slots minify` en de bestanden hierboven bijwerken.
- [ ] **Stap 2: Verifiëren**
  - `grep -rn "agent-slots/\|minify/" CLAUDE.md README.md .claude-plugin/marketplace.json` → alleen verwijzingen naar `futureflow/…` of naar de CLI-state `~/.claude/agent-slots/` en `~/.claude/minify/`
  - `claude plugin validate futureflow` en `claude plugin test futureflow` → PASS
  - `node --test futureflow/tests/*.test.mjs` → PASS
- [ ] **Stap 3: Colin** verwijdert de oude plugins: `claude plugin uninstall agent-slots@futureflowai-mods minify@futureflowai-mods` en installeert `claude plugin install futureflow@futureflowai-mods`.
- [ ] **Stap 4: Commit**

```bash
git add -A agent-slots minify futureflow CLAUDE.md README.md .claude-plugin/marketplace.json
git commit -m "futureflow 0.2.0: vervangt agent-slots en minify"
```
