import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blokjes, doelVan, duur, huidige, pasToe, percentage, positie, telling } from '../lib/voortgang.mjs'

const OPDRACHT = 'Bouw de voortgangsbalk\nmet drie bronnen'

function drieTaken() {
  let l = null
  for (const [i, subject] of ['Lib', 'Hook', 'Tests'].entries()) {
    l = pasToe(l, 'TaskCreate', { subject, description: '' }, { task: { id: String(i + 1), subject } }, 1000, OPDRACHT)
  }
  return l
}

test('doelVan: eerste regel, max 60 tekens met …', () => {
  assert.equal(doelVan(OPDRACHT), 'Bouw de voortgangsbalk')
  assert.equal(doelVan('\n\n  tweede  \nderde'), 'tweede')
  const lang = doelVan('x'.repeat(100))
  assert.equal(lang.length, 60)
  assert.ok(lang.endsWith('…'))
  assert.equal(doelVan(''), '')
  assert.equal(doelVan(undefined), '')
})

test('TaskCreate bouwt een lijst met id uit het resultaat en doel uit de opdracht', () => {
  const l = drieTaken()
  assert.equal(l.doel, 'Bouw de voortgangsbalk')
  assert.equal(l.begin, 1000)
  assert.deepEqual(l.stappen.map((s) => [s.id, s.titel, s.status]), [['1', 'Lib', 'open'], ['2', 'Hook', 'open'], ['3', 'Tests', 'open']])
})

test('TaskCreate zonder id in het resultaat telt zelf; ook taskId en id worden gelezen', () => {
  let l = pasToe(null, 'TaskCreate', { subject: 'a' }, undefined, 0, '')
  l = pasToe(l, 'TaskCreate', { subject: 'b' }, 'Task #2 created', 0, '')
  l = pasToe(l, 'TaskCreate', { subject: 'c' }, { taskId: '7' }, 0, '')
  l = pasToe(l, 'TaskCreate', { subject: 'd' }, { id: 9 }, 0, '')
  assert.deepEqual(l.stappen.map((s) => s.id), ['1', '2', '7', '9'])
})

test('TaskUpdate: statussen, nieuwe titel en verwijderen', () => {
  let l = drieTaken()
  l = pasToe(l, 'TaskUpdate', { taskId: '1', status: 'completed' }, {}, 0, '')
  l = pasToe(l, 'TaskUpdate', { taskId: '2', status: 'in_progress', subject: 'Hook bouwen' }, {}, 0, '')
  assert.deepEqual(l.stappen.map((s) => s.status), ['klaar', 'bezig', 'open'])
  assert.equal(l.stappen[1].titel, 'Hook bouwen')
  assert.equal(percentage(l), 33)
  assert.equal(huidige(l).titel, 'Hook bouwen')
  assert.equal(positie(l), 2)
  assert.deepEqual(telling(l), { klaar: 1, bezig: 1, open: 1 })
  l = pasToe(l, 'TaskUpdate', { taskId: '2', status: 'pending' }, {}, 0, '')
  assert.equal(l.stappen[1].status, 'open')
  l = pasToe(l, 'TaskUpdate', { taskId: '3', status: 'deleted' }, {}, 0, '')
  assert.equal(l.stappen.length, 2)
  l = pasToe(l, 'TaskUpdate', { taskId: '1', status: 'deleted' }, {}, 0, '')
  l = pasToe(l, 'TaskUpdate', { taskId: '2', status: 'deleted' }, {}, 0, '')
  assert.equal(l, null)
})

test('TodoWrite vervangt de lijst', () => {
  const l = pasToe(drieTaken(), 'TodoWrite', {
    todos: [
      { content: 'Eén', status: 'completed', activeForm: '' },
      { content: 'Twee', status: 'in_progress', activeForm: '' },
    ],
  }, {}, 5000, 'Iets anders')
  assert.deepEqual(l.stappen.map((s) => [s.titel, s.status]), [['Eén', 'klaar'], ['Twee', 'bezig']])
  assert.equal(l.doel, 'Iets anders')
  // De oude lijst liep nog: de begintijd blijft.
  assert.equal(l.begin, 1000)
  assert.equal(pasToe(l, 'TodoWrite', { todos: [] }, {}, 0, ''), null)
})

