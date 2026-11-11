// Tab OpenRouter: key-controle, het eigen settings-bestand voor `claude-or`, het opruimen van oude
// OpenRouter-regels uit ~/.claude/settings.json, de modellijst en de kostenschatting. Pure functies,
// zonder Node-API's.
//
// Sinds 0.9.0 schrijft futureflow OpenRouter nooit meer in ~/.claude/settings.json: Claude Code leest
// dat bestand live in alle lopende sessies (ook de desktop-app), en die gingen dan via OpenRouter naar
// een model met een kleiner contextvenster. OpenRouter staat nu in een eigen bestand dat alleen
// `claude-or` (claude --settings <bestand>) laadt.

import { OR_HELPER, OR_SERVICE, OR_URL } from './api.mjs'

export { OR_HELPER, OR_SERVICE, OR_URL }
export const OR_ACCOUNT = 'futureflow'

// Hoogstens één keer per 6 uur de lijst opnieuw ophalen (behalve op de knop).
export const CACHE_MS = 6 * 3_600_000
// Zoveel modellen toont de tab.
export const TOON = 20

const KEY = /^sk-or-[A-Za-z0-9_-]{20,}$/
const MODEL = /^[A-Za-z0-9~][A-Za-z0-9._~-]*\/[A-Za-z0-9._:~-]+(\[1m\])?$/

export function geldigeOrKey(s) {
  return typeof s === 'string' && KEY.test(s)
}

export function geldigModel(s) {
  return typeof s === 'string' && s.length <= 120 && MODEL.test(s)
}

// Onder dit contextvenster is een model te klein voor Claude Code (systeemprompt, tools en compact).
export const CONTEXT_MIN = 200_000
// Vanaf dit contextvenster krijgt het model-id `[1m]`, zodat Claude Code met 1M context rekent.
export const CONTEXT_1M = 1_000_000

// Het model-id zoals futureflow het in het settings-bestand zet: met `[1m]` bij ≥ 1M context.
export function modelIdVoor(m) {
  if (!m || typeof m.id !== 'string') return undefined
  const id = m.id.replace(/\[1m\]$/, '')
  return typeof m.context === 'number' && m.context >= CONTEXT_1M ? `${id}[1m]` : id
}

// Te klein contextvenster voor Claude Code (onbekend telt niet als te klein).
export const teKlein = m => typeof m?.context === 'number' && m.context > 0 && m.context < CONTEXT_MIN

// Het start-commando en de shim in ~/.local/bin. De merkregel zegt dat het bestand van futureflow is:
// alleen dan overschrijft futureflow het.
export const START = 'claude-or'
export const SHIM_MERK = '# futureflow: claude-or'
// Omgevingsvariabele die de shim zet; de mod herkent een claude-or-sessie aan de waarde '1'.
export const OR_MARKER = 'FUTUREFLOW_OPENROUTER'

