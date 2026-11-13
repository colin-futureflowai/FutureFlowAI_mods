# futureflow: eigen proxy voor claude-or

Datum: 13-11-2026. Besluit Colin: Claude (abonnement en API-key) blijft rechtstreeks; alleen `claude-or` gaat door een eigen lokale proxy.

## Waarom

De startcheck (0.15.0) meet vooraf of een model cachet. Dat is een steekproef: tijdens een sessie kan een model alsnog niet cachen, en dan betaal je elke beurt de volle context. Claude Code kan zelf niets aan de aanvraag veranderen. Een proxy tussen `claude-or` en OpenRouter kan dat wel, en ziet elke aanvraag (ook van subagents).

## Gemeten op 13-11-2026 (proefscripts niet in de repo, elk één keer)

- `provider` in de body werkt op `/api/v1/messages`. Het antwoord noemt de aanbieder in het veld `provider`. Een onbekende aanbieder met `provider.only` geeft 404.
- `moonshotai/kimi-k3.1-pro` heeft 10+ aanbieders. Los: vandaag 4 van 5 rondes raak, eerder 1 van 5. Vast op één aanbieder (`provider.order` met `allow_fallbacks: false`), bij wafer, deepinfra en river: elke keer 3 van 3 raak (68-75 % uit cache).
- Vast zonder terugval gaf bij river één keer 429. Er is dus een reservelijst nodig.
- `qwen/qwen3.8-max-0902` (alleen Alibaba): markering op het tool_result, op een tekstblok erna, op de tool_use of op het bovenste niveau geeft steeds 0 van 3. Alleen de systeemprompt cachet. Een proxy lost dit niet op; qwen blijft geweigerd.
- Een modelwissel midden in een gesprek werkt (gemini → gpt-6.1-sol, kimi → grok-4.6), met en zonder denkblokken van het eerste model.

Niet gemeten: hoe Claude Code reageert op een aanvraag die de proxy weigert, en of streamen via de proxy merkbare vertraging geeft.

## Grenzen

- Abonnement en Anthropic-API-key gaan nooit door de proxy. `ANTHROPIC_BASE_URL` naar de proxy staat alleen in `~/.claude/futureflow/openrouter/settings.json`, nooit in `~/.claude/settings.json` (les van 0.9.0).
- De proxy luistert alleen op `127.0.0.1`.
- De OpenRouter-key blijft in de sleutelhanger. Claude Code stuurt hem per aanvraag mee (`apiKeyHelper`); de proxy geeft die header door en bewaart, logt of toont hem nooit.
- Het log bevat alleen metadata: geen prompts, geen antwoorden, geen headers.
- Draait de proxy niet en start hij niet, dan start `claude-or` niet.
- Alleen Node-builtins (de bestanden worden los gekopieerd, zoals de CLI van slots).

## Opbouw

| Bestand | Taak |
|---|---|
| `futureflow/lib/proxy.mjs` (+ `.d.mts`) | Pure regels zonder Node-API's: headers, usage uit JSON en SSE, logregel, telling raak/mis, host-check. |
| `futureflow/bridge/or-proxy.mjs` | Het proces: http-server, doorgeven naar OpenRouter, log schrijven, stand bijhouden, zichzelf stoppen. |
| `futureflow/bridge/logboek.html` | Het dashboard: één pagina zonder bibliotheken. |
| `futureflow/cli/api.mjs` | Kopieert de drie bestanden naar `~/.claude/futureflow/openrouter/proxy/`, zet de proxy-URL in het eigen settings-bestand, schrijft de shim. |
| shim `~/.local/bin/claude-or` | Start de proxy als die niet draait, wacht tot hij antwoordt, start dan `claude`. |

Kopie op schijf: `~/.claude/futureflow/openrouter/proxy/bridge/or-proxy.mjs`, `…/proxy/bridge/logboek.html`, `…/proxy/lib/proxy.mjs` (zelfde onderlinge ligging als in de plugin, zodat de import `../lib/proxy.mjs` klopt).

Eén gedeelde proxy voor alle `claude-or`-sessies, op `127.0.0.1:20817`. Sessies onderscheidt hij aan de header `x-session-id` die de shim al zet. Na 30 minuten zonder aanvraag en zonder open verbinding stopt hij.

