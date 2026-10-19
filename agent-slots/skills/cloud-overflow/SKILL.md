---
name: cloud-overflow
description: Use when agent-slots refuses a task with "Cloud-overflow staat aan", when the machine is short on memory and a self-contained task (tests, build, refactor, feature) could run in the cloud instead, when a message "[agent-slots] Cloud-worker klaar" arrives, or when you meet an `overflow/…` branch or a commit with the trailer `Agent-Slots-Overflow: cloud-worker` and need to read back, review or merge what a cloud-worker did. Explains how to start a real Claude Code cloud session for the task, how agent-slots reports its result back to you, and how to bring the work back.
---

# Cloud-overflow: taken uitbesteden aan een cloud-worker

agent-slots houdt bij hoeveel zware dingen er lokaal draaien. Staat **Cloud-overflow** aan (vinkje in `/agent-slots`), dan mag een afgebakende taak naar een **cloud-worker**: een Claude Code-sessie in de cloud die de computer van de gebruiker niets kost.

Een cloud-sessie kan niet terugpraten. Het terugkanaal is git: de worker pusht naar `overflow/…` en sluit af met een rapportcommit. agent-slots kijkt elke minuut op GitHub en zet het rapport als bericht `[agent-slots] Cloud-worker klaar: …` in **jouw** sessie, de sessie die de taak startte.

De CLI heet hieronder `agent-slot`. Staat die niet op het PATH, gebruik dan `node ~/.claude/agent-slots/bin/agent-slot.mjs`.

## Wanneer wel, wanneer niet

**Wel:** een taak die op zichzelf staat en met een branch klaar is.
- Een testsuite draaien en fouten oplossen.
- Een build of typecheck die lokaal niet past.
- Een refactor, een afgebakende feature, of een onderzoek in de code.

**Niet:**
- Een dev-server of preview bekijken: die hoort lokaal.
- Werk dat lokale dingen nodig heeft: niet-gepushte bestanden buiten de repo, de vault, lokale tools of MCP-servers, secrets uit `.env`.
- Iets waar de gebruiker direct mee verder wil terwijl jij wacht: dan is `agent-slot wait <soort>` meestal sneller.

## Stap 1: voorleggen en de basis pushen

De cloud ziet alleen wat op GitHub staat. Uitbesteden betekent pushen en een cloud-sessie starten die meetelt in het abonnement: **leg het eerst voor aan de gebruiker**, met de taak, de basis-branch en de branch die de worker oplevert. Ga pas verder na een duidelijk ja.

Commit lopend werk op een eigen branch (niet `main`) en push die; dat is de **basis**:
```bash
git switch -c overflow-base/<onderwerp>
git add -A && git commit -m "wip: basis voor cloud-overflow <onderwerp>"
git push -u origin HEAD
```
Is alles wat de worker nodig heeft al gepusht (bv. `main`), dan is die branch de basis en hoef je niets te pushen.

## Stap 2: de opdracht maken

Laat de CLI de volledige opdracht maken, zodat de werkwijze en git-conventies altijd gelijk zijn:
```bash
agent-slot overflow brief --task "<wat er moet gebeuren en wat klaar is>" --base <basis> --branch overflow/<JJJJMMDD>-<onderwerp>
```
Schrijf de taak compleet: de worker kent dit gesprek niet. Noem relevante bestanden, wat je al geprobeerd hebt, en wat hij niet mag aanraken.

## Stap 3: de cloud-sessie starten (kies de eerste die kan)

1. **In de Claude-desktop-app:** start een nieuwe sessie met `target: "cloud"` via de sessie-tool van de app (`start_session`), met de uitvoer van stap 2 als opdracht. Dit draait echt in de cloud. De sessie begint op de standaardbranch van de repo; de opdracht laat de worker zelf naar `origin/<basis>` gaan.
2. **In een terminal:** `claude --cloud` werkt alleen in een interactieve terminal, niet vanuit jouw Bash-tool. Geef de gebruiker dit commando om zelf te draaien, vanuit de repo op de basis-branch:
   ```bash
   claude --cloud "$(agent-slot overflow brief --task "<taak>" --base <basis> --branch overflow/<naam>)"
   ```
3. **Laatste redmiddel: het agent-type `agent-slots:cloud-worker`** via de Agent-tool. Dat vraagt om een cloud-sessie, maar valt stil terug op lokaal draaien als cloud-agents niet beschikbaar zijn. Controleer daarom na afloop of het rapport `Linux` noemt of een lokaal pad; draaide hij lokaal, zeg dat dan eerlijk tegen de gebruiker.

## Stap 4: de taak vastleggen

Leg direct na het starten vast welke branch je verwacht, met de id van deze sessie:
```bash
agent-slot overflow add --branch overflow/<naam> --base <basis> --task "<taak in één regel>" --session <deze sessie-id>
```
Zonder `--session` gebruikt de CLI `$CLAUDE_SESSION_ID`. Daarna meldt agent-slots het rapport vanzelf; het dashboard (`/agent-slots`) toont de taak onder **Cloud-workers**. Zeg tegen de gebruiker dat de taak in de cloud loopt, en ga lokaal verder met iets anders.

Bijsturen terwijl hij loopt: een bericht sturen naar de cloud-sessie (in de app met `SendMessage` naar zijn sessie, in een terminal met `claude -p "<bericht>" --cloud <sessie-id>`). Antwoord komt niet terug in het gesprek, alleen via zijn branch en rapport.

## Stap 5: het rapport verwerken

Komt `[agent-slots] Cloud-worker klaar: overflow/<naam> …` binnen, of vind je zelf overflow-werk:
- branch `overflow/…`;
- commits met de trailer `Agent-Slots-Overflow: cloud-worker`, plus `Overflow-Base` en `Overflow-Task`;
- een laatste commit `overflow: rapport …` met Gedaan / Tests / Open.

```bash
git fetch origin
git log --format='%h %s%n%b' origin/overflow/<naam> --not origin/<basis>
git log --all --grep='^Agent-Slots-Overflow: cloud-worker$' --format='%h %D %s'   # alle overflow-werk
git diff origin/<basis>...origin/overflow/<naam>
```

1. Lees de diff zelf; neem het rapport van de worker niet blind over.
2. Draai de tests lokaal als er een slot vrij is.
3. Vertel de gebruiker wat er gedaan is en wat open staat. Mergen of een PR maken pas na akkoord.
4. Opruimen na het mergen (alleen met akkoord): `git push origin --delete overflow/<naam> overflow-base/<onderwerp>` en `agent-slot overflow remove <id>`.

## Als het niet lukt

- **Geen cloud-sessies beschikbaar** (geen Pro/Max/Team, geen GitHub-koppeling): meld dat aan de gebruiker en val terug op `agent-slot wait <soort>`.
- **Geen rapport na lange tijd:** `agent-slot overflow list` toont de laatste commit op de branch (`progress`) of een fout. Kijk in de cloud-sessie op claude.ai/code, of stuur een bericht.