// Inhoud van de shim: claude met het eigen settings-bestand, alleen voor die sessie.
export function shimTekst(settingsPad) {
  const pad = String(settingsPad).replace(/'/g, `'\\''`)
  return [
    '#!/bin/sh',
    SHIM_MERK,
    '# Start Claude Code via OpenRouter, alleen deze sessie. Andere sessies en de desktop-app blijven op je abonnement.',
    `S='${pad}'`,
    'if [ ! -f "$S" ]; then',
    `  echo "${START}: nog geen OpenRouter-instellingen; kies modellen in /futureflow en klik Gebruik nu." >&2`,
    '  exit 1',
    'fi',
    '# Marker: zo ziet futureflow in de sessie dat die via OpenRouter loopt (het env-blok van --settings komt niet in de procesomgeving).',
    `export ${OR_MARKER}=1`,
    'exec claude --settings "$S" "$@"',
    '',
  ].join('\n')
}

// Wat futureflow voor OpenRouter in het eigen settings-bestand zet: hoofdmodel voor opus/sonnet/fable, het snelle
// model voor haiku (ook achtergrondtaken) en subagents.
// Model 1 t/m 5 (0.13.0), gekoppeld aan /model: 1 = Opus en het startmodel (ANTHROPIC_MODEL), 2 = Sonnet,
// 3 = Fable, 4 = Haiku, subagents en achtergrondtaken, 5 = een extra regel in /model
// (ANTHROPIC_CUSTOM_MODEL_OPTION). Lege 2, 3 en 4 vallen terug op 1; een lege 5 komt er niet in.
export const SLOTS = ['m1', 'm2', 'm3', 'm4', 'm5']

// Uitleg per rij in de kaart.
export const SLOT_UITLEG = {
  m1: 'start + /model opus',
  m2: '/model sonnet',
  m3: '/model fable',
  m4: 'subagents + /model haiku',
  m5: 'extra regel in /model',
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)

// Keuze uit de store, ook de oude vorm (0.9-0.12: model/snel/opus/sonnet/fable): hoofd of opus → 1,
// sonnet → 2, fable → 3, snel → 4. Alleen geldige ids; onzin = niets gekozen, nooit een fout.
export function keuzeVan(ruw) {
  const k = isObj(ruw) ? ruw : {}
  const uit = {}
  const zet = (slot, ...kandidaten) => {
    const v = kandidaten.find(x => geldigModel(x))
    if (v !== undefined) uit[slot] = v
  }
  zet('m1', k.m1, k.opus, k.model)
  zet('m2', k.m2, k.sonnet)
  zet('m3', k.m3, k.fable)
  zet('m4', k.m4, k.snel)
  zet('m5', k.m5)
  return uit
}

// Wat futureflow in het eigen settings-bestand van claude-or zet. Alleen m1 is verplicht.
export function orInstellingen(k) {
  const m1 = k.m1
  const of1 = v => (geldigModel(v) ? v : m1)
  const env = {
    ANTHROPIC_BASE_URL: OR_URL,
    ANTHROPIC_API_KEY: '',
    // Wint van een vast model-id in ~/.claude/settings.json (bv. claude-fable-5-1[1m]); de DEFAULT_*-sleutels
    // vervangen alleen aliassen.
    ANTHROPIC_MODEL: m1,
    ANTHROPIC_DEFAULT_OPUS_MODEL: m1,
    ANTHROPIC_DEFAULT_SONNET_MODEL: of1(k.m2),
    ANTHROPIC_DEFAULT_FABLE_MODEL: of1(k.m3),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: of1(k.m4),
    CLAUDE_CODE_SUBAGENT_MODEL: of1(k.m4),
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    // Met een eigen base-URL laadt Claude Code anders alle tool-schema's vooraf (~660k tokens gemeten).
    ENABLE_TOOL_SEARCH: 'true',
  }
  if (geldigModel(k.m5)) {
    env.ANTHROPIC_CUSTOM_MODEL_OPTION = k.m5
    env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = `Model 5 · ${k.m5}`
    env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION = 'Via OpenRouter (futureflow)'
  }
  return { apiKeyHelper: OR_HELPER, env }
}

const kloon = d => (d && typeof d === 'object' ? JSON.parse(JSON.stringify(d)) : {})
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v)

// Zet `gewenst` in een kopie van `data`. Alleen wat futureflow zelf toevoegt komt in de marker; een
// sleutel die al precies die waarde heeft blijft van de gebruiker. Een andere waarde op een van onze
// sleutels: { vreemd: '<sleutel>' } en niets veranderd.
export function pasToe(data, gewenst) {
  const nieuw = kloon(data)
  const marker = { env: {} }
  if (nieuw.apiKeyHelper !== undefined && nieuw.apiKeyHelper !== gewenst.apiKeyHelper) return { vreemd: 'apiKeyHelper' }
  if (nieuw.env !== undefined && !isObject(nieuw.env)) return { vreemd: 'env' }
  if (nieuw.env === undefined) {
    nieuw.env = {}
    marker.envNieuw = true
  }
  for (const [k, v] of Object.entries(gewenst.env)) {
    const nu = nieuw.env[k]
    if (nu === undefined) {
      nieuw.env[k] = v
      marker.env[k] = v
    } else if (nu !== v) {
      return { vreemd: `env.${k}` }
    }
  }
  // De helper noemt ons sleutelhanger-item: altijd van ons, ook als hij er al stond.
  nieuw.apiKeyHelper = gewenst.apiKeyHelper
  marker.apiKeyHelper = gewenst.apiKeyHelper
  return { data: nieuw, marker }
}

// Haalt precies weg wat de marker zegt, en alleen als de waarde nog gelijk is; onze helper altijd.
// Zonder marker (kwijt): alleen waarden die futureflow zelf zou schrijven, zodat het abonnement weer
// werkt: de base-URL van OpenRouter, en met onze helper erbij ook de lege ANTHROPIC_API_KEY, de
// betas-vlag en model-ids in OpenRouter-vorm (aanbieder/model).
export function haalWeg(data, marker) {
  const nieuw = kloon(data)
  const metHelper = nieuw.apiKeyHelper === OR_HELPER
  if (metHelper) delete nieuw.apiKeyHelper
  const m = isObject(marker) ? marker : undefined
  if (isObject(nieuw.env) && m && isObject(m.env)) {
    for (const [k, v] of Object.entries(m.env)) if (nieuw.env[k] === v) delete nieuw.env[k]
    if (m.envNieuw && Object.keys(nieuw.env).length === 0) delete nieuw.env
  } else if (isObject(nieuw.env) && !m) {
    const env = nieuw.env
    const voor = Object.keys(env).length
    if (env.ANTHROPIC_BASE_URL === OR_URL) delete env.ANTHROPIC_BASE_URL
    if (metHelper) {
      if (env.ANTHROPIC_API_KEY === '') delete env.ANTHROPIC_API_KEY
      if (env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS === '1') delete env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
    }
    if (metHelper || data?.env?.ANTHROPIC_BASE_URL === OR_URL) {
      for (const k of MODEL_SLEUTELS) if (geldigModel(env[k]) && env[k].includes('/')) delete env[k]
    }
    if (voor > 0 && Object.keys(env).length === 0) delete nieuw.env
  }
  return nieuw
}

const MODEL_SLEUTELS = ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']

// Welke base-URL van ons is: die uit de marker, en zonder marker de vaste URL van OpenRouter (dan is
// hij met haalWeg weer weg te halen en blokkeert hij het wisselen niet).
export function eigenBasis(marker) {
  if (!isObject(marker)) return OR_URL
  return isObject(marker.env) && typeof marker.env.ANTHROPIC_BASE_URL === 'string' ? marker.env.ANTHROPIC_BASE_URL : undefined
}

// Prijs per token (string of getal) → USD per miljoen tokens; undefined bij onzin of negatief.
export function perMtok(v) {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e4) / 1e4 : undefined
}

const alPerMtok = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)

// Uitvoer van GET /api/v1/models (of de CLI-uitvoer daarvan, al per Mtok) → { id, naam, context, in, uit } (prijzen per Mtok); onbruikbare weg.
export function modellenVan(ruw) {
  const lijst = Array.isArray(ruw?.data) ? ruw.data : Array.isArray(ruw) ? ruw : []
  const uit = []
  for (const m of lijst) {
    if (!m || !geldigModel(m.id)) continue
    const context = Number.isFinite(m.context_length) ? m.context_length : Number.isFinite(m.context) ? m.context : undefined
    // Van de API: per token in `pricing`; al omgerekend (uitvoer van de CLI): per Mtok in `in`/`uit`.
    const prijsIn = m.pricing ? perMtok(m.pricing.prompt) : alPerMtok(m.in)
    const prijsUit = m.pricing ? perMtok(m.pricing.completion) : alPerMtok(m.uit)
    uit.push({
      id: m.id,
      naam: typeof (m.name ?? m.naam) === 'string' ? String(m.name ?? m.naam).slice(0, 80) : m.id,
      ...(context !== undefined ? { context } : {}),
      ...(prijsIn !== undefined ? { in: prijsIn } : {}),
      ...(prijsUit !== undefined ? { uit: prijsUit } : {}),
    })
  }
  return uit
}

export const isClaude = id => typeof id === 'string' && id.startsWith('anthropic/')

// Filtert op id of naam (hoofdletters maken niet uit) en sorteert: Claude via OpenRouter eerst, dan op id.
export function sorteer(lijst, zoek) {
  const z = typeof zoek === 'string' ? zoek.trim().toLowerCase() : ''
  return (Array.isArray(lijst) ? lijst : [])
    .filter(m => !z || m.id.toLowerCase().includes(z) || String(m.naam).toLowerCase().includes(z))
    .sort((a, b) => Number(isClaude(b.id)) - Number(isClaude(a.id)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// Prijs per Mtok als tekst: $3 of $0,15; onbekend → ?.
export function prijsTekst(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?'
  const t = n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(2).replace(/0$/, '').replace(/\.0$/, '') : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return `$${t.replace('.', ',')}`
}

// Context als tekst: 200k, 1M.
export function contextTekst(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '?'
  return n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M`.replace('.', ',') : `${Math.round(n / 1000)}k`
}

const telling = n => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)