## Paden van de proxy

- `/_ff/stand` (GET): `{ versie, sinds, poort, sessies }`. Ook de levenscheck van de shim.
- `/_ff/log?na=<ms>&max=<n>` (GET): logregels als JSON-array, nieuwste laatst.
- `/_ff/stop` (POST): stopt de proxy zodra lopende aanvragen klaar zijn. Voor een nieuwe versie.
- `/` (GET): het logboek.
- Al het andere (`/v1/messages`, `/v1/messages/count_tokens`, `/v1/models`, …) gaat ongewijzigd naar `https://openrouter.ai/api` + pad en query.

`/` en `/_ff/*` antwoorden alleen als de header `Host` gelijk is aan `127.0.0.1:<poort>` of `localhost:<poort>` (tegen DNS-rebinding). `/_ff/stop` weigert een aanvraag met een `Origin`-header.

## Fasen

### Fase 1: doorgeven, meelezen, loggen (dit plan)

- Body en antwoord gaan ongewijzigd door. Upstream vraagt de proxy `accept-encoding: identity`, zodat hij de stroom kan meelezen.
- Per aanvraag één regel in `~/.claude/futureflow/openrouter/log.jsonl`:
  `t` (ms), `sessie`, `pad`, `model`, `baan`, `stream`, `status`, `aanbieder`, `in`, `uit`, `read`, `write`, `aandeel` (% uit cache), `telling` (`raak` | `mis` | `telt-niet`), `ms`, en alleen bij een fout `fout` (het fouttype, hoogstens 200 tekens). `kosten` alleen als de usage van OpenRouter een getal `cost` bevat.
- `baan`: 8 hex-tekens, hash van de systeemprompt (eerste 2000 tekens) en de namen van de tools. Zo houdt de telling hoofdlus, subagents en losse hulpaanvragen uit elkaar zonder inhoud te bewaren.
- Telling: een aanvraag is `telt-niet` als de status geen 2xx is, als er in dezelfde sessie, model en baan geen eerdere 2xx was, als die langer dan 5 minuten geleden is, als de invoer onder 1024 tokens blijft, of als de invoer minder dan de helft is van de vorige (compact). Anders `raak` bij ≥ 50 % uit cache, en `mis` daaronder.
- Het log roteert op 10 MB naar `log.1.jsonl` (één generatie).
- Bereikt de proxy OpenRouter niet, dan antwoordt hij 502 met een fout in Anthropic-vorm.

### Fase 1b: logboek (dit plan)

- Pagina op `http://127.0.0.1:20817/`: tabel met de laatste aanvragen, samenvatting per sessie en model (aanvragen, raak, mis, % uit cache, aanbieder), filter op sessie en model, ververst elke 3 s.
- In `/futureflow`, tab 2 Wisselen, OpenRouter-kaart onder Meer: knop `or-logboek` die de pagina opent (`/usr/bin/open`); zonder terminal een toast met het adres.
- Inhoud van aanvragen bekijken zit er niet in. Later, standaard uit, met een schakelaar per sessie.

### Fase 2: vaste aanbieder en harde stop (plan 9, 0.17.0)

Live gemeten bij de test van fase 1 (13-11-2026): OpenRouter stuurt `provider` ook in een gestreamd antwoord mee, en de aanbieder wisselde weer (Sail Research, eerder River en Wafer).

