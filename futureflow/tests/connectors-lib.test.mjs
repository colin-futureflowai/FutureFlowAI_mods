// node --test futureflow/tests/connectors-lib.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { getal, perServer, procent, totalen, verdeel, wisselbaar } from '../lib/connectors.mjs'

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

test('wisselbaar: claude.ai, plugin: en eigen configuratie; app- en mod-servers niet', () => {
  const eigen = ['n8n-mcp', 'kie-ai']
  for (const s of ['claude.ai Gmail', 'plugin:context7:context7', 'n8n-mcp', 'kie-ai']) assert.equal(wisselbaar(s, eigen), true, s)
  for (const s of ['ccd_session', 'ccd_turn', 'Claude_Browser', 'Claude_Code_iOS_Simulator', 'terminal', 'visualize', 'futureflow', 'plugin-authoring', 'mcp-registry', 'scheduled-tasks', '', undefined]) {
    assert.equal(wisselbaar(s, eigen), false, String(s))
  }
  assert.equal(wisselbaar('n8n-mcp', undefined), false)
})

test('verdeel: knoppen voor wisselbare en uitgezette servers, de rest als één optelsom', () => {
  const rijen = perServer(
    [T('ccd_session', 900), T('ccd_turn', 100, false), T('Claude_Browser', 400), T('futureflow', 50), T('n8n-mcp', 300), T('claude.ai Gmail', 200)],
    ['terminal'],
  )
  const { eigen, intern } = verdeel(rijen, ['n8n-mcp'])
  assert.deepEqual(eigen.map(r => r.server), ['n8n-mcp', 'claude.ai Gmail', 'terminal'])
  assert.deepEqual(intern, { servers: 4, tools: 4, tokens: 1450, inContext: 1350 })
  // Het totaal blijft over alle rijen.
  assert.deepEqual(totalen(rijen), { tokens: 1950, inContext: 1850 })
})