// Geschatte kosten van één beurt op OpenRouter (USD) met de prijzen van het model (per Mtok).
// Cache-tokens tellen als gewone input: OpenRouter rekent per aanbieder, dit is een bovengrens.
export function orKosten(usage, prijs) {
  if (!usage || typeof usage !== 'object' || !prijs) return 0
  const input = telling(usage.input_tokens) + telling(usage.cache_read_input_tokens) + telling(usage.cache_creation_input_tokens)
  return (input * telling(prijs.in) + telling(usage.output_tokens) * telling(prijs.uit)) / 1_000_000
}

// ---- Herstart op OpenRouter (0.11.0): de huidige sessie verder in een nieuw Terminal-venster ----

const SESSIE = /^[A-Za-z0-9-]{8,64}$/

export const geldigeSessie = s => typeof s === 'string' && SESSIE.test(s)

// Eén argument veilig voor sh: tussen enkele aanhalingstekens.
export function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

// Het commando voor het nieuwe venster: naar de map en de sessie voortzetten via claude-or. Geen
// geheimen: alleen map, pad van de shim en sessie-id. undefined bij een ongeldig id of lege map.
export function herstartCommando({ cwd, sessie, shim }) {
  if (!geldigeSessie(sessie) || typeof cwd !== 'string' || !cwd.startsWith('/') || typeof shim !== 'string' || !shim) return undefined
  return `cd ${shQuote(cwd)} && ${shQuote(shim)} --resume ${shQuote(sessie)}`
}