test('update_plan: items vervangen; advance, done en start', () => {
  let l = pasToe(null, 'mcp__ccd_turn__update_plan', {
    items: [
      { content: 'Kijken', status: 'in_progress' },
      { content: 'Bouwen', status: 'pending' },
      { content: 'Testen', status: 'pending' },
      { content: 'Commit', status: 'pending' },
    ],
    scope: 'first_task',
  }, undefined, 2000, 'Plan')
  assert.equal(l.begin, 2000)
  assert.equal(l.doel, 'Plan')
  l = pasToe(l, 'mcp__ccd_turn__update_plan', { advance: true }, undefined, 0, '')
  assert.deepEqual(l.stappen.map((s) => s.status), ['klaar', 'bezig', 'open', 'open'])
  l = pasToe(l, 'mcp__ccd_turn__update_plan', { done: [2], start: 4 }, undefined, 0, '')
  assert.deepEqual(l.stappen.map((s) => s.status), ['klaar', 'klaar', 'open', 'bezig'])
  l = pasToe(l, 'mcp__ccd_turn__update_plan', { done: [3, 4] }, undefined, 0, '')
  assert.equal(percentage(l), 100)
  assert.equal(huidige(l), undefined)
  assert.equal(positie(l), 0)
})

test('100% → percentage 100; een nieuwe taak daarna begint een nieuwe lijst', () => {
  let l = drieTaken()
  for (const id of ['1', '2', '3']) l = pasToe(l, 'TaskUpdate', { taskId: id, status: 'completed' }, {}, 0, '')
  assert.equal(percentage(l), 100)
  const nieuw = pasToe(l, 'TaskCreate', { subject: 'Volgende' }, { task: { id: '4' } }, 9000, 'Nieuwe opdracht')
  assert.equal(nieuw.stappen.length, 1)
  assert.equal(nieuw.begin, 9000)
  assert.equal(nieuw.doel, 'Nieuwe opdracht')
})

test('foute invoer laat de lijst ongewijzigd', () => {
  const l = drieTaken()
  const gevallen = [
    ['TaskCreate', null],
    ['TaskCreate', 'tekst'],
    ['TaskCreate', {}],
    ['TaskCreate', { subject: 42 }],
    ['TaskUpdate', {}],
    ['TaskUpdate', { taskId: 'bestaat-niet', status: 'completed' }],
    ['TaskUpdate', { taskId: '1', status: 'vreemd' }],
    ['TodoWrite', {}],
    ['TodoWrite', { todos: 'geen lijst' }],
    ['TodoWrite', { todos: [null] }],
    ['TodoWrite', { todos: [{ status: 'pending' }] }],
    ['mcp__ccd_turn__update_plan', { items: 'x' }],
    ['mcp__ccd_turn__update_plan', { items: [{ content: '' }] }],
    ['mcp__ccd_turn__update_plan', { done: 'x' }],
    ['mcp__ccd_turn__update_plan', { done: [0, 99] }],
    ['mcp__ccd_turn__update_plan', { start: 'twee' }],
    ['Bash', { command: 'ls' }],
  ]
  for (const [tool, input] of gevallen) assert.equal(pasToe(l, tool, input, null, 0, ''), l, `${tool} ${JSON.stringify(input)}`)
  // Zonder lijst: TaskUpdate en update_plan zonder items doen niets.
  assert.equal(pasToe(null, 'TaskUpdate', { taskId: '1', status: 'completed' }, {}, 0, ''), null)
  assert.equal(pasToe(null, 'mcp__ccd_turn__update_plan', { advance: true }, {}, 0, ''), null)
  // Een kapotte lijst zelf geeft geen fout.
  assert.doesNotThrow(() => pasToe({ stappen: null }, 'TaskUpdate', { taskId: '1', status: 'completed' }, {}, 0, ''))
})

test('blokjes en duur', () => {
  let l = pasToe(null, 'TodoWrite', { todos: Array.from({ length: 7 }, (_, i) => ({ content: `s${i}`, status: i < 4 ? 'completed' : 'pending' })) }, {}, 0, '')
  assert.equal(percentage(l), 57)
  assert.deepEqual(blokjes(l), { vol: '▰▰▰▰', leeg: '▱▱▱' })
  assert.equal(positie(l), 5)
  l = pasToe(null, 'TodoWrite', { todos: Array.from({ length: 30 }, (_, i) => ({ content: `s${i}`, status: i < 15 ? 'completed' : 'pending' })) }, {}, 0, '')
  assert.deepEqual(blokjes(l), { vol: '▰'.repeat(6), leeg: '▱'.repeat(6) })
  assert.equal(duur(12_000), '12 s')
  assert.equal(duur(4 * 60_000 + 5000), '4 min')
  assert.equal(duur(65 * 60_000), '1 u 5 min')
  assert.equal(duur(120 * 60_000), '2 u')
  assert.equal(duur(NaN), '0 s')
})
