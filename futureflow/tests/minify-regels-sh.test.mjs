import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { herinnering, regelsVoor, subagentRegel } from '../lib/regels.mjs'

const SCRIPT = new URL('../scripts/regels.sh', import.meta.url).pathname

// Een nep-~/.claude/minify met de bestanden die de mod schrijft.
function thuis({ niveau, standaard } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'minify-'))
  mkdirSync(join(dir, 'regels'))
  mkdirSync(join(dir, 'niveau'))
  for (const n of ['O1', 'O2', 'O3']) {
    writeFileSync(join(dir, 'regels', `${n}.md`), regelsVoor(n) + '\n')
    writeFileSync(join(dir, 'regels', `${n}.kort.md`), herinnering(n) + '\n')
    writeFileSync(join(dir, 'regels', `${n}.subagent.md`), subagentRegel(n) + '\n')
  }
  if (niveau) writeFileSync(join(dir, 'niveau', 's1'), niveau)
  if (standaard) writeFileSync(join(dir, 'standaard'), standaard)
  return dir
}

const draai = (dir, soort, sessie = 's1', extra = {}) =>
  execFileSync('sh', [SCRIPT, soort], { input: JSON.stringify({ session_id: sessie, hook_event_name: 'x', prompt: 'hoi "daar"' }), env: { MINIFY_HOME: dir, PATH: '/usr/bin:/bin', ...extra } }).toString()

// Een nep-~/.claude/futureflow met het bestand `oud` dat de mod schrijft.
function futureflowThuis(oud) {
  const dir = mkdtempSync(join(tmpdir(), 'futureflow-'))
  writeFileSync(join(dir, 'oud'), oud)
  return dir
}

test('start: volledige regels van het niveau van de sessie', () => {
  const dir = thuis({ niveau: 'O3' })
  const uit = draai(dir, 'start')
  assert.match(uit, /# minify -O3/)
  assert.equal(readFileSync(join(dir, 'gemeld', 's1'), 'utf8'), 'O3')
})

test('prompt: eerst volledig, daarna alleen de korte herinnering, na een wissel weer volledig', () => {
  const dir = thuis({ niveau: 'O2' })
  assert.match(draai(dir, 'prompt'), /# minify -O2/)
  const tweede = draai(dir, 'prompt')
  assert.match(tweede, /^\[minify -O2\]/)
  assert.ok(tweede.length < 600)
  writeFileSync(join(dir, 'niveau', 's1'), 'O1')
  assert.match(draai(dir, 'prompt'), /# minify -O1/)
})

test('uit: niets', () => {
  const dir = thuis({ niveau: 'uit' })
  assert.equal(draai(dir, 'start'), '')
  assert.equal(draai(dir, 'prompt'), '')
})

test('onbekende sessie valt terug op de standaard, en anders O2', () => {
  assert.match(draai(thuis({ standaard: 'O3' }), 'start', 'ander'), /# minify -O3/)
  assert.match(draai(thuis(), 'start', 'ander'), /# minify -O2/)
  assert.equal(draai(thuis({ standaard: 'uit' }), 'start', 'ander'), '')
})

test('zonder regelbestanden zegt het script niets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'minify-leeg-'))
  assert.equal(draai(dir, 'start'), '')
})

test('subagent: geldige JSON met de regel voor het eindrapport', () => {
  const uit = JSON.parse(draai(thuis({ niveau: 'O2' }), 'subagent'))
  assert.equal(uit.hookSpecificOutput.hookEventName, 'SubagentStart')
  assert.equal(uit.hookSpecificOutput.additionalContext, subagentRegel('O2') + '\n')
})

test('een session_id met vreemde tekens wordt geen pad', () => {
  const dir = thuis({ niveau: 'O3', standaard: 'O1' })
  assert.match(draai(dir, 'start', '../niveau/s1'), /# minify -O1/)
})

test('zwijgt als oude minify nog aan staat', () => {
  const ff = futureflowThuis('slots,minify')
  const dir = thuis({ niveau: 'O2' })
  for (const soort of ['start', 'prompt', 'subagent']) assert.equal(draai(dir, soort, 's1', { FUTUREFLOW_HOME: ff }), '')
})

test('praat als alleen slots oud is', () => {
  const ff = futureflowThuis('slots')
  const dir = thuis({ niveau: 'O2' })
  assert.match(draai(dir, 'start', 's1', { FUTUREFLOW_HOME: ff }), /# minify -O2/)
})

// Zonder `oud`-bestand (eerste sessie ooit) beslist het script zelf, uit installed_plugins.json en settings.json.
const OUD = 'minify@futureflowai-mods'
function nepHome({ installed, settings } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'home-'))
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true })
  if (installed) writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), installed)
  if (settings) writeFileSync(join(home, '.claude', 'settings.json'), settings)
  return home
}
const zonderOud = (home) => draai(thuis({ niveau: 'O2' }), 'start', 's1', { HOME: home })

