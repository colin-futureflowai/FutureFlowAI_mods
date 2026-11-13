// node --test futureflow/tests/proxy-lib.test.mjs
// Pure regels van de proxy voor claude-or (lib/proxy.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  aanvraagInfo, doorHeaders, foutAntwoord, gebruikUitJson, geldigeHost, isEigenPad, LOG_MAX_BYTES, logRegel, maakSseLezer,
  PROXY_POORT, PROXY_STIL_MS, PROXY_VERSIE, proxyUrl, RAAK_GRENS, TELT_MIN_TOKENS, TELT_VENSTER_MS, werkStandBij,
} from '../lib/proxy.mjs'

const NU = Date.parse('2026-11-13T12:00:00Z')

test('constanten; versie gelijk aan plugin.json', () => {
  const plugin = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'))
  assert.equal(PROXY_VERSIE, plugin.version)
  assert.equal(PROXY_POORT, 20817)
  assert.equal(PROXY_STIL_MS, 1_800_000)
  assert.equal(LOG_MAX_BYTES, 10 * 1024 * 1024)
  assert.equal(TELT_VENSTER_MS, 300_000)
  assert.equal(TELT_MIN_TOKENS, 1024)
  assert.equal(RAAK_GRENS, 50)
  assert.equal(proxyUrl(), 'http://127.0.0.1:20817')
  assert.equal(proxyUrl(4000), 'http://127.0.0.1:4000')
})

test('doorHeaders: hop-by-hop en proxy-headers weg, key en sessie blijven, accept-encoding identity', () => {
  const uit = doorHeaders({
    Host: 'x', Authorization: 'Bearer k', 'Accept-Encoding': 'gzip', 'x-session-id': 's', 'Proxy-Authorization': 'p',
    Connection: 'keep-alive', 'content-length': '12', 'Transfer-Encoding': 'chunked', 'x-api-key': 'k2', 'anthropic-version': '2023-06-01', leeg: undefined,
  })
  assert.equal(uit.Authorization, 'Bearer k')
  assert.equal(uit['x-session-id'], 's')
  assert.equal(uit['x-api-key'], 'k2')
  assert.equal(uit['anthropic-version'], '2023-06-01')
  assert.equal(uit['accept-encoding'], 'identity')
  const namen = Object.keys(uit).map(k => k.toLowerCase())
  for (const weg of ['host', 'proxy-authorization', 'connection', 'content-length', 'transfer-encoding', 'leeg']) assert.ok(!namen.includes(weg), weg)
  assert.equal(namen.filter(n => n === 'accept-encoding').length, 1)
})

test('aanvraagInfo: model, stream en baan; zelfde system als blokken geeft dezelfde baan', () => {
  const a = aanvraagInfo('{"model":"a/b","stream":true,"system":"S","tools":[{"name":"Read"}]}')
  assert.equal(a.model, 'a/b')
  assert.equal(a.stream, true)
  assert.match(a.baan, /^[0-9a-f]{8}$/)
  const b = aanvraagInfo(JSON.stringify({ model: 'a/b', system: [{ type: 'text', text: 'S' }], tools: [{ name: 'Read' }] }))
  assert.equal(b.baan, a.baan)
  assert.equal(b.stream, false)
  assert.notEqual(aanvraagInfo(JSON.stringify({ model: 'a/b', system: 'S', tools: [{ name: 'Write' }] })).baan, a.baan)
  assert.notEqual(aanvraagInfo(JSON.stringify({ model: 'a/b', system: 'T', tools: [{ name: 'Read' }] })).baan, a.baan)
  // Alleen de eerste 2000 tekens van de systeemprompt tellen.
  const lang = 'x'.repeat(2000)
  assert.equal(aanvraagInfo(JSON.stringify({ system: `${lang}a` })).baan, aanvraagInfo(JSON.stringify({ system: `${lang}b` })).baan)
  assert.deepEqual(aanvraagInfo('{"model":"a/b"}'), { model: 'a/b', stream: false })
  assert.deepEqual(aanvraagInfo('{kapot'), { stream: false })
  assert.deepEqual(aanvraagInfo(''), { stream: false })
  assert.deepEqual(aanvraagInfo('[1]'), { stream: false })
})

