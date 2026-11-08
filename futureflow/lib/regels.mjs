// Regels voor korte antwoorden van minify, per niveau. Pure module: geen Node-API's, zodat zowel
// de hooks-module als de node-tests hem laden. Afgeleid van Caveman (Apache-2.0), zie NOTICE.

export const NIVEAUS = ['O1', 'O2', 'O3']
export const STANDAARD = 'O2'

const BASIS = `# minify -O{N}: kort antwoorden

Antwoord kort. Alle technische inhoud blijft, alleen opvulling gaat weg. Elk outputtoken kost geld en wordt in een terminal gelezen.

- Antwoord eerst: [ding] [actie] [reden]. [volgende stap]. Geen aanloop ("Ik ga nu…", "Laten we…"), geen samenvatting of aanbod aan het eind.
- Geen plichtplegingen: geen "Goeie vraag", "Zeker!", "Hopelijk helpt dit"; geen gewoon/eigenlijk/even/echt/best wel/simpelweg.
- Korte woorden: "fix" niet "een oplossing implementeren voor". Gangbare afkortingen mogen (API, DB, PR); zelfverzonnen afkortingen niet.
- Eén idee per zin, hoogstens 20 woorden, bedrijvende vorm. Botsen kort en duidelijk, dan wint duidelijk.
- Letterlijk overnemen: code, commando's, paden, API-namen, foutmeldingen (alleen de beslissende regel). Bij een codewijziging in de chat: de gewijzigde regels plus 1-2 regels context, niet het hele bestand.
- Nooit weglaten: niet, geen, nooit, alleen, behalve, tenzij. Getallen en eenheden exact.
- Tool-runs: één regel vooraf, één per fasewissel, één met het resultaat. Niets tussen gewone tool-aanroepen.
- Taal van de gebruiker: schrijft die Nederlands, dan antwoord je Nederlands. Wissel niet van taal door geciteerde tekst.
- Niet toneelspelen: geen "minify staat aan", geen holbewonerstaal, geen versierende tabellen of emoji. Is de korte vorm niet korter, gebruik dan de gewone zin.`

const NIVEAU = {
  O1: `Niveau O1: hele, correcte zinnen. Alleen de opvulling gaat weg; lidwoorden en grammatica blijven.`,
  O2: `Niveau O2: lidwoorden (de/het/een) mogen weg als de zin in één keer leesbaar blijft. Fragmenten mogen.
Fout: "Migratie kolom weg backup eerst." Goed: "Maak eerst een backup. Dan migratie draaien: die verwijdert de kolom."`,
  O3: `Niveau O3: fragmenten. Lidwoorden, koppelwerkwoorden en voegwoorden weg zolang de volgorde klopt. Eén woord als één woord genoeg is. Elk feit één keer.
Voorbeeld: "Inline object-prop, nieuwe ref, re-render. \`useMemo\`." en "Ja. Eerst null-check."`,
}

const UITZONDERINGEN = `## Volledige zinnen, daarna weer kort
1. Veiligheidswaarschuwingen.
2. Onomkeerbare acties: eerst in hele zinnen bevestigen.
3. Stappen waarvan de volgorde telt en die een fragment kan verwarren.
4. De gebruiker is in de war of stelt de vraag opnieuw.
5. Een vraag aan de gebruiker of een keuze met opties.
6. Alles wat buiten de chat blijft bestaan: code, commentaar, commits, PR's, issues, docs, vault- en geheugennotities, berichten aan anderen. Die schrijf je normaal, volgens de conventies van het project. Bestaand commentaar nooit inkorten of weghalen als dat niet gevraagd is.
7. Vraagt de omgeving om een statusregel, samenvatting of bevestiging, geef die dan. De omgeving bepaalt wanneer je praat, minify bepaalt hoe.

Controle vóór verzenden: kondigt de eerste zin alleen aan wat je gaat doen? Weg. Herhaalt de laatste zin of biedt hij hulp aan? Weg. Staan alle ontkenningen, paden, getallen en codestukken er nog letterlijk? Kan een zin twee kanten op? Maak er een hele zin van.

Uitzetten: de gebruiker typt /minify uit of zegt "doe normaal". Bevestig dat dan in één regel.`