test('zonder oud-bestand: oude minify geinstalleerd en niet uitgezet -> zwijgt', () => {
  const home = nepHome({ installed: JSON.stringify({ plugins: { [OUD]: [{}] } }) })
  assert.equal(zonderOud(home), '')
  const mee = nepHome({ installed: JSON.stringify({ plugins: { [OUD]: [{}] } }), settings: JSON.stringify({ enabledPlugins: { [OUD]: true } }) })
  assert.equal(zonderOud(mee), '')
})

test('zonder oud-bestand: oude minify uitgezet in settings -> praat', () => {
  const installed = JSON.stringify({ plugins: { [OUD]: [{}] } })
  assert.match(zonderOud(nepHome({ installed, settings: `{ "enabledPlugins": { "${OUD}": false } }` })), /# minify -O2/)
  assert.match(zonderOud(nepHome({ installed, settings: `{\n "enabledPlugins": {\n "${OUD}" :\n   false\n }\n}` })), /# minify -O2/)
})

test('zonder oud-bestand en zonder installed_plugins.json -> praat', () => {
  assert.match(zonderOud(nepHome()), /# minify -O2/)
})

test('met leeg oud-bestand telt installed_plugins.json niet mee -> praat', () => {
  const home = nepHome({ installed: JSON.stringify({ plugins: { [OUD]: [{}] } }) })
  const ff = futureflowThuis('')
  assert.match(draai(thuis({ niveau: 'O2' }), 'start', 's1', { HOME: home, FUTUREFLOW_HOME: ff }), /# minify -O2/)
})

// Gesynchroniseerde kopie van minify (claude.ai): map onder plugins/synced/<account>/, niet in installed_plugins.json.
function syncedHome(map, settings) {
  const home = nepHome({ settings })
  mkdirSync(join(home, '.claude', 'plugins', 'synced', 'acc1', map), { recursive: true })
  return home
}

test('zonder oud-bestand: synced minify-map, niet uitgezet -> zwijgt', () => {
  assert.equal(zonderOud(syncedHome('minify')), '')
  assert.equal(zonderOud(syncedHome('minify~g2')), '')
  assert.equal(zonderOud(syncedHome('minify', JSON.stringify({ enabledPlugins: { 'minify@synced': true } }))), '')
})

test('zonder oud-bestand: synced minify uitgezet in settings -> praat', () => {
  assert.match(zonderOud(syncedHome('minify', '{ "enabledPlugins": { "minify@synced": false } }')), /# minify -O2/)
  assert.match(zonderOud(syncedHome('minify~g2', '{\n "enabledPlugins": {\n "minify@synced" :\n   false\n }\n}')), /# minify -O2/)
})

test('zonder oud-bestand: map minifyx of andere synced plugin telt niet -> praat', () => {
  assert.match(zonderOud(syncedHome('minifyx')), /# minify -O2/)
  assert.match(zonderOud(syncedHome('agent-slots')), /# minify -O2/)
})
