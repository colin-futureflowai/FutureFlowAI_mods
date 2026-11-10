// node --test futureflow/tests/api-cli.test.mjs
// Werkt alleen met een tijdelijk settings-bestand (SETTINGS_JSON) en een nep-`security` (SECURITY_BIN),
// nooit met het echte ~/.claude/settings.json of de echte sleutelhanger.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { HELPER } from '../lib/api.mjs'

const CLI = fileURLToPath(new URL('../cli/api.mjs', import.meta.url))
const KEY = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ_abc-WXYZ'
let dir, bestand, nep, log, sleutel

// Nep-security: logt argv en stdin, bewaart een key (uit `-i … -w <key>`) in een bestand.
const NEP = `#!/bin/sh
D="$(dirname "$0")"
printf 'ARGV %s\\n' "$*" >> "$D/log"
case "$1" in
  -i)
    IN="$(cat)"
    printf 'STDIN %s\\n' "$IN" >> "$D/log"
    printf '%s' "$IN" | sed -n 's/.* -w \\([^ ]*\\)$/\\1/p' > "$D/sleutel"
    ;;
  find-generic-password)
    [ -s "$D/sleutel" ] || exit 44
    cat "$D/sleutel"
    ;;
  delete-generic-password)
    [ -s "$D/sleutel" ] || exit 44
    rm "$D/sleutel"
    ;;
esac
exit 0
`

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'))
  bestand = path.join(dir, 'settings.json')
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'api-security-'))
  nep = path.join(bin, 'security')
  log = path.join(bin, 'log')
  sleutel = path.join(bin, 'sleutel')
  fs.writeFileSync(nep, NEP, { mode: 0o755 })
})

const cli = (args, stdin) =>
  spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, SETTINGS_JSON: bestand, SECURITY_BIN: nep, OPENROUTER_DIR: path.join(dir, 'or'), OPENROUTER_URL: 'http://127.0.0.1:9' }, input: stdin, encoding: 'utf8' })
const logRegels = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [])
const lees = () => JSON.parse(fs.readFileSync(bestand, 'utf8'))
const rest = () => fs.readdirSync(dir).filter(f => f !== 'settings.json')

// Alleen de velden van de API-key (de nep-security kent geen services, dus de OpenRouter-velden tellen hier niet).
const kern = d => ({ heeftKey: d.heeftKey, staart: d.staart, modus: d.modus, vreemdeHelper: d.vreemdeHelper })

const BASIS = () => ({ model: 'opus', permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'x@y': true }, zzz: [1, 2] })

test('zet-key: key alleen via stdin naar security -i, nooit in argv of uitvoer', () => {
  const r = cli(['zet-key'], KEY + '\n')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, staart: 'WXYZ' })
  assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY))
  const regels = logRegels()
  for (const regel of regels.filter(l => l.startsWith('ARGV'))) assert.ok(!regel.includes(KEY), `key in argv: ${regel}`)
  assert.ok(regels.includes('ARGV -i'))
  assert.ok(regels.includes(`STDIN add-generic-password -U -s futureflow-anthropic-api -a futureflow -w ${KEY}`))
  assert.equal(fs.readFileSync(sleutel, 'utf8').trim(), KEY)
})

test('zet-key met een verkeerde key: exit 1, security niet aangeroepen, key niet in de melding', () => {
  for (const fout of ['sk-proj-abcdefghijklmnopqrstuvwxyz', 'sk-ant-kort', 'sk-ant-api03 met spatie abcdefghijklmnop', '']) {
    const r = cli(['zet-key'], fout)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /geen geldige Anthropic API-key/)
    if (fout) assert.ok(!r.stderr.includes(fout))
  }
  assert.deepEqual(logRegels(), [])
})

