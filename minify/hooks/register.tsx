import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { MinifyNiveau, MinifyTeller } from '../types'

import { herinnering, isUitVerzoek, leesCommando, NIVEAUS, regelsVoor, STANDAARD, subagentRegel } from '../lib/regels.mjs'
import { inkorten, voetregel } from '../lib/uitvoer.mjs'
import { controleer, diff, opdracht, tokens, uitAntwoord, weigerReden } from '../lib/bestand.mjs'

const MODEL_BESTAND = 'claude-haiku-5-5'

const niveauAtom = atom({ plugin: 'minify', key: 'niveau' } as const, null as MinifyNiveau | null)
const tellerAtom = atom({ plugin: 'minify', key: 'teller' } as const, null as MinifyTeller | null)
const LEGE_TELLER: MinifyTeller = { beurten: 0, output: 0, ingekort: 0, uitvoerVoor: 0, uitvoerNa: 0 }

// Per niveau over alle sessies heen, voor /minify stats.
type PerNiveau = Record<string, { beurten: number; output: number }>

// ---------- hulpjes ----------

async function thuis($: Engine) {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
}

async function map($: Engine) {
  return `${await thuis($)}/.claude/minify`
}

// Eigen log van de mod; een fout laat alles door (fail-open) met één toast per sessie.
const notes: string[] = []
async function note($: Engine, text: string) {
  notes.push(`${new Date().toISOString()} ${text}`)
  const home = await thuis($)
  if (home) await $.fs.write(`${home}/.claude/minify-mod.log`, notes.slice(-50).join('\n') + '\n').catch(() => undefined)
}

let warned = false
function warn($: Engine, err: unknown) {
  const text = err instanceof Error ? err.message : String(err)
  void note($, `fout: ${text}`)
  if (warned) return
  warned = true
  $.ui.toast(`minify werkt niet (alles gaat door): ${text}`)
}

const failOpen = ($: Engine, e: any, next: any) => {
  if (next.error.kind !== 're-entry') warn($, next.error.message ?? next.error.kind)
  return next(e)
}

async function standaard($: Engine): Promise<MinifyNiveau> {
  const s = await $.store.get('standaard')
  return s === 'O1' || s === 'O2' || s === 'O3' || s === 'uit' ? s : STANDAARD
}

// Het niveau van deze sessie; de eerste keer de standaard uit $.store.
async function niveau($: Engine): Promise<MinifyNiveau> {
  const n = await read($, niveauAtom)
  if (n) return n
  const s = await standaard($)
  await update($, niveauAtom, () => s)
  await schrijfNiveau($, s)
  return s
}

// De korte antwoorden gaan via command hooks (bin/regels.sh), zoals bij caveman: de hooks
// prompt.compose en prompt.section van mods slaat cc-plugin-sec-default over. Het script leest
// het niveau per sessie en de teksten uit deze bestanden.
async function schrijfNiveau($: Engine, n: MinifyNiveau) {
  await $.fs.write(`${await map($)}/niveau/${await $.session.id()}`, n)
}

async function schrijfRegels($: Engine) {
  const m = await map($)
  for (const n of NIVEAUS) {
    await $.fs.write(`${m}/regels/${n}.md`, regelsVoor(n) + '\n')
    await $.fs.write(`${m}/regels/${n}.kort.md`, herinnering(n) + '\n')
    await $.fs.write(`${m}/regels/${n}.subagent.md`, subagentRegel(n) + '\n')
  }
  await $.fs.write(`${m}/standaard`, await standaard($))
}

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n))

async function toonStatus($: Engine) {
  const n = await niveau($)
  if (n === 'uit') return $.ui.status('minify uit')
  const t = (await read($, tellerAtom)) ?? LEGE_TELLER
  const delen = [`minify -${n}`]
  if (t.beurten) delen.push(`⌀ ${k(Math.round(t.output / t.beurten))} uit/beurt`)
  if (t.ingekort) delen.push(`−${k(t.uitvoerVoor - t.uitvoerNa)} tekens gelezen`)
  $.ui.status(delen.join(' · '))
}

async function zetNiveau($: Engine, n: MinifyNiveau) {
  await update($, niveauAtom, () => n)
  // Het script ziet de wissel bij het volgende bericht en geeft dan de volledige regels opnieuw mee.
  await schrijfNiveau($, n)
  await toonStatus($)
}

