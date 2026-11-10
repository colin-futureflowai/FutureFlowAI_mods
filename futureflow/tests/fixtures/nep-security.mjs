// Nep-`security` voor de tests van cli/accounts.mjs. Nooit de echte sleutelhanger.
//   NEP_KEYCHAIN  JSON-bestand { "<service>\t<account>": "<waarde>" }
//   NEP_LOG       elke aanroep: `ARGV <json>`, elke stdin-regel: `STDIN <regel>`
//   NEP_FAAL      JSON [{ op: 'add'|'find'|'delete', svc, keer?: n, modus?: 'exit'|'stil'|'kapot' }]
//                 keer = alleen de n-de passende aanroep (1-based); zonder keer: elke.
//                 exit = exitcode 1; stil = exit 0 maar niets bewaard; kapot = afgekapte waarde bewaard;
//                 traag = eerst 1 s wachten, dan gewoon bewaren (om een signaal midden in een wissel te sturen).
// Ondersteunt -i (opdrachten op stdin, regel > 4096 bytes wordt geweigerd zoals de echte afkapt),
// find-generic-password [-w], add-generic-password -U -a -s -X|-w, delete-generic-password; 44 = niet gevonden.
import fs from 'node:fs'

const STORE = process.env.NEP_KEYCHAIN
const LOG = process.env.NEP_LOG

const log = regel => LOG && fs.appendFileSync(LOG, regel + '\n')
const lees = () => {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')) } catch { return {} }
}
const bewaar = d => fs.writeFileSync(STORE, JSON.stringify(d, null, 1))

function faalt(op, svc) {
  const regels = JSON.parse(process.env.NEP_FAAL || '[]')
  const telPad = STORE + '.tel'
  let tel = {}
  try { tel = JSON.parse(fs.readFileSync(telPad, 'utf8')) } catch {}
  let uit
  regels.forEach((r, i) => {
    if (r.op !== op || (r.svc !== undefined && r.svc !== svc)) return
    tel[i] = (tel[i] ?? 0) + 1
    if (!uit && (r.keer === undefined || r.keer === tel[i])) uit = r.modus ?? 'exit'
  })
  fs.writeFileSync(telPad, JSON.stringify(tel))
  return uit
}

// Shell-achtig splitsen zoals `security -i`: dubbele aanhalingstekens en backslash-escapes.
function woorden(regel) {
  const uit = []
  let w = null
  let q = false
  for (let i = 0; i < regel.length; i++) {
    const c = regel[i]
    if (c === '\\' && i + 1 < regel.length) { w = (w ?? '') + regel[++i]; continue }
    if (c === '"') { q = !q; w = w ?? ''; continue }
    if (!q && /\s/.test(c)) { if (w !== null) uit.push(w); w = null; continue }
    w = (w ?? '') + c
  }
  if (w !== null) uit.push(w)
  return uit
}

function vlaggen(args) {
  const o = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (['-a', '-s', '-X', '-w'].includes(a) && i + 1 < args.length && !args[i + 1].startsWith('-')) o[a] = args[++i]
    else o[a] = true
  }
  return o
}

function opdracht(args) {
  const [cmd, ...rest] = args
  const o = vlaggen(rest)
  const sleutel = `${o['-s']}\t${o['-a']}`
  if (cmd === 'find-generic-password') {
    if (faalt('find', o['-s'])) return 1
    const d = lees()
    if (!(sleutel in d)) return 44
    if (o['-w']) process.stdout.write(d[sleutel] + '\n')
    else process.stdout.write(`keychain: "nep"\n    "svce"<blob>="${o['-s']}"\n`)
    return 0
  }
  if (cmd === 'add-generic-password') {
    const modus = faalt('add', o['-s'])
    if (modus === 'exit') return 1
    if (modus === 'traag') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
    const waarde = typeof o['-X'] === 'string' ? Buffer.from(o['-X'], 'hex').toString('utf8') : o['-w']
    if (modus === 'stil') return 0
    const d = lees()
    if (d[sleutel] !== undefined && !o['-U']) return 45
    d[sleutel] = modus === 'kapot' ? String(waarde).slice(0, 20) : waarde
    bewaar(d)
    return 0
  }
  if (cmd === 'delete-generic-password') {
    if (faalt('delete', o['-s'])) return 1
    const d = lees()
    if (!(sleutel in d)) return 44
    delete d[sleutel]
    bewaar(d)
    return 0
  }
  return 2
}

const args = process.argv.slice(2)
log(`ARGV ${JSON.stringify(args)}`)
if (args[0] === '-i') {
  const invoer = fs.readFileSync(0, 'utf8')
  let code = 0
  for (const regel of invoer.split('\n')) {
    if (!regel) continue
    log(`STDIN ${regel}`)
    if (Buffer.byteLength(regel) + 1 > 4096) {
      process.stderr.write('regel te lang\n')
      code = 1
      continue
    }
    const c = opdracht(woorden(regel))
    if (c !== 0) code = c
  }
  process.exitCode = code
} else {
  process.exitCode = opdracht(args)
}