test('gebruikUitJson: usage, aanbieder en kosten; onzin = 0', () => {
  assert.deepEqual(
    gebruikUitJson({ provider: 'Wafer', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 30, cache_creation_input_tokens: 5, cost: 0.01 } }),
    { in: 10, uit: 2, read: 30, write: 5, aanbieder: 'Wafer', kosten: 0.01 },
  )
  assert.deepEqual(gebruikUitJson(null), { in: 0, uit: 0, read: 0, write: 0 })
  assert.deepEqual(gebruikUitJson({ usage: { input_tokens: -3, output_tokens: 'x', cost: -1 } }), { in: 0, uit: 0, read: 0, write: 0 })
  assert.deepEqual(gebruikUitJson({ message: { provider: 'River', usage: { input_tokens: 4 } } }), { in: 4, uit: 0, read: 0, write: 0, aanbieder: 'River' })
})

test('SSE-lezer: regels over chunks verdeeld, message_start + message_delta', () => {
  const stroom = [
    'event: message_start\n',
    `data: ${JSON.stringify({ type: 'message_start', message: { provider: 'Wafer', usage: { input_tokens: 100, cache_read_input_tokens: 400, output_tokens: 1 } } })}\n\n`,
    'event: content_block_delta\n',
    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hoi' } })}\n\n`,
    'event: message_delta\n',
    `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 7 } })}\n\n`,
    'data: [DONE]\n\n',
    'data: {kapot\n\n',
  ].join('')
  const lezer = maakSseLezer()
  // In stukken van 7 tekens: elke data-regel breekt een paar keer.
  for (let i = 0; i < stroom.length; i += 7) lezer.voeg(stroom.slice(i, i + 7))
  assert.deepEqual(lezer.uit(), { in: 100, uit: 7, read: 400, write: 0, aanbieder: 'Wafer' })
  // Zonder aanbieder en met \r\n.
  const l2 = maakSseLezer()
  l2.voeg(`data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 400 } } })}\r\n\r\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\r\n\r\n`)
  assert.deepEqual(l2.uit(), { in: 100, uit: 7, read: 400, write: 0 })
  // Een halve regel telt niet.
  const l3 = maakSseLezer()
  l3.voeg('data: {"type":"message_delta","usage":{"output_to')
  assert.deepEqual(l3.uit(), { in: 0, uit: 0, read: 0, write: 0 })
})

test('logRegel: telling raak, mis en telt-niet', () => {
  const info = { model: 'a/b', stream: false, baan: '01234567' }
  const g = (vol, read, write = 0) => ({ in: vol, uit: 3, read, write })
  const vorige = logRegel({ t: NU - 60_000, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: g(4000, 0, 0), ms: 10 })
  assert.equal(vorige.telling, 'telt-niet')
  assert.equal(vorige.sessie, 's1')
  const raak = logRegel({ t: NU, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: g(1000, 4000), ms: 12, vorige })
  assert.equal(raak.telling, 'raak')
  assert.equal(raak.aandeel, 80)
  assert.deepEqual(Object.keys(raak), ['t', 'sessie', 'pad', 'model', 'baan', 'stream', 'status', 'in', 'uit', 'read', 'write', 'aandeel', 'telling', 'ms'])
  assert.equal(logRegel({ t: NU, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: g(4500, 500), ms: 1, vorige }).telling, 'mis')
  assert.equal(logRegel({ t: NU, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: g(1000, 4000), ms: 1, vorige: { ...vorige, t: NU - 6 * 60_000 } }).telling, 'telt-niet')
  assert.equal(logRegel({ t: NU, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: g(100, 700), ms: 1, vorige }).telling, 'telt-niet')
  // Compact: minder dan de helft van de vorige invoer.
  const groot = { ...vorige, in: 10_000, read: 0, write: 0 }
  assert.equal(logRegel({ t: NU, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: g(1000, 3000), ms: 1, vorige: groot }).telling, 'telt-niet')
  assert.equal(logRegel({ t: NU, sessie: 's1', pad: '/v1/messages', info, status: 429, gebruik: g(1000, 4000), ms: 1, vorige }).telling, 'telt-niet')
  // Zonder sessie, met fout (afgekapt) en kosten.
  const f = logRegel({ t: NU, pad: '/v1/messages', info: { stream: true }, status: 502, gebruik: { in: 0, uit: 0, read: 0, write: 0, kosten: 0.5 }, ms: 3, fout: 'x'.repeat(300) })
  assert.equal(f.sessie, 'onbekend')
  assert.equal(f.aandeel, 0)
  assert.equal(f.fout.length, 200)
  assert.equal(f.kosten, 0.5)
  assert.equal(f.model, undefined)
})