async function absoluut($: Engine, pad: string) {
  if (pad.startsWith('~/')) return `${await thuis($)}${pad.slice(1)}`
  if (pad.startsWith('/') || /^[A-Za-z]:[\\/]/.test(pad)) return pad
  return `${await $.session.cwd()}/${pad.replace(/^\.\//, '')}`
}

// Backups staan buiten de repo, met het volledige pad in de naam, zodat Claude ze niet als
// geheugenbestand oppikt en twee CLAUDE.md's elkaar niet overschrijven.
async function backupPad($: Engine, pad: string) {
  const naam = pad.replace(/^\//, '').replace(/[/\\:]/g, '__').replace(/\.(md|txt)$/i, '')
  return `${await map($)}/backups/${naam}.original.md`
}

// ---------- tooluitvoer ----------

const isMcp = (tool: string) => tool.startsWith('mcp__') && !tool.startsWith('mcp__minify__')

async function bewaar($: Engine, tool: string, origineel: string) {
  const t = (await read($, tellerAtom)) ?? LEGE_TELLER
  const sessie = await $.session.id()
  const naam = tool.replace(/^mcp__/, '').replace(/[^\w.-]+/g, '_').slice(0, 60)
  const pad = `${await map($)}/uitvoer/${sessie}/${t.ingekort + 1}-${naam}.txt`
  await $.fs.write(pad, origineel)
  return pad
}

async function tel($: Engine, voor: number, na: number) {
  await update($, tellerAtom, t => {
    const o = t ?? LEGE_TELLER
    return { ...o, ingekort: o.ingekort + 1, uitvoerVoor: o.uitvoerVoor + voor, uitvoerNa: o.uitvoerNa + na }
  })
  await toonStatus($)
}

/** Kort één tekst in; geeft null terug als dat niets oplevert. */
async function kortIn($: Engine, tool: string, tekst: string, drempel: number) {
  const r = inkorten(tekst, { drempel })
  if (!r.ingekort) return null
  const pad = await bewaar($, tool, tekst)
  await tel($, r.voor, r.na)
  return r.tekst + voetregel(pad, r.voor, r.na)
}

// ---------- bestanden ----------

let voorstel: { pad: string; origineel: string; nieuw: string } | undefined

async function bestandVoorstellen($: Engine, invoer: string) {
  const pad = await absoluut($, invoer)
  const reden = weigerReden(pad)
  if (reden) return `Niet ingekort: ${reden}.`
  if (!(await $.fs.exists(pad))) return `Bestand niet gevonden: ${pad}`
  const origineel = await $.fs.read(pad)
  const r = await $.model.complete({ model: MODEL_BESTAND, prompt: opdracht(origineel), maxTokens: 16_000, timeoutMs: 180_000 })
  if (!r.isAnswered) return `Inkorten mislukt (${r.reason}). Het bestand is niet aangeraakt.`
  const nieuw = uitAntwoord(r.text)
  const check = controleer(origineel, nieuw)
  if (!check.ok) return `Inkorten afgekeurd, het bestand is niet aangeraakt:\n- ${check.fouten.join('\n- ')}`
  voorstel = { pad, origineel, nieuw }
  await $.fs.write(`${await map($)}/voorstel/${pad.split('/').pop()}`, nieuw)
  const voor = tokens(origineel)
  const na = tokens(nieuw)
  return [
    `Voorstel voor ${pad}: ~${voor} → ~${na} tokens (−${Math.round((1 - na / voor) * 100)}%). Koppen, code, paden en URL's zijn gecontroleerd.`,
    '',
    '```diff',
    diff(origineel, nieuw),
    '```',
    '',
    'Toepassen: /minify toepassen (het origineel gaat naar een backup; terugzetten met /minify herstel <pad>).',
    `Volledig voorstel: ${await map($)}/voorstel/${pad.split('/').pop()}`,
  ].join('\n')
}

async function bestandToepassen($: Engine) {
  if (!voorstel) return 'Er is geen voorstel. Eerst: /minify bestand <pad>'
  const { pad, origineel, nieuw } = voorstel
  if ((await $.fs.read(pad)) !== origineel) {
    voorstel = undefined
    return `${pad} is veranderd sinds het voorstel. Niets overschreven; vraag een nieuw voorstel aan.`
  }
  const backup = await backupPad($, pad)
  await $.fs.write(backup, origineel)
  await $.fs.write(pad, nieuw)
  voorstel = undefined
  return `Ingekort: ${pad}. Backup: ${backup}`
}

async function bestandHerstellen($: Engine, invoer: string) {
  const pad = await absoluut($, invoer)
  const backup = await backupPad($, pad)
  if (!(await $.fs.exists(backup))) return `Geen backup gevonden voor ${pad}.`
  await $.fs.write(pad, await $.fs.read(backup))
  return `Teruggezet: ${pad} (uit ${backup}).`
}

// ---------- tekst van /minify ----------

const HULP = `minify — kort antwoorden en lange uitvoer inkorten.
/minify O1 | O2 | O3   niveau voor deze sessie (O1 hele zinnen, O2 standaard, O3 fragmenten)
/minify uit             normaal praten (ook: "doe normaal")
/minify standaard O3    niveau voor nieuwe sessies (of: standaard uit)
/minify stats           output per beurt per niveau, over je sessies
/minify bestand <pad>   CLAUDE.md of todo inkorten (voorstel; daarna /minify toepassen)
/minify herstel <pad>   origineel terugzetten`

async function statusTekst($: Engine) {
  const n = await niveau($)
  const t = (await read($, tellerAtom)) ?? LEGE_TELLER
  let gemeld = ''
  const gemeldPad = `${await map($)}/gemeld/${await $.session.id()}`
  if (await $.fs.exists(gemeldPad)) gemeld = (await $.fs.read(gemeldPad)).trim()
  const regels = gemeld ? `ja, -${gemeld}${gemeld !== n ? ` (bij je volgende bericht -${n})` : ''}` : 'nog niet; ze gaan mee met je volgende bericht'
  return [
    `Niveau: ${n === 'uit' ? 'uit' : `-${n}`} (standaard voor nieuwe sessies: ${await standaard($)})`,
    n === 'uit' ? '' : `Regels meegegeven aan Claude: ${regels}`,
    `Deze sessie: ${t.beurten} beurten, ${t.output} output-tokens${t.beurten ? ` (⌀ ${Math.round(t.output / t.beurten)})` : ''}.`,
    `Tooluitvoer ingekort: ${t.ingekort}× (${t.uitvoerVoor} → ${t.uitvoerNa} tekens).`,
  ].filter(Boolean).join('\n')
}

async function statsTekst($: Engine) {
  const per = ((await $.store.get('perNiveau')) ?? {}) as PerNiveau
  const rijen = ['uit', 'O1', 'O2', 'O3'].filter(n => per[n]?.beurten).map(n => {
    const p = per[n]!
    return `${n.padEnd(4)} ${String(p.beurten).padStart(6)} beurten   ⌀ ${Math.round(p.output / p.beurten)} output-tokens per beurt`
  })
  if (!rijen.length) return 'Nog geen beurten gemeten.'
  return ['Gemiddelde output per beurt, over al je sessies:', ...rijen, '', 'Let op: geen A/B-test. Beurten verschillen per taak; vergelijk pas bij veel beurten per niveau.'].join('\n')
}

// ---------- hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'minify', description: 'Kort antwoorden en lange uitvoer inkorten: O1/O2/O3/uit, stats, bestand <pad>' })
    await note($, `geladen vanuit ${$.plugin.root}`)
    await schrijfRegels($)
    await schrijfNiveau($, await niveau($))
    await toonStatus($)
    return next(e)
  }).catch(failOpen)

  // "doe normaal" en dergelijke zetten minify uit.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && isUitVerzoek(e.text) && (await niveau($)) !== 'uit') {
      await zetNiveau($, 'uit')
      $.ui.toast('minify staat uit. Weer aan: /minify O2')
    }
    return next(e)
  }).catch(failOpen)

  // Lange uitvoer van Bash en MCP-tools inkorten; het origineel blijft op schijf.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool !== 'Bash' && !isMcp(tool)) return next(e)
    if ((await niveau($)) === 'uit') return next(e)
    const r = await next(e)
    if (r.deny !== undefined) return r

    if (r.isError) {
      // Een mislukt commando (bv. falende tests). Een hook kan geen foutresultaat teruggeven (core
      // valideert het als gewoon resultaat), dus gaat de ingekorte fouttekst als `deny` ná uitvoering:
      // het model leest dan "<tool> ran, and a plugin withheld its result: <tekst>" en de fout blijft een fout.
      const kort = r.text ? await kortIn($, tool, r.text, 6000) : null
      return kort ? { deny: `het commando is wél uitgevoerd en mislukte; minify kortte de foutuitvoer in:\n${kort}` } : r
    }

    if (tool === 'Bash') {
      const res = r.result as { stdout?: string; stderr?: string; backgroundTaskId?: string; isImage?: boolean; persistedOutputPath?: string; persistedOutputSize?: number }
      // Achtergrondtaken en afbeeldingen: laten.
      if (!res || res.backgroundTaskId || res.isImage) return r
      // Heel grote uitvoer schrijft Claude Code zelf weg en het model ziet dan alleen de eerste 2 KB,
      // dus geen fouten aan het eind. Wij lezen het hele bestand en korten dat in; het origineel staat er al.
      if (res.persistedOutputPath) {
        const volledig = await $.fs.read(res.persistedOutputPath)
        const k = inkorten(volledig, { drempel: 6000 })
        if (!k.ingekort) return r
        await tel($, k.voor, k.na)
        const { persistedOutputPath: pad, persistedOutputSize: _grootte, ...rest } = res
        return { result: { ...rest, stdout: k.tekst + voetregel(pad, k.voor, k.na), stderr: '' } as typeof r.result, context: r.context }
      }
      const stdout = res.stdout ? await kortIn($, tool, res.stdout, 6000) : null
      const stderr = res.stderr ? await kortIn($, `${tool}-stderr`, res.stderr, 3000) : null
      if (!stdout && !stderr) return r
      return { result: { ...res, stdout: stdout ?? res.stdout, stderr: stderr ?? res.stderr } as typeof r.result, context: r.context }
    }

    // MCP: een lijst tekstblokken of een string. Andere vormen laten we met rust.
    const res = r.result as unknown
    if (typeof res === 'string') {
      const kort = await kortIn($, tool, res, 8000)
      return kort ? { result: kort, context: r.context } : r
    }
    if (Array.isArray(res) && res.every(b => b && typeof b === 'object')) {
      let veranderd = false
      const blokken = []
      for (const b of res as { type?: string; text?: string }[]) {
        const kort = b.type === 'text' && typeof b.text === 'string' ? await kortIn($, tool, b.text, 8000) : null
        if (kort) veranderd = true
        blokken.push(kort ? { ...b, text: kort } : b)
      }
      return veranderd ? { result: blokken, context: r.context } : r
    }
    return r
  }).catch(failOpen)

  // Meten: output-tokens per beurt van de hoofdsessie, per sessie en per niveau.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || !e.usage || e.isAborted) return result
    const out = e.usage.output_tokens
    const n = await niveau($)
    await update($, tellerAtom, t => {
      const o = t ?? LEGE_TELLER
      return { ...o, beurten: o.beurten + 1, output: o.output + out }
    })
    const per = ((await $.store.get('perNiveau')) ?? {}) as PerNiveau
    const p = per[n] ?? { beurten: 0, output: 0 }
    await $.store.set('perNiveau', { ...per, [n]: { beurten: p.beurten + 1, output: p.output + out } })
    await toonStatus($)
    return result
  }).catch(failOpen)

  on('command.run', { command: 'minify' }, async ($, e) => {
    const c = leesCommando(e.args)
    switch (c.soort) {
      case 'status':
        return { text: await statusTekst($) }
      case 'niveau':
        await zetNiveau($, c.niveau)
        return { text: `minify -${c.niveau} voor deze sessie. Vast voor nieuwe sessies: /minify standaard ${c.niveau}` }
      case 'uit':
        await zetNiveau($, 'uit')
        return { text: 'minify staat uit voor deze sessie. Weer aan: /minify O2' }
      case 'standaard':
        await $.store.set('standaard', c.niveau)
        await $.fs.write(`${await map($)}/standaard`, c.niveau)
        return { text: `Nieuwe sessies starten met minify ${c.niveau === 'uit' ? 'uit' : `-${c.niveau}`}.` }
      case 'stats':
        return { text: await statsTekst($) }
      case 'bestand':
        return { text: await bestandVoorstellen($, c.pad) }
      case 'toepassen':
        return { text: await bestandToepassen($) }
      case 'herstel':
        return { text: await bestandHerstellen($, c.pad) }
      default:
        return { text: HULP }
    }
  })
}
