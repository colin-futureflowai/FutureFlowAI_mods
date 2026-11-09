// node --test futureflow/tests/connectors-lib.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { getal, perServer, procent, totalen } from '../lib/connectors.mjs'

const T = (serverName, tokens, isLoaded = true) => ({ name: `mcp__${serverName}__t${tokens}`, serverName, tokens, isLoaded })

test('perServer telt tools en tokens per server, gesorteerd op tokens aflopend', () => {
  const rijen = perServer([T('a', 100), T('b', 500), T('a', 300, false), T('b', 50)], [])
  assert.deepEqual(rijen, [
    { server: 'b', tools: 2, tokens: 550, inContext: 550, uit: false },
    { server: 'a', tools: 2, tokens: 400, inContext: 100, uit: false },
  ])
})

test('uitgezette servers staan erin, ook zonder tools (tokens 0)', () => {
  const rijen = perServer([T('a', 100)], ['a', 'claude.ai Gmail'])
  assert.deepEqual(rijen, [
    { server: 'a', tools: 1, tokens: 100, inContext: 100, uit: true },
    { server: 'claude.ai Gmail', tools: 0, tokens: 0, inContext: 0, uit: true },
  ])
})

test('ook: servers zonder tools die toch getoond worden', () => {
  assert.deepEqual(perServer([], [], ['x']), [{ server: 'x', tools: 0, tokens: 0, inContext: 0, uit: false }])
})

test('foute invoer crasht niet', () => {
  assert.deepEqual(perServer(null, null), [])
  assert.deepEqual(perServer([null, {}, { serverName: 5 }, { serverName: 'a', tokens: 'veel' }], [3, 'b']), [
    { server: 'a', tools: 1, tokens: 0, inContext: 0, uit: false },
    { server: 'b', tools: 0, tokens: 0, inContext: 0, uit: true },
  ])
})

test('totalen, getal en procent', () => {
  assert.deepEqual(totalen(perServer([T('a', 100), T('b', 500, false)], [])), { tokens: 600, inContext: 100 })
  assert.equal(getal(1234567), '1.234.567')
  assert.equal(getal(12), '12')
  assert.equal(getal(NaN), '0')
  assert.equal(procent(12000, 200000), '6%')
  assert.equal(procent(100, 200000), '<1%')
  assert.equal(procent(0, 200000), '0%')
  assert.equal(procent(5, 0), '0%')
})