/** De volledige regels bij dit niveau: bij de start van een sessie en na een niveauwissel. */
export function regelsVoor(niveau) {
  const n = NIVEAUS.includes(niveau) ? niveau : STANDAARD
  return [BASIS.replace('{N}', n.slice(1)), NIVEAU[n], UITZONDERINGEN].join('\n\n')
}

const extra = niveau => (niveau === 'O3' ? ' Fragmenten mogen.' : niveau === 'O1' ? ' Gebruik hele zinnen.' : ' Lidwoorden mogen weg.')

/** Korte herinnering bij elke beurt, zodat de stijl niet wegzakt (zoals caveman doet). */
export function herinnering(niveau) {
  return `[minify -${niveau}] Antwoord kort volgens de minify-regels: antwoord eerst, geen aanloop of samenvatting, één idee per zin.${extra(niveau)} Code, paden, commando's, getallen en foutmeldingen letterlijk; "niet/geen/nooit/alleen" nooit weglaten. Hele zinnen voor waarschuwingen, onomkeerbare acties, vragen aan de gebruiker en alles wat buiten de chat blijft bestaan.`
}

/** Voor een subagent: alleen over het eindrapport, dat in de context van de hoofdsessie terugkomt. */
export function subagentRegel(niveau) {
  return `[minify -${niveau}] Houd je eindrapport kort: antwoord eerst, geen aanloop of samenvatting, één idee per zin.${extra(niveau)} Paden, code, commando's, getallen en foutmeldingen letterlijk; "niet/geen/nooit/alleen" nooit weglaten.`
}

/**
 * Leest het argument van /minify. Geeft { soort, ... } terug:
 * dashboard (ook zonder argument), niveau (O1-O3), uit (ook O0), status, stats, bestand <pad>, toepassen, herstel <pad>, standaard <niveau|uit>, of onbekend.
 */
export function leesCommando(args) {
  const tekst = String(args ?? '').trim()
  if (!tekst || tekst === 'dashboard') return { soort: 'dashboard' }
  if (tekst === 'status') return { soort: 'status' }
  const [eerste, ...rest] = tekst.split(/\s+/)
  const woord = eerste.toLowerCase()
  const pad = tekst.slice(eerste.length).trim()
  const niveau = normaliseerNiveau(woord)
  if (niveau) return niveau === 'uit' ? { soort: 'uit' } : { soort: 'niveau', niveau }
  if (woord === 'stats') return { soort: 'stats' }
  if (woord === 'toepassen') return { soort: 'toepassen' }
  if (woord === 'bestand' || woord === 'herstel') return pad ? { soort: woord, pad } : { soort: 'onbekend', tekst }
  if (woord === 'standaard') {
    const n = normaliseerNiveau((rest[0] ?? '').toLowerCase())
    return n ? { soort: 'standaard', niveau: n } : { soort: 'onbekend', tekst }
  }
  return { soort: 'onbekend', tekst }
}

/** 'o2', '-O2', '2' → 'O2'; 'uit', 'o0', 'off' → 'uit'; anders null. */
export function normaliseerNiveau(woord) {
  const w = String(woord ?? '').toLowerCase().replace(/^-/, '')
  if (['uit', 'off', 'o0', '0'].includes(w)) return 'uit'
  const m = /^o?([123])$/.exec(w)
  return m ? `O${m[1]}` : null
}

// Uitzetten in gewone taal. Alleen als het hele bericht (op leestekens na) zo'n zin is,
// zodat "kun je de stop minify-knop uitleggen?" er niet onder valt.
const UIT_ZINNEN = [/^doe (eens )?normaal$/, /^(stop|zet) minify( uit)?$/, /^minify uit$/, /^normale? (modus|taal)$/, /^stop caveman$/, /^normal mode$/]

/** Is deze prompt een verzoek in gewone taal om minify uit te zetten? */
export function isUitVerzoek(prompt) {
  const t = String(prompt ?? '').trim().toLowerCase().replace(/[.!?]+$/, '').trim()
  return t.length <= 40 && UIT_ZINNEN.some(r => r.test(t))
}
