import { test } from 'node:test'
import assert from 'node:assert/strict'

import { beurtDuur, diffRegels, duurTekst, icoonVoor, invoerVelden, korteInvoer, resultaatTekst, schoonTekst, shellUitvoer, telling, toolLabel, wijzigRegels } from '../lib/skin.mjs'

test('icoonVoor: bekende tools, mcp en onbekend', () => {
  assert.equal(icoonVoor('Read'), 'R')
  assert.equal(icoonVoor('Edit'), 'E')
  assert.equal(icoonVoor('Bash'), '$')
  assert.equal(icoonVoor('mcp__x__y'), '◇')
  assert.equal(icoonVoor('Onbekend'), '•')
})

test('duurTekst: seconden met komma, minuten met twee cijfers', () => {
  assert.equal(duurTekst(400), '0,4 s')
  assert.equal(duurTekst(65000), '1 m 05 s')
})

test('diffRegels: regel-diff met nummers', () => {
  assert.deepEqual(diffRegels('a\nb', 'a\nc'), [
    { soort: ' ', tekst: 'a', nr: 1 },
    { soort: '-', tekst: 'b', nr: 2 },
    { soort: '+', tekst: 'c', nr: 2 },
  ])
})

test('diffRegels: 500 gewijzigde regels worden afgekapt op max', () => {
  const oud = Array.from({ length: 500 }, (_, i) => `oud ${i}`).join('\n')
  const nieuw = Array.from({ length: 500 }, (_, i) => `nieuw ${i}`).join('\n')
  const regels = diffRegels(oud, nieuw, 200)
  assert.equal(regels.length, 201)
  assert.ok(regels.at(-1).tekst.startsWith('… '))
  assert.equal(regels.at(-1).nr, 0)
})

test('diffRegels: gigantische invoer blijft snel en begrensd', () => {
  const oud = Array.from({ length: 5000 }, (_, i) => `a${i}`).join('\n')
  const nieuw = Array.from({ length: 5000 }, (_, i) => `b${i}`).join('\n')
  const regels = diffRegels(oud, nieuw)
  assert.equal(regels.length, 201)
})

test('telling telt + en -', () => {
  assert.deepEqual(telling(diffRegels('a\nb\nc', 'a\nx\ny')), { plus: 2, min: 2 })
  assert.deepEqual(telling([]), { plus: 0, min: 0 })
})

test('wijzigRegels: leest structuredPatch, anders oldString/newString of content', () => {
  const patch = { filePath: '/p/a.ts', structuredPatch: [{ oldStart: 3, newStart: 3, lines: [' a', '-b', '+c'] }] }
  assert.deepEqual(wijzigRegels(patch), [
    { soort: ' ', tekst: 'a', nr: 3 },
    { soort: '-', tekst: 'b', nr: 4 },
    { soort: '+', tekst: 'c', nr: 4 },
  ])
  assert.deepEqual(telling(wijzigRegels({ filePath: '/p', oldString: 'x', newString: 'y' })), { plus: 1, min: 1 })
  assert.deepEqual(telling(wijzigRegels({ filePath: '/p', type: 'create', content: 'een\ntwee' })), { plus: 2, min: 0 })
  assert.equal(wijzigRegels(null), null)
  assert.equal(wijzigRegels('fout'), null)
})

test('korteInvoer: commando, pad of patroon, afgekapt op 80', () => {
  assert.equal(korteInvoer('Bash', { command: 'ls -la' }), 'ls -la')
  assert.equal(korteInvoer('Read', { file_path: '/x/y.ts' }), '/x/y.ts')
  assert.equal(korteInvoer('Grep', { pattern: 'foo' }), 'foo')
  const lang = korteInvoer('Bash', { command: 'x'.repeat(200) })
  assert.equal(lang.length, 80)
  assert.ok(lang.endsWith('…'))
  assert.equal(korteInvoer('Bash', { command: 'a\n  b' }), 'a b')
})

test('beurtDuur: zoals Claude Code', () => {
  assert.equal(beurtDuur(3000), '3s')
  assert.equal(beurtDuur(64000), '1m 4s')
})

test('resultaatTekst, invoerVelden en toolLabel', () => {
  assert.equal(resultaatTekst({ stdout: 'a', stderr: 'b' }), 'a\nb')
  assert.equal(resultaatTekst({ file: { content: 'x' } }), 'x')
  assert.ok(resultaatTekst('y'.repeat(5000)).includes('1000 tekens meer'))
  assert.deepEqual(invoerVelden({ command: 'ls', n: 2 }), [['command', 'ls'], ['n', '2']])
  assert.deepEqual(invoerVelden(undefined), [])
  assert.equal(toolLabel('mcp__github__search_code'), 'github:search_code')
  assert.equal(toolLabel('Bash'), 'Bash')
})

test('schoonTekst haalt escapes en stuurtekens weg, \\n en \\t blijven', () => {
  assert.equal(schoonTekst('a\u001b]0;evil\u0007b'), 'ab')
  assert.equal(schoonTekst('\u001b[31mrood\u001b[0m'), 'rood')
  assert.equal(schoonTekst('x\u009b31my'), 'x31my')
  assert.equal(schoonTekst('bel\u0007 cr\r!'), 'bel cr!')
  assert.equal(schoonTekst('een\ntwee\tdrie'), 'een\ntwee\tdrie')
  assert.equal(schoonTekst('\u001bP1;2q\u001b\\ok'), 'ok')
})

test('alles wat getoond wordt is schoon', () => {
  const vies = 'a\u001b]0;evil\u0007b\u001b[2J'
  assert.equal(korteInvoer('Bash', { command: vies }), 'ab')
  assert.deepEqual(invoerVelden({ command: vies }), [['command', 'ab']])
  assert.equal(resultaatTekst(vies), 'ab')
  assert.equal(shellUitvoer({ stdout: vies, stderr: vies, interrupted: false }, false).stdout, 'ab')
  assert.equal(shellUitvoer({ stdout: vies, stderr: vies, interrupted: false }, false).stderr, 'ab')
  assert.equal(diffRegels('x', vies)[1].tekst, 'ab')
  assert.equal(wijzigRegels({ structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['+' + vies] }] })[0].tekst, 'ab')
})

test('ook sleutels en mcp-namen zijn schoon', () => {
  assert.deepEqual(invoerVelden({ 'a\u001b]0;x\u0007b': 'v' }), [['ab', 'v']])
  assert.equal(toolLabel('mcp__s\u001b[31m__t\u0007'), 's:t')
})