test('werkStandBij: per sessie en model opgeteld; zonder model telt niet', () => {
  const info = { model: 'a/b', stream: false, baan: '01234567' }
  const r1 = logRegel({ t: NU - 1000, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: { in: 4000, uit: 1, read: 0, write: 100, aanbieder: 'Wafer' }, ms: 1 })
  const r2 = logRegel({ t: NU, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: { in: 1000, uit: 1, read: 4000, write: 0, aanbieder: 'River' }, ms: 1, vorige: r1 })
  let stand = werkStandBij({}, r1)
  stand = werkStandBij(stand, r2)
  stand = werkStandBij(stand, logRegel({ t: NU, sessie: 's1', pad: '/v1/models', info: { stream: false }, status: 200, gebruik: gebruikUitJson(null), ms: 1 }))
  assert.deepEqual(stand, { s1: { 'a/b': { aanvragen: 2, raak: 1, mis: 0, in: 9100, read: 4000, aanbieder: 'River', laatst: NU } } })
})

test('geldigeHost en isEigenPad', () => {
  assert.equal(geldigeHost('127.0.0.1:20817', 20817), true)
  assert.equal(geldigeHost('localhost:20817', 20817), true)
  assert.equal(geldigeHost('evil.example:20817', 20817), false)
  assert.equal(geldigeHost('127.0.0.1:1', 20817), false)
  assert.equal(geldigeHost('127.0.0.1', 20817), false)
  assert.equal(geldigeHost(undefined, 20817), false)
  assert.equal(isEigenPad('/'), true)
  assert.equal(isEigenPad('/_ff/stand'), true)
  assert.equal(isEigenPad('/v1/messages'), false)
  assert.equal(isEigenPad('/_ffx'), false)
})

test('foutAntwoord: Anthropic-vorm', () => {
  assert.deepEqual(foutAntwoord('weg'), { type: 'error', error: { type: 'api_error', message: 'weg' } })
})

// ---- plan 9: vaste aanbieder, harde stop, modelwissel (0.17.0) ----

import {
  besluit, geldigeSchrijf, isZwak, kiesAanbieder, metAanbieder, MIS_STOP, MIS_WISSEL, probeerOpnieuw, slechte, SLECHT_MS,
  stopBericht, werkAanbiederBij, wisselModel, zwakMeting,
} from '../lib/proxy.mjs'

test('drempels', () => {
  assert.equal(MIS_WISSEL, 2)
  assert.equal(MIS_STOP, 2)
  assert.equal(SLECHT_MS, 86_400_000)
})

