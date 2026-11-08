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