// Tekst als AppleScript-string: backslash en dubbel aanhalingsteken escapen; geen regeleinden.
export function asString(s) {
  return `"${String(s).replace(/[\r\n]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// AppleScript dat een nieuw venster opent en het commando daarin draait. iTerm alleen als dat de
// terminal van de sessie is (TERM_PROGRAM=iTerm.app); anders Terminal.app.
export function herstartScript(app, commando) {
  if (app === 'iterm') {
    return [
      'tell application "iTerm"',
      'activate',
      'set w to (create window with default profile)',
      `tell current session of w to write text ${asString(commando)}`,
      'end tell',
    ].join('\n')
  }
  return ['tell application "Terminal"', 'activate', `do script ${asString(commando)}`, 'end tell'].join('\n')
}

// Past het gesprek niet in het venster van het model? Onbekend = geen waarschuwing.
export function contextTeGroot(tokens, context) {
  return typeof tokens === 'number' && typeof context === 'number' && context > 0 && tokens > context
}

// Staat er een OpenRouter-model als standaard (`model`) in de algemene settings.json? Dat gebeurt met
// /model → Enter in claude-or; daarna sturen alle sessies dat model. OpenRouter-id = bevat een '/', of is
// gelijk aan een gekozen model (Model 1-5, ook met of zonder [1m]).
export function orModelAlsStandaard(model, keuze) {
  if (typeof model !== 'string' || !model) return false
  if (model.includes('/')) return true
  const kaal = x => String(x).replace(/\[1m\]$/, '')
  return Object.values(keuze ?? {}).some(v => typeof v === 'string' && v && kaal(v) === kaal(model))
}

// Orca: een nieuwe terminal in dezelfde worktree met het herstart-commando. `worktree` is
// ORCA_WORKTREE_ID (<repoId>::<pad>); zonder die id de map van de sessie. undefined zonder bin of commando.
export function orcaArgs({ bin, worktree, cwd, commando }) {
  if (typeof bin !== 'string' || !bin.startsWith('/') || typeof commando !== 'string' || !commando) return undefined
  // Geen orca uit de projectmap zelf (een gekloonde repo kan geen eigen 'orca' laten draaien).
  if (typeof cwd === 'string' && cwd && (bin === cwd || bin.startsWith(`${cwd.replace(/\/+$/, '')}/`))) return undefined
  const kies = typeof worktree === 'string' && worktree.includes('::') ? `id:${worktree}`
    : typeof cwd === 'string' && cwd.startsWith('/') ? `path:${cwd}` : undefined
  if (!kies) return undefined
  return [`${bin.replace(/\/+$/, '')}/orca`, 'terminal', 'create', '--worktree', kies, '--title', START, '--command', commando, '--focus', '--json']
}

// Orca-orchestratie vanuit een claude-or-sessie: `--agent claude` start een gewone claude op het abonnement
// (Orca kent geen eigen agentprofielen; alleen agentCmdOverrides, en die geldt voor heel Orca). Herkent
// `orca … agent launch|orchestration worker-start|worktree create … --agent claude` zonder --terminal.
export function orcaClaudeStart(command) {
  if (typeof command !== 'string') return false
  return command.split(/&&|\|\||;|\n/).some(deel =>
    /(^|[\s/'"])orca(-dev|-ide)?['"]?\s/.test(deel) &&
    /\s(agent\s+launch|orchestration\s+worker-start|worktree\s+create)\s/.test(` ${deel} `) &&
    /\s--agent(\s+|=)['"]?claude(-agent-teams)?['"]?(\s|$)/.test(` ${deel} `) &&
    !/\s--terminal(\s|=)/.test(` ${deel} `))
}

// Wat het model terugkrijgt: hoe de worker wél in claude-or start (eigen terminal + --terminal).
export const ORCA_WEIGER = [
  'futureflow: deze sessie loopt via OpenRouter (claude-or). `--agent claude` start in Orca een gewone claude op het abonnement.',
  'Start de worker zo in claude-or:',
  '1. orca terminal create --worktree <zelfde selector> --title worker --command "claude-or --dangerously-skip-permissions" --json  → neem `handle` uit het antwoord',
  '2. wacht tot claude-or klaar staat: orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json',
  '3. orca orchestration worker-start --spec "<taak>" --terminal <handle> --worktree <zelfde selector> --json  (zonder --agent en --model)',
  'Wil je bewust een worker op het abonnement, zeg dat dan eerst tegen de gebruiker.',
].join('\n')