test('werkAanbiederBij, slechte en kiesAanbieder: beste bekende, slecht overgeslagen tot slechtTot', () => {
  let a = {}
  a = werkAanbiederBij(a, 'm/x', 'Wafer', 'raak', NU - 10)
  a = werkAanbiederBij(a, 'm/x', 'Wafer', 'mis', NU - 9)
  a = werkAanbiederBij(a, 'm/x', 'River', 'raak', NU - 8)
  a = werkAanbiederBij(a, 'm/x', 'Sail', 'mis', NU - 7)
  a = werkAanbiederBij(a, 'm/x', 'Sail', 'fout', NU - 6)
  assert.deepEqual(a['m/x'].Wafer, { raak: 1, mis: 1, fout: 0, laatst: NU - 9 })
  assert.deepEqual(a['m/x'].Sail, { raak: 0, mis: 1, fout: 1, laatst: NU - 6 })
  // River 1/1 gaat voor Wafer 1/2; Sail heeft geen raak.
  assert.equal(kiesAanbieder(a, 'm/x', NU), 'River')
  assert.equal(kiesAanbieder(a, 'm/x', NU, ['River']), 'Wafer')
  assert.equal(kiesAanbieder(a, 'm/x', NU, ['River', 'Wafer']), undefined)
  assert.equal(kiesAanbieder(a, 'm/onbekend', NU), undefined)
  a = werkAanbiederBij(a, 'm/x', 'River', 'slecht', NU)
  assert.equal(a['m/x'].River.slechtTot, NU + SLECHT_MS)
  assert.deepEqual(slechte(a, 'm/x', NU + 1), ['River'])
  assert.equal(kiesAanbieder(a, 'm/x', NU + 1), 'Wafer')
  // Na slechtTot telt hij weer mee.
  assert.deepEqual(slechte(a, 'm/x', NU + SLECHT_MS + 1), [])
  assert.equal(kiesAanbieder(a, 'm/x', NU + SLECHT_MS + 1), 'River')
  // Gelijke score: de nieuwste wint.
  let b = werkAanbiederBij({}, 'm/y', 'A', 'raak', 1)
  b = werkAanbiederBij(b, 'm/y', 'B', 'raak', 2)
  assert.equal(kiesAanbieder(b, 'm/y', 3), 'B')
  // Onzin in: geen crash.
  assert.equal(kiesAanbieder(null, 'm/x', NU), undefined)
  assert.deepEqual(slechte(undefined, 'm/x', NU), [])
})

test('metAanbieder: order met vast, ignore zonder vast, eigen provider ongemoeid', () => {
  const body = { model: 'm/x', messages: [] }
  assert.deepEqual(metAanbieder(body, 'Wafer', ['River']), { model: 'm/x', messages: [], provider: { order: ['Wafer'], allow_fallbacks: false } })
  assert.deepEqual(metAanbieder(body, undefined, ['River']), { model: 'm/x', messages: [], provider: { ignore: ['River'] } })
  assert.equal(metAanbieder(body, undefined, []), body)
  const eigen = { model: 'm/x', provider: { only: ['X'] } }
  assert.equal(metAanbieder(eigen, 'Wafer', ['River']), eigen)
  // Het origineel verandert niet.
  assert.deepEqual(body, { model: 'm/x', messages: [] })
})

test('probeerOpnieuw: 429, 404 en 5xx', () => {
  for (const s of [429, 404, 500, 502, 503, 599]) assert.equal(probeerOpnieuw(s), true, String(s))
  for (const s of [200, 400, 401, 403, 413, 600, 0]) assert.equal(probeerOpnieuw(s), false, String(s))
})

test('besluit: mis, mis = wissel; daarna telt-niet, mis, mis = stop; mis, raak, mis = niets', () => {
  let b = besluit(undefined, 'mis')
  assert.deepEqual(b, { baan: { mis: 1, gewisseld: false }, actie: 'niets' })
  b = besluit(b.baan, 'mis')
  assert.deepEqual(b, { baan: { mis: 0, gewisseld: true }, actie: 'wissel' })
  b = besluit(b.baan, 'telt-niet')
  assert.deepEqual(b, { baan: { mis: 0, gewisseld: true }, actie: 'niets' })
  b = besluit(b.baan, 'mis')
  assert.equal(b.actie, 'niets')
  b = besluit(b.baan, 'mis')
  assert.equal(b.actie, 'stop')
  let c = besluit(undefined, 'mis')
  c = besluit(c.baan, 'raak')
  assert.deepEqual(c.baan, { mis: 0, gewisseld: false })
  c = besluit(c.baan, 'mis')
  assert.equal(c.actie, 'niets')
  // telt-niet zonder baan: teller 0, niets.
  assert.deepEqual(besluit(undefined, 'telt-niet'), { baan: { mis: 0, gewisseld: false }, actie: 'niets' })
})

