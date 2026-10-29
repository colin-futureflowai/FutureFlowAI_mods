import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { herinnering, regelsVoor, subagentRegel } from '../lib/regels.mjs'

const SCRIPT = new URL('../bin/regels.sh', import.meta.url).pathname

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

const draai = (dir, soort, sessie = 's1') =>
  execFileSync('sh', [SCRIPT, soort], { input: JSON.stringify({ session_id: sessie, hook_event_name: 'x', prompt: 'hoi "daar"' }), env: { MINIFY_HOME: dir, PATH: '/usr/bin:/bin' } }).toString()

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