test('status: staart en modus, nooit de hele key', () => {
  assert.deepEqual(kern(JSON.parse(cli(['status']).stdout)), { heeftKey: false, staart: '', modus: 'abonnement', vreemdeHelper: false })
  cli(['zet-key'], KEY)
  fs.writeFileSync(bestand, JSON.stringify({ ...BASIS(), apiKeyHelper: HELPER }, null, 2))
  const r = cli(['status'])
  assert.equal(r.status, 0)
  assert.ok(!r.stdout.includes(KEY))
  assert.deepEqual(kern(JSON.parse(r.stdout)), { heeftKey: true, staart: 'WXYZ', modus: 'api', vreemdeHelper: false })
})

test('modus api zet alleen onze helper; abonnement haalt hem weg; de rest blijft exact', () => {
  cli(['zet-key'], KEY)
  fs.writeFileSync(bestand, JSON.stringify(BASIS(), null, 2) + '\n', { mode: 0o600 })
  const r = cli(['modus', 'api'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), { modus: 'api', gewijzigd: true })
  assert.equal(fs.readFileSync(bestand, 'utf8'), JSON.stringify({ ...BASIS(), apiKeyHelper: HELPER }, null, 2) + '\n')
  assert.equal(fs.statSync(bestand).mode & 0o777, 0o600)
  assert.deepEqual(rest(), [], 'geen tijdelijk bestand achtergelaten')
  assert.deepEqual(JSON.parse(cli(['modus', 'api']).stdout), { modus: 'api', gewijzigd: false })

  const terug = cli(['modus', 'abonnement'])
  assert.equal(terug.status, 0, terug.stderr)
  assert.deepEqual(JSON.parse(terug.stdout), { modus: 'abonnement', gewijzigd: true })
  assert.equal(fs.readFileSync(bestand, 'utf8'), JSON.stringify(BASIS(), null, 2) + '\n')
})

test('een andere apiKeyHelper blijft staan: exit 3 voor api en abonnement', () => {
  cli(['zet-key'], KEY)
  const eigen = JSON.stringify({ ...BASIS(), apiKeyHelper: '~/bin/mijn-key.sh' }, null, 2)
  fs.writeFileSync(bestand, eigen)
  for (const naar of ['api', 'abonnement']) {
    const r = cli(['modus', naar])
    assert.equal(r.status, 3)
    assert.match(r.stderr, /andere apiKeyHelper/)
  }
  assert.equal(fs.readFileSync(bestand, 'utf8'), eigen)
  assert.deepEqual(kern(JSON.parse(cli(['status']).stdout)), { heeftKey: true, staart: 'WXYZ', modus: 'abonnement', vreemdeHelper: true })
})

test('modus api zonder key in de sleutelhanger: exit 4, niets geschreven', () => {
  const tekst = JSON.stringify(BASIS(), null, 2)
  fs.writeFileSync(bestand, tekst)
  const r = cli(['modus', 'api'])
  assert.equal(r.status, 4)
  assert.match(r.stderr, /geen key in de sleutelhanger/)
  assert.equal(fs.readFileSync(bestand, 'utf8'), tekst)
})

