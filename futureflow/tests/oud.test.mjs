import { test } from 'node:test'
import assert from 'node:assert/strict'

import { oudePlugins } from '../lib/oud.mjs'

const S = 'agent-slots@futureflowai-mods'
const M = 'minify@futureflowai-mods'
const installed = { plugins: { [S]: [{}], [M]: [{}] } }

test('beide oud aanwezig en aan', () => {
  assert.deepEqual(oudePlugins(installed, { enabledPlugins: {} }), { slots: true, minify: true })
})

test('uitgeschakeld telt als afwezig', () => {
  assert.deepEqual(oudePlugins(installed, { enabledPlugins: { [M]: false } }), { slots: true, minify: false })
})

test('ontbrekend of kapot telt als afwezig', () => {
  const geen = { slots: false, minify: false }
  assert.deepEqual(oudePlugins(undefined, undefined), geen)
  assert.deepEqual(oudePlugins('x', null), geen)
  assert.deepEqual(oudePlugins({}, {}), geen)
})

test('alleen futureflow', () => {
  const only = { plugins: { 'futureflow@futureflowai-mods': [{}] } }
  assert.deepEqual(oudePlugins(only, {}), { slots: false, minify: false })
})

test('hoogste niveau zonder plugins-sleutel', () => {
  assert.deepEqual(oudePlugins({ [S]: [{}] }, {}), { slots: true, minify: false })
})

// Gesynchroniseerde kopieen (claude.ai) staan niet in installed_plugins.json, alleen als map onder plugins/synced.
test('synced kopie aan telt als aanwezig, ook zonder installed_plugins.json', () => {
  assert.deepEqual(oudePlugins(undefined, {}, ['agent-slots', 'minify']), { slots: true, minify: true })
  assert.deepEqual(oudePlugins({}, { enabledPlugins: {} }, ['minify']), { slots: false, minify: true })
})

test('synced kopie uitgeschakeld telt als afwezig', () => {
  const settings = { enabledPlugins: { 'agent-slots@synced': false, 'minify@synced': false } }
  assert.deepEqual(oudePlugins(undefined, settings, ['agent-slots', 'minify']), { slots: false, minify: false })
  assert.deepEqual(oudePlugins(undefined, { enabledPlugins: { 'minify@synced': false } }, ['agent-slots', 'minify']), { slots: true, minify: false })
})

test('synced map met achtervoegsel ~g2 telt, minifyx en andere namen niet', () => {
  assert.deepEqual(oudePlugins(undefined, {}, ['minify~g2', 'agent-slots~g2']), { slots: true, minify: true })
  assert.deepEqual(oudePlugins(undefined, {}, ['minifyx', 'agent-slotsx', 'xminify', 'minify-x']), { slots: false, minify: false })
})

test('ongeldige synced telt als leeg; futureflowai-mods blijft werken', () => {
  const geen = { slots: false, minify: false }
  assert.deepEqual(oudePlugins(undefined, {}, 'minify'), geen)
  assert.deepEqual(oudePlugins(undefined, {}, null), geen)
  assert.deepEqual(oudePlugins(installed, {}, [1, null, {}]), { slots: true, minify: true })
})
