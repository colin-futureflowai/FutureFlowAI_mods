# minify — ontwerp v1

Doel: Claude Code minder tokens laten verbruiken, zowel in wat hij zegt als in wat hij leest, zonder dat de inhoud slechter wordt. Net als een minifier voor code: het gedrag blijft gelijk, alleen de overbodige tekens gaan eruit. Hoe ver hij gaat, bepaalt het optimalisatieniveau, zoals bij een compiler (`-O1` t/m `-O3`). Standaard staat hij aan.

Gebaseerd op [Caveman](https://github.com/JuliusBrussee/caveman) van Julius Brussee (Apache-2.0, commit `9b68f7e`, 25-10-2026). De regels zijn vertaald en aangepast. "Caveman" is een merk, dus we gebruiken die naam niet als productnaam. In `NOTICE` en de README staat de naamsvermelding, en `LICENSE` is de Apache-tekst.

## Wat we wel en niet overnemen

| Caveman-onderdeel | Hier | Waarom |
| --- | --- | --- |
| Korte antwoorden (`/caveman`, `/ultracave`) | **Ja**, als niveaus `O1`, `O2` en `O3` | Kernfunctie |
| `/megacave` (Klassiek Chinees) | Nee | Werkt niet voor Nederlands en levert geen leesbare tekst op |
| Read less (tooluitvoer inkorten) | **Ja**, alleen Bash-uitvoer | Volgens hun eigen meting de grootste winst: 33% minder input per sessie |
| `/caveman-compress` | **Ja**, als `/minify bestand <pad>` | Kleinere CLAUDE.md betekent minder input bij elke beurt |
| `/caveman-stats` | **Ja**, als statusregel plus `/minify stats` | Laat zien of het echt iets oplevert |
| Subagents ook kort | **Ja** | Hun antwoorden komen terug in de context van de hoofdsessie |
| `/caveman-review` | Later, als skill | Handig, maar een losse functie |
| `/caveman-commit` | Nee | Onze regel is: commits en alles wat buiten de chat blijft bestaan, in normale taal |
| Proxy (Caveman Gateway) | Nee | De hooks in de mod zien dezelfde tooluitvoer al voordat die naar het model gaat. Een proxy zou al het API-verkeer, met sleutels of abonnementslogin, door een extra lokaal proces sturen. Dat is meer risico en onderhoud voor weinig extra winst. Alleen zinvol voor andere agents (Codex e.d.), en die vallen buiten deze mod |
| Browse (webpagina's comprimeren) | **Deels**: grote resultaten van MCP-tools (Playwright-snapshots) gaan door dezelfde inkorting als Bash, met het origineel op schijf. `WebFetch` niet: die laat de pagina al door een klein model samenvatten | Dit is het grootste deel van wat de proxy oplevert, zonder proxy |
| Auto (model-routing), Blocks, Cloud, middleware | Nee | Daarvoor is een account bij Caveman nodig, en ze sturen data naar derden |

## Niveaus

Commando: `/minify [O1|O2|O3|uit|status|stats|standaard <niveau|uit>|bestand <pad>|toepassen|herstel <pad>]`. Zonder argument toont hij de status.

| Niveau | Caveman | Stijl | Voorbeeld |
| --- | --- | --- | --- |
| `O1` | (lite) | Hele zinnen, alleen opvulling weg | "Het object krijgt bij elke render een nieuwe referentie, dus React rendert opnieuw. Gebruik `useMemo`." |
| `O2` **(standaard)** | `caveman` | Antwoord eerst, lidwoorden mogen weg, één idee per zin | "Nieuwe objectreferentie per render, dus React rendert opnieuw. Wikkel de prop in `useMemo`." |
| `O3` | `ultracave` | Fragmenten, elk feit één keer | "Inline object, nieuwe ref, re-render. `useMemo`." |

`O0` is een alias voor `uit`. Het niveau geldt per sessie (`$.state`). De standaard voor nieuwe sessies staat in `$.store` en zet je met `/minify standaard O1`. Uitzetten kan ook in gewone taal ("doe normaal", "stop minify"), net als bij caveman.

## Regels (Nederlands)

Afgeleid van `skills/caveman/SKILL.md` en vertaald naar het Nederlands:

1. **Antwoord eerst.** Patroon: `[ding] [actie] [reden]. [volgende stap].` Geen aanloop, geen "Ik ga nu…", geen samenvatting aan het eind.
2. **Geen plichtplegingen.** Geen "Goeie vraag", "Zeker!", "Hopelijk helpt dit", en geen gewoon/eigenlijk/even/echt/best wel.
3. **Korte woorden.** "fix" in plaats van "een oplossing implementeren voor". Geen zelfverzonnen afkortingen.
4. **Lidwoorden mogen weg** (de/het/een), **betekenis nooit.** *Niet, geen, nooit, alleen, behalve* blijven altijd staan. Getallen en eenheden blijven exact.
5. **Eén idee per zin**, maximaal 20 woorden, bedrijvende vorm. Als duidelijkheid en compressie botsen, wint duidelijkheid.
6. **De inhoud zelf blijft letterlijk**: code, commando's, paden, foutmeldingen, API-namen.
7. **Tool-runs**: één regel vooraf, één regel per fasewissel en één met het resultaat. Niets tussendoor.
8. **De taal van de gebruiker**: schrijf Nederlands als de gebruiker Nederlands schrijft. Wissel niet van taal door geciteerde Engelse tekst.
9. **Niet toneelspelen.** Geen "minify aan", geen holbewonerstaal. Is een fragment niet korter dan een gewone zin, gebruik dan de zin.

**Volledige zinnen, daarna gaat minify weer aan:** veiligheidswaarschuwingen, onomkeerbare acties (eerst bevestigen), stappen waarvan de volgorde belangrijk is, een gebruiker die in de war is, vragen aan de gebruiker, en **alles wat buiten de chat blijft bestaan** (code, commentaar, commits, PR's, docs, vault-notities, berichten aan derden).

De volledige regels kosten zo'n 1.000 tokens, één keer per sessie (en na een niveauwissel); de herinnering ~80 tokens per beurt. Alles blijft in de gesprekshistorie en wordt dus gecachet.

## Onderdelen van de mod

1. **Korte antwoorden — command hooks, zoals caveman.** Eerst geprobeerd via de mod-hooks `prompt.compose` en `prompt.section`, maar de ingebouwde plugin `cc-plugin-sec-default` (prepend-laag, naam begint met het gereserveerde `cc-plugin-`, dus niet door een beheerder ingesteld) slaat die hooks van zelf geïnstalleerde plugins altijd over (live test 29-10-2026: 0× gedraaid). Daarom nu de gewone command hooks in `hooks/hooks.json`, naast de module:
   - `SessionStart` → `bin/regels.sh start`: de volledige regels van het niveau.
   - `UserPromptSubmit` → `bin/regels.sh prompt`: elke beurt een korte herinnering (~80 tokens), na een niveauwissel de volledige regels opnieuw.
   - `SubagentStart` → `bin/regels.sh subagent`: één regel over een kort eindrapport (JSON `additionalContext`).
   - Het script is gewone `sh` (kaal PATH van de desktop-app). De mod schrijft de teksten bij elke start naar `~/.claude/minify/regels/` (uit `lib/regels.mjs`, de enige bron) en per sessie het niveau naar `~/.claude/minify/niveau/<sessie>`; het script schrijft in `gemeld/<sessie>` welk niveau het laatst volledig meeging. Geen niveaubestand: `standaard`, anders O2.
   - De regels komen zo als context in het gesprek, niet in de systeemprompt. Iets zwakker, daarom de herinnering bij elke beurt.
2. **Tooluitvoer inkorten — `tool.call` op Bash en `mcp__*`.** Na `next(e)`: is de uitvoer langer dan de drempel (Bash-stdout 6.000, stderr 3.000, MCP 8.000 tekens), dan:
   - wordt de volledige uitvoer bewaard in `~/.claude/minify/uitvoer/<sessie>/<n>.txt`;
   - gaat er een ingekorte versie naar het model: ANSI-codes weg, herhaalde regels samengevoegd ("… 214× dezelfde regel"), begin en eind, en alle regels met fouttermen (`error`, `FAIL`, `Traceback`, `panic`, …), plus "Volledige uitvoer: `<pad>`". Daarmee kan Claude het origineel altijd zelf lezen;
   - geen LLM-aanroep: alles gebeurt deterministisch in pure `lib/uitvoer.mjs`, met tests.
   - **Niet** voor `Read`, `Edit` en `Grep`. Claude heeft daar exacte tekst nodig om te bewerken. Ook niet voor achtergrondtaken en afbeeldingen.
   - Een mislukt commando (`isError`): een hook kan geen foutresultaat teruggeven (core valideert het als gewoon resultaat en de uitvoer raakte zo kwijt in de live test). De ingekorte fouttekst gaat daarom als `deny` ná uitvoering, met de zin dat het commando wél draaide.
   - Uitvoer boven ~30 KB schrijft Claude Code zelf weg (`persistedOutputPath`) en het model ziet dan alleen de eerste 2 KB, dus geen fouten aan het eind. minify leest dat bestand en kort het hele ding in (live: 45.806 → 157 tekens, met de FAIL-regel).
   - Grote JSON wordt een skelet (sleutels, typen, lengtes van lijsten, 3 lagen diep). Levert inkorten minder dan 10% op, dan blijft het origineel.
3. **Bestanden minifyen — `/minify bestand <pad>`.** Comprimeert een geheugenbestand (`CLAUDE.md`, todo's) met `$.model.complete` (Haiku), volgens de regels van caveman-compress: codeblokken, inline code, paden, URL's, koppen en frontmatter blijven exact. Daarna volgt een validatie in `lib/` die controleert of alle koppen, codeblokken en URL's er nog zijn; zo niet, dan wordt er niets overschreven. Een backup komt buiten de repo in `~/.claude/minify/backups/`, en `/minify herstel <pad>` zet het origineel terug.
   - Alleen `.md` en `.txt`. Bestandsnamen die op geheimen lijken worden geweigerd, net als bij caveman.
   - **Niet** voor vault-notities. Die schrijf je voor mensen in Obsidian, en volgens de vault-regels blijven ze leesbaar.
   - `/minify bestand` maakt alleen een voorstel (diff en aantal tokens, ook in `~/.claude/minify/voorstel/`). Pas `/minify toepassen` schrijft, en alleen als het bestand intussen niet veranderd is. Het bestand gaat naar de modelprovider.
4. **Meten — `turn.complete`.** Telt per beurt de `usage` (output-tokens, input, cache) en bewaart per sessie het totaal plus het niveau in `$.store`. Daarnaast wordt per sessie bijgehouden hoeveel tekens de tooluitvoer-inkorting heeft gescheeld.
   - Statusregel (`$.ui.status`): `minify -O2 · ⌀ 340 uit/beurt · −48k tekens gelezen`.
   - `/minify stats`: gemiddelde output-tokens per beurt per niveau, over je eigen sessies. Dat is een eerlijke vergelijking met de beurten met minify uit, maar geen A/B-test. Dat staat er ook bij.
5. **Fail-open**, net als agent-slots: bij een fout in de mod gaat alles gewoon door, met één toast per sessie en een regel in `~/.claude/minify-mod.log`.

## Wat het oplevert (verwachting)

Eerlijk volgens de eigen metingen van caveman: ten opzichte van "antwoord beknopt" leveren korte antwoorden 3% (`O2`) tot 35% (`O3`) minder output-tokens op. JetBrains mat 8,5% minder output, zonder kwaliteitsverlies. De grootste winst zit in **inkorten wat Claude leest** (tooluitvoer, CLAUDE.md), omdat input in Claude Code-sessies het grootste deel van de kosten is.

## Open punten

- `cc-plugin-sec-default` slaat ook hooks van voice-chat (`prompt.compose`, `classic.PermissionRequest`) en agent-slots (`tool.check`) over. Dat raakt die mods ook; apart bekijken.
- Samenspel met voice-chat: de voorleesmodus kort zelf al in. Ze stapelen; een korter antwoord is goed om voor te lezen.
- Drempels en fouttermen afstemmen op echte uitvoer (pnpm test, next build, git log) na een week gebruik.
