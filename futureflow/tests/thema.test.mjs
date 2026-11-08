import { test } from 'node:test'
import assert from 'node:assert/strict'

import { modusVoor, palet, woordmerkSvg, balkTekst } from '../lib/thema.mjs'

test('modusVoor: lichte thema-namen worden licht', () => {
  assert.equal(modusVoor('light'), 'licht')
  assert.equal(modusVoor('light-daltonized'), 'licht')
  assert.equal(modusVoor('light-ansi'), 'licht')
})

test('modusVoor: donkere, onbekende en ontbrekende waarden worden donker', () => {
  assert.equal(modusVoor('dark'), 'donker')
  assert.equal(modusVoor('dark-ansi'), 'donker')
  assert.equal(modusVoor('auto'), 'donker')
  assert.equal(modusVoor(undefined), 'donker')
  assert.equal(modusVoor(42), 'donker')
})

test('palet: licht en donker kleuren', () => {
  assert.equal(palet('licht').groen, '#32a029')
  assert.equal(palet('donker').inkt, '#e9ece9')
})

test('palet: alle sleutels per modus', () => {
  const sleutels = ['groen', 'groenZacht', 'inkt', 'mut', 'lijn', 'achtergrond', 'vlak', 'rood', 'roodZacht', 'oranje']
  assert.deepEqual(Object.keys(palet('licht')).sort(), [...sleutels].sort())
  assert.deepEqual(Object.keys(palet('donker')).sort(), [...sleutels].sort())
  assert.deepEqual(palet('licht'), {
    groen: '#32a029', groenZacht: '#e8f5e6', inkt: '#3D3D3D', mut: '#7a807a', lijn: '#e3e6e3',
    achtergrond: '#ffffff', vlak: '#f6f7f6', rood: '#d4483b', roodZacht: '#fbe7e5', oranje: '#d99a1e',
  })
  assert.deepEqual(palet('donker'), {
    groen: '#32a029', groenZacht: '#16301a', inkt: '#e9ece9', mut: '#8d958d', lijn: '#2b302b',
    achtergrond: '#121412', vlak: '#1b1e1b', rood: '#e5675b', roodZacht: '#3a1d1a', oranje: '#e0a93a',
  })
})

test('woordmerkSvg: svg met FutureFlow in inkt en groen AI', () => {
  const svg = woordmerkSvg('licht', 200)
  assert.ok(svg.startsWith('<svg'))
  assert.ok(svg.includes('FutureFlow'))
  assert.ok(svg.includes('>AI<'))
  assert.ok(svg.includes('fill="#32a029"'))
  assert.ok(svg.includes('fill="#3D3D3D"'))
  assert.ok(svg.length < 131072)
})

test('woordmerkSvg: donker gebruikt de donkere inkt', () => {
  assert.ok(woordmerkSvg('donker', 200).includes('fill="#e9ece9"'))
})

test('balkTekst: fractie wordt geklemd op 0..1', () => {
  assert.equal(balkTekst(0.57, 7), '▰▰▰▰▱▱▱')
  assert.equal(balkTekst(-1, 4), '▱▱▱▱')
  assert.equal(balkTekst(2, 4), '▰▰▰▰')
})