- **Vaste aanbieder.** Per sessie en model houdt de proxy één aanbieder vast en zet `provider: { order: [<aanbieder>], allow_fallbacks: false }` in de body. Voor een nieuwe sessie kiest hij de aanbieder die voor dit model eerder het vaakst raak was (`aanbieders.json`); is er geen, dan gaat de eerste aanvraag los en wordt de aanbieder uit het antwoord de vaste. Een aanvraag die zelf al `provider` bevat, blijft ongewijzigd.
- **Terugval.** 429, 5xx of 404 van de vaste aanbieder, vóór de eerste byte naar de client: één keer opnieuw met de volgende bekende goede aanbieder, anders los zonder de slechte (`provider.ignore`). Dat kost één koude aanvraag.
- **Telling.** Een aanvraag bij een andere aanbieder dan de vorige in dezelfde baan is `telt-niet` als de proxy zelf wisselde (de cache is daar koud).
- **Harde stop.** Twee keer `mis` achter elkaar in één baan: de aanbieder is 24 uur `slecht` voor dit model en de proxy wisselt. Komt er daarna in die sessie weer twee keer `mis`, dan schrijft de proxy het model als `zwak` in `cache.json`, werkt de startcheck bij en weigert elke volgende aanvraag voor dat model met een leesbare fout. In het ergste geval zijn dat vijf dure beurten (twee, één koude, twee).
- **Eén bron.** De proxy weigert een model precies dan als `cache.json` het `zwak` noemt. Een nieuwe meting (`cachetest`) die niet `zwak` is, heft dat op.
- `/api/hello` (controle van Claude Code zelf) komt niet meer in het log.

### Fase 3: modellen kiezen en wisselen op de proxy-pagina (plan 9, 0.17.0)

- De pagina krijgt twee tabs: **Modellen** en **Logboek**.
- **Modellen** toont Model 1-5 met het gekozen id, de uitleg per rij, de laatste cache-meting en per model de aanbieders met raak/mis. Per rij een knop Kies die een zoekbare modellenlijst opent (naam, context, prijs per Mtok, meting, waarschuwingen "te klein voor Claude Code" en "cachet niet").
- Kiezen van een gemeten model dat niet `zwak` is: direct. Een ongemeten model: knop "Meet en kies (~35-60k tokens)"; de meting loopt via de CLI en pas na een goede uitslag wordt het model gekozen. Een `zwak` model is niet te kiezen.
- De pagina schrijft niets zelf: de proxy roept de CLI aan (`openrouter modellen`, `openrouter cachetest`, `modus openrouter`). De startcheck blijft dus gelden. De key komt nooit op de pagina; een key bewaren blijft in `/futureflow`.
- **Wisselen in een lopende sessie.** De CLI houdt per rij bij welke modellen er stonden (`rijen.json`). Stuurt een lopende sessie een model dat niet meer gekozen is maar eerder in rij N stond, dan vervangt de proxy het door het huidige model van rij N. Een wissel geldt dus voor alle lopende `claude-or`-sessies; de eerste beurt daarna is zonder cache. De pagina waarschuwt als het nieuwe model een kleiner contextvenster heeft.
- Het eigen settings-bestand is de bron voor Model 1-5. De mod leest de keuze daaruit terug (`status`), zodat `/futureflow` en de pagina hetzelfde tonen.
- Schrijvende paden (`POST /_ff/…`) eisen een geldige `Host`, de header `x-ff: 1`, `content-type: application/json`, en een `Origin` die ontbreekt of het eigen adres is.

### Fase 4: lokale modellen

Vertaler tussen het Anthropic-formaat en het OpenAI-formaat (berichten, tools, streaming) voor Ollama en LM Studio.

## Overgang van 0.15

- `orInstellingen` zet `ANTHROPIC_BASE_URL` op `http://127.0.0.1:20817`.
- `openrouter poort` (draait bij elke `session.start` met een gekozen Model 1) kopieert de proxybestanden, herschrijft de shim en vervangt in een bestaand eigen settings-bestand alleen een `ANTHROPIC_BASE_URL` die exact de oude OpenRouter-URL is. Een nieuwe `claude-or` gaat daarna vanzelf door de proxy.
- Draait er een proxy met een andere `versie`, dan stuurt de CLI `POST /_ff/stop`; de shim start bij de volgende `claude-or` de nieuwe.
- Het opruimen van oude regels in `~/.claude/settings.json` (van vóór 0.9) blijft de oude OpenRouter-URL herkennen.

## Open punten

- Fase 1 is op 13-11-2026 live getest met één `claude-or -p`: de shim startte de proxy, het antwoord kwam door, en de logregel had model, aanbieder en tokens.
- Hoe Claude Code een geweigerde aanvraag toont, wordt in plan 9 gemeten tegen een nep-upstream.
- Kosten per aanvraag alleen als OpenRouter `cost` in de usage meegeeft.