test('ontbrekend bestand: api maakt het aan met alleen de helper; abonnement maakt niets', () => {
  assert.deepEqual(JSON.parse(cli(['modus', 'abonnement']).stdout), { modus: 'abonnement', gewijzigd: false })
  assert.equal(fs.existsSync(bestand), false)
  cli(['zet-key'], KEY)
  const r = cli(['modus', 'api'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(lees(), { apiKeyHelper: HELPER })
  assert.equal(fs.statSync(bestand).mode & 0o777, 0o600)
  assert.deepEqual(rest(), [])
})

test('kapot bestand: exit 2, niets geschreven; status meldt de fout maar faalt niet', () => {
  cli(['zet-key'], KEY)
  const kapot = '{ "model": '
  fs.writeFileSync(bestand, kapot)
  for (const naar of ['api', 'abonnement']) {
    const r = cli(['modus', naar])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /geen geldige JSON/)
  }
  assert.equal(fs.readFileSync(bestand, 'utf8'), kapot)
  assert.deepEqual(rest(), [])
  const s = cli(['status'])
  assert.equal(s.status, 0)
  assert.equal(JSON.parse(s.stdout).heeftKey, true)
  assert.match(JSON.parse(s.stdout).fout, /geen geldige JSON/)
})

test('symlink blijft een symlink; het doel wordt bijgewerkt', () => {
  cli(['zet-key'], KEY)
  const echt = path.join(dir, 'echt.json')
  fs.writeFileSync(echt, JSON.stringify(BASIS(), null, 2))
  fs.symlinkSync(echt, bestand)
  assert.equal(cli(['modus', 'api']).status, 0)
  assert.equal(fs.lstatSync(bestand).isSymbolicLink(), true)
  assert.equal(JSON.parse(fs.readFileSync(echt, 'utf8')).apiKeyHelper, HELPER)
})

test('wis-key: delete-generic-password met service en account; zonder key gewist false', () => {
  cli(['zet-key'], KEY)
  const r = cli(['wis-key'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), { gewist: true })
  assert.ok(logRegels().includes('ARGV delete-generic-password -s futureflow-anthropic-api -a futureflow'))
  assert.deepEqual(JSON.parse(cli(['wis-key']).stdout), { gewist: false })
})

test('foute argumenten: exit 1, niets geschreven', () => {
  fs.writeFileSync(bestand, '{}')
  assert.equal(cli(['modus']).status, 1)
  assert.equal(cli(['modus', 'gratis']).status, 1)
  assert.equal(cli(['status', 'extra']).status, 1)
  assert.equal(cli(['onbekend']).status, 1)
  assert.equal(fs.readFileSync(bestand, 'utf8'), '{}')
})

test('takenlijst aan/uit/status: alleen die env-regel, andere sleutels en env-regels blijven', () => {
  fs.writeFileSync(bestand, JSON.stringify({ ...BASIS(), env: { ANDERS: '1' } }, null, 2) + '\n')
  assert.deepEqual(JSON.parse(cli(['takenlijst', 'status']).stdout), { aan: false })
  const aan = cli(['takenlijst', 'aan'])
  assert.equal(aan.status, 0, aan.stderr)
  assert.deepEqual(lees(), { ...BASIS(), env: { ANDERS: '1', CLAUDE_CODE_ENABLE_TODO_TOOLS: 'true' } })
  assert.deepEqual(JSON.parse(cli(['takenlijst', 'status']).stdout), { aan: true })
  assert.equal(JSON.parse(cli(['takenlijst', 'aan']).stdout).gewijzigd, false)
  const uit = cli(['takenlijst', 'uit'])
  assert.equal(uit.status, 0, uit.stderr)
  assert.deepEqual(lees(), { ...BASIS(), env: { ANDERS: '1' } })
  assert.deepEqual(rest(), [])
})

test('takenlijst: env wordt aangemaakt, en verdwijnt weer als hij leeg raakt', () => {
  fs.writeFileSync(bestand, JSON.stringify(BASIS(), null, 2) + '\n')
  cli(['takenlijst', 'aan'])
  assert.deepEqual(lees().env, { CLAUDE_CODE_ENABLE_TODO_TOOLS: 'true' })
  cli(['takenlijst', 'uit'])
  assert.deepEqual(lees(), BASIS())
})

test('takenlijst: ontbrekend bestand wordt aangemaakt; uit en status maken niets', () => {
  assert.deepEqual(JSON.parse(cli(['takenlijst', 'status']).stdout), { aan: false })
  assert.equal(cli(['takenlijst', 'uit']).status, 0)
  assert.ok(!fs.existsSync(bestand))
  assert.equal(cli(['takenlijst', 'aan']).status, 0)
  assert.deepEqual(lees(), { env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: 'true' } })
})

test('takenlijst: kapotte JSON geeft exit 2 en schrijft niets', () => {
  fs.writeFileSync(bestand, '{ kapot')
  for (const a of ['aan', 'uit', 'status']) {
    const r = cli(['takenlijst', a])
    assert.equal(r.status, 2)
  }
  assert.equal(fs.readFileSync(bestand, 'utf8'), '{ kapot')
  assert.deepEqual(rest(), [])
  assert.equal(cli(['takenlijst', 'misschien']).status, 1)
})