test('logRegel: gewisseld = telt-niet; vast en eigen venster', () => {
  const info = { model: 'a/b', stream: false, baan: '01234567' }
  const vorige = logRegel({ t: NU - 60_000, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: { in: 4000, uit: 1, read: 0, write: 0 }, ms: 1 })
  const g = { in: 4500, uit: 1, read: 0, write: 0 }
  assert.equal(logRegel({ t: NU, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: g, ms: 1, vorige }).telling, 'mis')
  const r = logRegel({ t: NU, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: g, ms: 1, vorige, gewisseld: true, vast: true })
  assert.equal(r.telling, 'telt-niet')
  assert.equal(r.vast, true)
  assert.equal(logRegel({ t: NU, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: g, ms: 1, vorige }).vast, undefined)
  // Venster van 30 s: de vorige (60 s geleden) is te oud.
  assert.equal(logRegel({ t: NU, sessie: 's1', pad: '/v1/messages', info, status: 200, gebruik: g, ms: 1, vorige, venster: 30_000 }).telling, 'telt-niet')
})

test('wisselModel: huidig blijft, oud wordt het huidige van zijn rij, onbekend blijft', () => {
  assert.equal(wisselModel('a/oud', { m1: 'b/nieuw[1m]' }, { m1: [{ id: 'a/oud', t: 1 }] }), 'b/nieuw')
  assert.equal(wisselModel('b/nieuw', { m1: 'b/nieuw[1m]' }, { m1: [{ id: 'a/oud', t: 1 }] }), 'b/nieuw')
  assert.equal(wisselModel('c/vreemd', { m1: 'b/nieuw' }, { m1: [{ id: 'a/oud', t: 1 }] }), 'c/vreemd')
  // Stond in twee rijen: de nieuwste vermelding wint.
  assert.equal(wisselModel('a/oud[1m]', { m1: 'b/een', m4: 'c/vier' }, { m1: [{ id: 'a/oud', t: 1 }], m4: [{ id: 'a/oud[1m]', t: 5 }] }), 'c/vier')
  // Ook in een andere rij als huidig: blijft.
  assert.equal(wisselModel('a/oud', { m1: 'b/een', m2: 'a/oud' }, { m1: [{ id: 'a/oud', t: 1 }] }), 'a/oud')
  assert.equal(wisselModel(undefined, { m1: 'b/een' }, {}), undefined)
  assert.equal(wisselModel('a/oud', undefined, undefined), 'a/oud')
})

test('isZwak, stopBericht, zwakMeting', () => {
  const metingen = { 'q/w': { oordeel: 'zwak' }, 'g/g': { oordeel: 'goed' } }
  assert.equal(isZwak(metingen, 'q/w'), true)
  assert.equal(isZwak(metingen, 'q/w[1m]'), true)
  assert.equal(isZwak(metingen, 'g/g'), false)
  assert.equal(isZwak(null, 'q/w'), false)
  assert.equal(isZwak(metingen, undefined), false)
  assert.equal(stopBericht('q/w', 20817), 'futureflow: q/w cachet niet in deze sessie en is gestopt om kosten te voorkomen. Kies een ander model met /model of op http://127.0.0.1:20817/.')
  assert.deepEqual(zwakMeting(12, NU), { oordeel: 'zwak', aandeel: 12, raak: 0, van: MIS_WISSEL + MIS_STOP, gemeten: NU })
})

test('geldigeSchrijf: host, x-ff, json en origin', () => {
  const goed = { host: '127.0.0.1:20817', origin: undefined, xff: '1', contentType: 'application/json; charset=utf-8', poort: 20817 }
  assert.equal(geldigeSchrijf(goed), true)
  assert.equal(geldigeSchrijf({ ...goed, origin: 'http://127.0.0.1:20817' }), true)
  assert.equal(geldigeSchrijf({ ...goed, origin: 'http://localhost:20817' }), true)
  assert.equal(geldigeSchrijf({ ...goed, origin: 'http://evil.example' }), false)
  assert.equal(geldigeSchrijf({ ...goed, origin: 'null' }), false)
  assert.equal(geldigeSchrijf({ ...goed, xff: undefined }), false)
  assert.equal(geldigeSchrijf({ ...goed, contentType: 'text/plain' }), false)
  assert.equal(geldigeSchrijf({ ...goed, host: 'evil.example:20817' }), false)
})
