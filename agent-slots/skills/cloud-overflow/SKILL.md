---
name: cloud-overflow
description: Use when agent-slots refuses a task with "Cloud-overflow staat aan", when the machine is short on memory and a self-contained task (tests, build, refactor, feature) could run in the cloud instead, or when you meet an `overflow/…` branch or a commit with the trailer `Agent-Slots-Overflow` and need to read back, review or merge what a cloud-worker did. Explains how to hand a task to the agent-slots:cloud-worker agent (a remote cloud session), how to talk to it while it runs, and how to bring its work back.
---

# Cloud-overflow: taken uitbesteden aan een cloud-worker

agent-slots houdt bij hoeveel zware dingen er lokaal draaien. Staat **Cloud-overflow** aan (vinkje in `/agent-slots`), dan mag een afgebakende taak naar een cloud-worker: een subagent die als cloud-sessie draait en de computer van de gebruiker niets kost.

## Wanneer wel, wanneer niet

**Wel:** een taak die op zichzelf staat en met een branch klaar is.
- Een testsuite draaien en fouten oplossen.
- Een build of typecheck die lokaal niet past.
- Een refactor, een afgebakende feature, of een onderzoek in de code.

**Niet:**
- Een dev-server of preview bekijken: die hoort lokaal.
- Werk dat lokale dingen nodig heeft: niet-gepushte bestanden buiten de repo, de vault, lokale tools of MCP-servers, secrets uit `.env`.
- Iets waar de gebruiker direct mee verder wil terwijl jij wacht: dan is wachten op een lokaal slot (`agent-slot wait …`) meestal sneller.

## Stap 1: voorleggen en de basis pushen

De cloud ziet alleen wat op GitHub staat. Uitbesteden betekent dus pushen, en dat is een stap naar buiten: **leg het eerst voor aan de gebruiker**, met welke branch je pusht en wat de cloud-worker gaat doen. Ga pas verder na een duidelijk ja.

1. Commit lopend werk op een eigen branch, niet op `main`:
   ```bash
   git switch -c overflow-base/<onderwerp>      # of de huidige feature-branch als die al bestaat
   git add -A && git commit -m "wip: basis voor cloud-overflow <onderwerp>"
   git push -u origin HEAD
   ```
2. Onthoud de naam van die branch: dat is de **basis**.

## Stap 2: de cloud-worker starten

Start het agent-type `agent-slots:cloud-worker` met de Agent-tool. Geef een complete opdracht, want de worker kent dit gesprek niet:

- **Taak:** wat er moet gebeuren en wat "klaar" is (bv. "alle tests in `packages/api` groen").
- **Basis:** de branch uit stap 1.
- **Branch voor het resultaat:** `overflow/<JJJJMMDD>-<onderwerp>` (kort, kebab-case).
- **Context:** relevante bestanden, conventies, wat je al geprobeerd hebt.
- **Grenzen:** wat de worker niet mag aanraken.

Zeg tegen de gebruiker dat de taak in de cloud loopt, en ga lokaal verder met iets anders.

## Stap 3: tussendoor communiceren

- Bijsturen of een vraag stellen: `SendMessage` naar de worker (zijn naam of agent-id uit het starten).
- Het eindantwoord van de worker komt terug als resultaat van de Agent-tool. Dat is een samenvatting; het echte werk staat op de branch.

## Stap 4: het werk terughalen

Een cloud-worker herken je in git altijd aan:
- een branch `overflow/…`;
- commits met de trailer `Agent-Slots-Overflow: cloud-worker`, plus `Overflow-Base: <basis>` en `Overflow-Task: <taak>`;
- een laatste commit waarvan de body het rapport is (gedaan, tests, open punten).

Zo lees je het terug:
```bash
git fetch origin
git log --format='%h %s%n%b' origin/overflow/<naam> --not origin/<basis>
git log --all --grep='^Agent-Slots-Overflow: cloud-worker$' --format='%h %D %s'   # alle overflow-werk vinden (alleen de echte trailer)
git diff origin/<basis>...origin/overflow/<naam>
```

Daarna:
1. Lees het rapport in de laatste commit en controleer de diff zelf; neem de samenvatting van de worker niet blind over.
2. Draai de tests lokaal als er een slot vrij is, of laat ze nog een keer in de cloud draaien.
3. Vertel de gebruiker wat er gedaan is en wat open staat. Mergen of een PR maken doe je pas als de gebruiker dat wil.
4. Opruimen na het mergen (alleen met akkoord): `git push origin --delete overflow/<naam> overflow-base/<onderwerp>`.

## Als het niet lukt

- **Remote agents niet beschikbaar** (account zonder cloud-sessies, geen GitHub-koppeling): meld dat aan de gebruiker en val terug op `agent-slot wait <soort>`.
- **Worker vastgelopen of fout:** lees zijn branch en rapport, stuur bij met `SendMessage`, of doe het lokaal zodra er plek is.
