// node --test futureflow/tests/proxy.test.mjs
// Het proxy-proces (bridge/or-proxy.mjs) tegen een nep-upstream op een vrije poort, met een tijdelijke
// OPENROUTER_DIR. Nooit poort 20817, nooit het echte ~/.claude, nooit openrouter.ai.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { foutAntwoord, PROXY_VERSIE, SLECHT_MS, stopBericht } from '../lib/proxy.mjs'

const PROXY = fileURLToPath(new URL('../bridge/or-proxy.mjs', import.meta.url))
const opruimen = []

afterEach(async () => {
  while (opruimen.length) await opruimen.pop()()
})

const wacht = ms => new Promise(r => setTimeout(r, ms))

async function totDat(fn, ms = 3000) {
  const eind = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > eind) throw new Error('tijd om')
    await wacht(25)
  }
}

function vrijePoort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

// Nep-upstream: bewaart elke aanvraag; `routes[pad]` beantwoordt hem (anders 404).
async function upstream(routes) {
  const aanvragen = []
  const server = http.createServer((req, res) => {
    const delen = []
    req.on('data', c => delen.push(c))
    req.on('end', () => {
      const a = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(delen), gesloten: false }
      aanvragen.push(a)
      res.on('close', () => { a.gesloten = true })
      const route = routes[req.url.split('?')[0]]
      if (route) route(req, res, a)
      else {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end('{}')
      }
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  opruimen.push(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  return { url: `http://127.0.0.1:${server.address().port}`, aanvragen, server }
}

// Start de proxy als kind en wacht tot /_ff/stand antwoordt.
async function start({ url, stil, poort, dir, env = {}, voor } = {}) {
  const p = poort ?? (await vrijePoort())
  const d = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ff-proxy-'))
  if (voor) voor(d)
  const proc = spawn(process.execPath, [PROXY], {
    env: { ...process.env, OR_PROXY_POORT: String(p), OPENROUTER_URL: url ?? 'http://127.0.0.1:9', OPENROUTER_DIR: d, ...(stil ? { OR_PROXY_STIL_MS: String(stil) } : {}), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  proc.stderr.on('data', c => { stderr += c })
  const einde = new Promise(r => proc.on('exit', code => r(code)))
  opruimen.push(async () => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
    await einde
    fs.rmSync(d, { recursive: true, force: true })
  })
  const r = { proc, poort: p, dir: d, einde, stderr: () => stderr }
  if (!dir || !poort) {
    await totDat(async () => {
      if (proc.exitCode !== null) throw new Error(`proxy stopte: ${stderr}`)
      try {
        return (await vraag(p, 'GET', '/_ff/stand')).status === 200
      } catch {
        return false
      }
    })
  }
  return r
}

// Eén aanvraag naar de proxy; body als Buffer terug.
function vraag(poort, method, pad, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: poort, method, path: pad, headers, agent: false }, res => {
      const delen = []
      res.on('data', c => delen.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(delen) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
}

const logRegels = dir => {
  try {
    return fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  } catch {
    return []
  }
}
const totRegels = (dir, n) => totDat(() => (logRegels(dir).length >= n ? logRegels(dir) : false))

const json = (status, data) => (req, res) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(typeof data === 'string' ? data : JSON.stringify(data))
}

const SSE = [
  'event: message_start\n',
  `data: ${JSON.stringify({ type: 'message_start', message: { id: 'm', provider: 'Wafer', usage: { input_tokens: 100, cache_read_input_tokens: 400, output_tokens: 1 } } })}\n\n`,
  'event: content_block_delta\n',
  `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hallo wereld' } })}\n\n`,
  'event: message_delta\n',
  `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 7 } })}\n\n`,
  'event: message_stop\n',
  'data: {"type":"message_stop"}\n\n',
].join('')

// SSE in stukken van 13 bytes met een korte pauze: data-regels breken midden in.
const sse = async (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (let i = 0; i < SSE.length; i += 13) {
    res.write(SSE.slice(i, i + 13))
    await wacht(2)
  }
  res.end()
}

test('JSON: body, key en sessie ongewijzigd door; antwoord byte-gelijk; logregel zonder key', async () => {
  const antwoord = JSON.stringify({ id: 'm', provider: 'Wafer', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 30, cache_creation_input_tokens: 5 } })
  const up = await upstream({ '/v1/messages': json(200, antwoord) })
  const px = await start({ url: up.url })
  const body = '{"model":"a/b","max_tokens":1}'
  const r = await vraag(px.poort, 'POST', '/v1/messages', { headers: { authorization: 'Bearer test-key', 'x-session-id': 's1', 'content-type': 'application/json' }, body })
  assert.equal(r.status, 200)
  assert.equal(r.body.toString(), antwoord)
  assert.equal(up.aanvragen.length, 1)
  const a = up.aanvragen[0]
  assert.equal(a.body.toString(), body)
  assert.equal(a.headers.authorization, 'Bearer test-key')
  assert.equal(a.headers['x-session-id'], 's1')
  assert.equal(a.headers['accept-encoding'], 'identity')
  assert.equal(a.headers.host, new URL(up.url).host)
  const [regel] = await totRegels(px.dir, 1)
  assert.equal(regel.sessie, 's1')
  assert.equal(regel.model, 'a/b')
  assert.equal(regel.status, 200)
  assert.equal(regel.pad, '/v1/messages')
  assert.deepEqual([regel.in, regel.uit, regel.read, regel.write, regel.aanbieder], [10, 2, 30, 5, 'Wafer'])
  assert.equal(regel.telling, 'telt-niet')
  assert.equal(regel.stream, false)
  assert.ok(!fs.readFileSync(path.join(px.dir, 'log.jsonl'), 'utf8').includes('test-key'))
  assert.ok(!px.stderr().includes('test-key'))
})

test('query blijft: GET /v1/models?x=1', async () => {
  const up = await upstream({ '/v1/models': json(200, { data: [] }) })
  const px = await start({ url: up.url })
  const r = await vraag(px.poort, 'GET', '/v1/models?x=1')
  assert.equal(r.status, 200)
  assert.equal(up.aanvragen[0].url, '/v1/models?x=1')
  assert.equal(up.aanvragen[0].method, 'GET')
})

test('SSE: compleet en in volgorde terug; usage uit message_start + message_delta', async () => {
  const up = await upstream({ '/v1/messages': sse })
  const px = await start({ url: up.url })
  const r = await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's2', 'content-type': 'application/json' }, body: '{"model":"a/b","stream":true}' })
  assert.equal(r.status, 200)
  assert.equal(r.body.toString(), SSE)
  assert.equal(r.headers['content-type'], 'text/event-stream')
  assert.equal(r.headers['content-length'], undefined)
  const [regel] = await totRegels(px.dir, 1)
  assert.equal(regel.stream, true)
  assert.deepEqual([regel.in, regel.uit, regel.read, regel.write, regel.aanbieder], [100, 7, 400, 0, 'Wafer'])
})

test('telling: tweede aanvraag in dezelfde baan met 80 % uit cache is raak; stand telt mee', async () => {
  let n = 0
  const up = await upstream({
    '/v1/messages': (req, res) => {
      n += 1
      json(200, { usage: n === 1 ? { input_tokens: 4000, cache_creation_input_tokens: 500 } : { input_tokens: 1000, cache_read_input_tokens: 4000 } })(req, res)
    },
  })
  const px = await start({ url: up.url })
  const body = JSON.stringify({ model: 'a/b', system: 'S', tools: [{ name: 'Read' }], messages: [] })
  for (let i = 0; i < 2; i++) await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's3' }, body })
  const regels = await totRegels(px.dir, 2)
  assert.deepEqual(regels.map(r => r.telling), ['telt-niet', 'raak'])
  assert.equal(regels[1].aandeel, 80)
  assert.equal(regels[0].baan, regels[1].baan)
  const stand = JSON.parse((await vraag(px.poort, 'GET', '/_ff/stand')).body)
  assert.equal(stand.versie, PROXY_VERSIE)
  assert.equal(stand.poort, px.poort)
  assert.equal(typeof stand.sinds, 'number')
  assert.equal(stand.sessies.s3['a/b'].aanvragen, 2)
  assert.equal(stand.sessies.s3['a/b'].raak, 1)
  assert.equal(stand.sessies.s3['a/b'].mis, 0)
})

test('upstream-fout 429: zelfde status en body; logregel met fouttype', async () => {
  const fout = '{"type":"error","error":{"type":"rate_limit_error","message":"x"}}'
  const up = await upstream({ '/v1/messages': json(429, fout) })
  const px = await start({ url: up.url })
  const r = await vraag(px.poort, 'POST', '/v1/messages', { body: '{"model":"a/b"}' })
  assert.equal(r.status, 429)
  assert.equal(r.body.toString(), fout)
  const [regel] = await totRegels(px.dir, 1)
  assert.equal(regel.status, 429)
  assert.equal(regel.fout, 'rate_limit_error')
  assert.equal(regel.telling, 'telt-niet')
})

test('upstream onbereikbaar: 502 in Anthropic-vorm, proxy draait door', async () => {
  const dicht = await vrijePoort()
  const px = await start({ url: `http://127.0.0.1:${dicht}` })
  const r = await vraag(px.poort, 'POST', '/v1/messages', { body: '{"model":"a/b"}' })
  assert.equal(r.status, 502)
  assert.deepEqual(JSON.parse(r.body), foutAntwoord('futureflow-proxy: OpenRouter is niet bereikbaar'))
  const [regel] = await totRegels(px.dir, 1)
  assert.equal(regel.status, 502)
  assert.ok(regel.fout)
  assert.equal((await vraag(px.poort, 'GET', '/_ff/stand')).status, 200)
})

test('client breekt een stroom af: upstream gesloten, logregel afgebroken, proxy draait door', async () => {
  const up = await upstream({
    '/v1/messages': (req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(SSE.slice(0, SSE.indexOf('\n\n') + 2))
      // Daarna niets meer: de client moet afbreken.
    },
  })
  const px = await start({ url: up.url })
  await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: px.poort, method: 'POST', path: '/v1/messages', headers: { 'x-session-id': 's4' }, agent: false }, res => {
      res.once('data', () => {
        req.destroy()
        resolve()
      })
    })
    req.on('error', () => {})
    req.end('{"model":"a/b","stream":true}')
    setTimeout(() => reject(new Error('geen eerste chunk')), 3000)
  })
  await totDat(() => up.aanvragen[0]?.gesloten)
  const [regel] = await totRegels(px.dir, 1)
  assert.equal(regel.fout, 'afgebroken')
  assert.equal(regel.sessie, 's4')
  assert.equal((await vraag(px.poort, 'GET', '/_ff/stand')).status, 200)
})

test('eigen paden: Host en Origin gecontroleerd; /_ff/stop stopt met code 0', async () => {
  const px = await start({})
  assert.equal((await vraag(px.poort, 'GET', '/_ff/stand', { headers: { host: 'evil.example' } })).status, 403)
  assert.equal((await vraag(px.poort, 'GET', '/_ff/stand', { headers: { host: `evil.example:${px.poort}` } })).status, 403)
  assert.equal((await vraag(px.poort, 'GET', '/_ff/stand', { headers: { host: `localhost:${px.poort}` } })).status, 200)
  assert.equal((await vraag(px.poort, 'GET', '/_ff/niets')).status, 404)
  assert.equal((await vraag(px.poort, 'POST', '/_ff/stop', { headers: { origin: 'http://x' } })).status, 403)
  assert.equal(px.proc.exitCode, null)
  const r = await vraag(px.poort, 'POST', '/_ff/stop')
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(r.body), { ok: true })
  assert.equal(await px.einde, 0)
})

test('stil-stop: zonder aanvragen stopt de proxy vanzelf met code 0', async () => {
  const px = await start({ stil: 300 })
  assert.equal(await px.einde, 0)
})

test('poort bezet: een tweede proxy stopt met code 2', async () => {
  const px = await start({})
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-proxy-'))
  const tweede = await start({ poort: px.poort, dir })
  assert.equal(await tweede.einde, 2)
  assert.match(tweede.stderr(), /poort/)
  assert.equal((await vraag(px.poort, 'GET', '/_ff/stand')).status, 200)
})

// ---- logboek (Task 3) ----

const LOGBOEK = fileURLToPath(new URL('../bridge/logboek.html', import.meta.url))

test('/_ff/log: regels oudste eerst, na en max, kapotte regel overgeslagen, Host-check', async () => {
  const up = await upstream({ '/v1/messages': json(200, { usage: { input_tokens: 5 } }) })
  const px = await start({ url: up.url })
  for (const m of ['a/een', 'a/twee', 'a/drie']) {
    await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's5' }, body: JSON.stringify({ model: m }) })
    await wacht(5)
  }
  await totRegels(px.dir, 3)
  const log = async q => JSON.parse((await vraag(px.poort, 'GET', `/_ff/log${q}`)).body)
  const alle = await log('')
  assert.deepEqual(alle.map(r => r.model), ['a/een', 'a/twee', 'a/drie'])
  assert.deepEqual((await log(`?na=${alle[0].t}`)).map(r => r.model), ['a/twee', 'a/drie'])
  assert.deepEqual((await log('?max=1')).map(r => r.model), ['a/drie'])
  fs.appendFileSync(path.join(px.dir, 'log.jsonl'), '{kapot\n')
  assert.equal((await log('')).length, 3)
  // Na rotatie: de oude generatie telt mee als het nieuwe log te weinig regels heeft.
  fs.renameSync(path.join(px.dir, 'log.jsonl'), path.join(px.dir, 'log.1.jsonl'))
  await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's5' }, body: JSON.stringify({ model: 'a/vier' }) })
  await totRegels(px.dir, 1)
  assert.deepEqual((await log('')).map(r => r.model), ['a/een', 'a/twee', 'a/drie', 'a/vier'])
  assert.deepEqual((await log('?max=1')).map(r => r.model), ['a/vier'])
  assert.equal((await vraag(px.poort, 'GET', '/_ff/log', { headers: { host: 'evil.example' } })).status, 403)
})

test('GET /: logboek-pagina met CSP; geen externe bronnen en geen innerHTML', async () => {
  const px = await start({})
  const r = await vraag(px.poort, 'GET', '/')
  assert.equal(r.status, 200)
  assert.match(r.headers['content-type'], /^text\/html/)
  assert.equal(r.headers['cache-control'], 'no-store')
  assert.equal(r.headers['content-security-policy'], "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
  const html = r.body.toString()
  assert.match(html, /OpenRouter-proxy/)
  assert.equal(html, fs.readFileSync(LOGBOEK, 'utf8'))
  assert.doesNotMatch(html, /https?:\/\//)
  assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
  assert.match(html, /Nog geen aanvragen\. Start een sessie met claude-or\./)
  assert.equal((await vraag(px.poort, 'GET', '/', { headers: { host: 'evil.example' } })).status, 403)
  // Het icoon van de browser gaat niet door naar OpenRouter en komt niet in het log.
  assert.equal((await vraag(px.poort, 'GET', '/favicon.ico')).status, 204)
  assert.deepEqual(logRegels(px.dir), [])
})

// ---- plan 9: vaste aanbieder, terugval, harde stop, modelwissel (0.17.0) ----

// Status waarmee de proxy een gestopt model weigert (gemeten tegen Claude Code, zie CLAUDE.md).
const WEIGER = 400

const bodyVan = a => JSON.parse(a.body.toString())
const leesJson = p => JSON.parse(fs.readFileSync(p, 'utf8'))

// Nep-CLI: schrijft argv en stdin per aanroep weg in <dir>/cli-log.jsonl en geeft vaste JSON per commando.
const NEP_CLI = `import fs from 'node:fs'
import path from 'node:path'
const dir = path.dirname(new URL(import.meta.url).pathname)
const args = process.argv.slice(2)
let stdin = ''
try { stdin = fs.readFileSync(0, 'utf8') } catch {}
fs.appendFileSync(path.join(dir, 'cli-log.jsonl'), JSON.stringify({ args, stdin }) + '\\n')
const antwoorden = JSON.parse(fs.readFileSync(path.join(dir, 'antwoorden.json'), 'utf8'))
const sleutel = args.join(' ')
const hit = Object.keys(antwoorden).filter(k => sleutel === k || sleutel.startsWith(k + ' ')).sort((a, b) => b.length - a.length)[0]
const [code, uit, fout, wacht] = hit ? antwoorden[hit] : [0, {}, '', 0]
setTimeout(() => {
  if (fout) process.stderr.write(fout + '\\n')
  process.stdout.write(JSON.stringify(uit) + '\\n')
  process.exitCode = code
}, wacht ?? 0)
`

// Zet de nep-CLI in <dir>/nepcli/ en proxy/cli.json naar hem; `antwoorden` = { 'commando …': [exit, json, stderr?, wachtMs?] }.
function nepCli(dir, antwoorden = {}) {
  const map = path.join(dir, 'nepcli')
  fs.mkdirSync(map, { recursive: true })
  fs.writeFileSync(path.join(map, 'api.mjs'), NEP_CLI)
  fs.writeFileSync(path.join(map, 'antwoorden.json'), JSON.stringify(antwoorden))
  fs.mkdirSync(path.join(dir, 'proxy'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'proxy', 'cli.json'), JSON.stringify({ cli: path.join(map, 'api.mjs') }))
  return {
    zet: a => fs.writeFileSync(path.join(map, 'antwoorden.json'), JSON.stringify(a)),
    aanroepen: () => {
      try {
        return fs.readFileSync(path.join(map, 'cli-log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
      } catch {
        return []
      }
    },
  }
}

// Upstream die de aanbieder uit provider.order kiest, anders de eerste die niet genegeerd wordt.
const kiesUp = (lijst, usage) => (req, res, a) => {
  const p = bodyVan(a).provider
  const aanbieder = p?.order?.[0] ?? lijst.find(n => !(p?.ignore ?? []).includes(n))
  json(200, { id: 'm', provider: aanbieder, usage: typeof usage === 'function' ? usage() : usage })(req, res)
}
const KLEIN = { input_tokens: 10, output_tokens: 1 }
const KOUD = { input_tokens: 4000, output_tokens: 1 }
const ZWAAR = JSON.stringify({ model: 'm/x', system: 'S', tools: [{ name: 'Read' }], messages: [] })

test('vaste aanbieder: eerste los, daarna order met de aanbieder uit het antwoord; andere sessie los; /_ff/stand.vast', async () => {
  const up = await upstream({ '/v1/messages': kiesUp(['Wafer', 'River'], KLEIN) })
  const px = await start({ url: up.url })
  const body = '{"model":"m/x","max_tokens":1}'
  await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's1' }, body })
  await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's1' }, body })
  await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's2' }, body })
  assert.equal(up.aanvragen[0].body.toString(), body)
  assert.deepEqual(bodyVan(up.aanvragen[1]).provider, { order: ['Wafer'], allow_fallbacks: false })
  assert.equal(up.aanvragen[2].body.toString(), body)
  const regels = await totRegels(px.dir, 3)
  assert.equal(regels[1].vast, true)
  assert.equal(regels[0].vast, undefined)
  const stand = JSON.parse((await vraag(px.poort, 'GET', '/_ff/stand')).body)
  assert.deepEqual(stand.vast.s1, { 'm/x': 'Wafer' })
  assert.deepEqual(stand.gestopt, [])
})

test('vaste aanbieder: een body met eigen provider komt byte-gelijk aan', async () => {
  const up = await upstream({ '/v1/messages': kiesUp(['Wafer'], KLEIN) })
  const px = await start({ url: up.url })
  const eigen = '{"model":"m/x", "provider":{"only":["X"]}}'
  await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's1' }, body: '{"model":"m/x"}' })
  await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's1' }, body: eigen })
  assert.equal(up.aanvragen[1].body.toString(), eigen)
})

test('terugval: vaste aanbieder geeft 429, één nieuwe poging zonder hem; client krijgt 200; fout geteld', async () => {
  const up = await upstream({
    '/v1/messages': (req, res, a) => {
      if (bodyVan(a).provider?.order?.[0] === 'Wafer') return json(429, '{"type":"error","error":{"type":"rate_limit_error","message":"x"}}')(req, res)
      return kiesUp(['Wafer', 'River'], KLEIN)(req, res, a)
    },
  })
  const px = await start({ url: up.url })
  await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's1' }, body: '{"model":"m/x"}' })
  const r = await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's1' }, body: '{"model":"m/x"}' })
  assert.equal(r.status, 200)
  assert.equal(JSON.parse(r.body).provider, 'River')
  assert.equal(up.aanvragen.length, 3)
  assert.deepEqual(bodyVan(up.aanvragen[1]).provider, { order: ['Wafer'], allow_fallbacks: false })
  const tweede = bodyVan(up.aanvragen[2]).provider
  assert.ok(tweede.ignore?.includes('Wafer') || (tweede.order && !tweede.order.includes('Wafer')), JSON.stringify(tweede))
  const regels = await totRegels(px.dir, 2)
  assert.equal(regels[1].status, 200)
  assert.equal(regels[1].telling, 'telt-niet')
  const a = await totDat(() => {
    try {
      const d = leesJson(path.join(px.dir, 'aanbieders.json'))
      return d['m/x']?.Wafer?.fout === 1 ? d : false
    } catch {
      return false
    }
  }, 5000)
  assert.equal(a['m/x'].Wafer.fout, 1)
  // Daarna is River de vaste.
  const stand = JSON.parse((await vraag(px.poort, 'GET', '/_ff/stand')).body)
  assert.deepEqual(stand.vast.s1, { 'm/x': 'River' })
})

test('harde stop: twee missers = wissel (slecht), na een koude en twee missers = stop; daarna geweigerd, ook in een andere sessie', async () => {
  const up = await upstream({ '/v1/messages': kiesUp(['Wafer', 'River'], KOUD) })
  const px = await start({ url: up.url, voor: d => fs.writeFileSync(path.join(d, 'cache.json'), JSON.stringify({ 'ander/model': { oordeel: 'goed', aandeel: 80, raak: 5, van: 5, gemeten: 1 } })) })
  const cli = nepCli(px.dir, { 'openrouter poort': [0, { ok: false, redenen: [] }] })
  const stuur = s => vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': s }, body: ZWAAR })
  for (let i = 0; i < 3; i++) await stuur('s1')
  let regels = await totRegels(px.dir, 3)
  assert.deepEqual(regels.map(r => r.telling), ['telt-niet', 'mis', 'mis'])
  assert.equal(regels[2].actie, 'wissel')
  assert.equal(regels[1].actie, undefined)
  const a = await totDat(() => {
    try {
      const d = leesJson(path.join(px.dir, 'aanbieders.json'))
      return d['m/x']?.Wafer?.slechtTot ? d : false
    } catch {
      return false
    }
  }, 5000)
  assert.ok(a['m/x'].Wafer.slechtTot > Date.now() + SLECHT_MS - 60_000)
  for (let i = 0; i < 3; i++) await stuur('s1')
  regels = await totRegels(px.dir, 6)
  assert.deepEqual(bodyVan(up.aanvragen[3]).provider, { ignore: ['Wafer'] })
  assert.deepEqual(regels.slice(3).map(r => [r.aanbieder, r.telling]), [['River', 'telt-niet'], ['River', 'mis'], ['River', 'mis']])
  assert.equal(regels[5].actie, 'stop')
  const cache = leesJson(path.join(px.dir, 'cache.json'))
  assert.equal(cache['m/x'].oordeel, 'zwak')
  assert.equal(cache['ander/model'].oordeel, 'goed')
  const aanroep = await totDat(() => cli.aanroepen()[0])
  assert.deepEqual(aanroep, { args: ['openrouter', 'poort'], stdin: '{}' })
  // Geweigerd zonder upstream.
  const r = await stuur('s1')
  assert.equal(r.status, WEIGER)
  assert.equal(JSON.parse(r.body).error.message, stopBericht('m/x', px.poort))
  const r2 = await stuur('s2')
  assert.equal(r2.status, WEIGER)
  assert.equal(r2.body.toString(), r.body.toString())
  assert.equal(up.aanvragen.length, 6)
  regels = await totRegels(px.dir, 8)
  assert.equal(regels[6].fout, 'gestopt')
  const stand = JSON.parse((await vraag(px.poort, 'GET', '/_ff/stand')).body)
  assert.deepEqual(stand.gestopt, ['m/x'])
})

test('harde stop zonder proxy/cli.json: geen CLI, een logregel geen-cli', async () => {
  const up = await upstream({ '/v1/messages': kiesUp(['Wafer', 'River'], KOUD) })
  const px = await start({ url: up.url })
  for (let i = 0; i < 6; i++) await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's1' }, body: ZWAAR })
  const regels = await totRegels(px.dir, 7)
  assert.ok(regels.some(r => r.fout === 'geen-cli'))
  assert.equal(leesJson(path.join(px.dir, 'cache.json'))['m/x'].oordeel, 'zwak')
})

test('een pauze langer dan het venster tussen missers: geen wissel', async () => {
  const up = await upstream({ '/v1/messages': kiesUp(['Wafer'], KOUD) })
  const px = await start({ url: up.url, env: { OR_PROXY_VENSTER_MS: '300' } })
  const stuur = () => vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's1' }, body: ZWAAR })
  await stuur()
  await stuur()
  await wacht(450)
  await stuur()
  const regels = await totRegels(px.dir, 3)
  assert.deepEqual(regels.map(r => r.telling), ['telt-niet', 'mis', 'telt-niet'])
  assert.ok(regels.every(r => r.actie === undefined))
})

test('modelwissel: een oud id uit de historie van rij 1 gaat als het huidige model naar de upstream', async () => {
  const up = await upstream({ '/v1/messages': kiesUp(['Wafer'], KLEIN) })
  const px = await start({ url: up.url, voor: d => fs.writeFileSync(path.join(d, 'rijen.json'), JSON.stringify({ nu: { m1: 'b/nieuw' }, historie: { m1: [{ id: 'a/oud', t: 1 }] } })) })
  await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's1' }, body: '{"model":"a/oud","max_tokens":1}' })
  assert.equal(bodyVan(up.aanvragen[0]).model, 'b/nieuw')
  const [regel] = await totRegels(px.dir, 1)
  assert.equal(regel.model, 'b/nieuw')
  assert.equal(regel.van, 'a/oud')
  // Een wijziging van rijen.json geldt meteen.
  await wacht(20)
  fs.writeFileSync(path.join(px.dir, 'rijen.json'), JSON.stringify({ nu: { m1: 'c/nieuwer' }, historie: { m1: [{ id: 'b/nieuw', t: 2 }, { id: 'a/oud', t: 1 }] } }))
  await vraag(px.poort, 'POST', '/v1/messages', { headers: { 'x-session-id': 's1' }, body: '{"model":"a/oud","max_tokens":1}' })
  assert.equal(bodyVan(up.aanvragen[1]).model, 'c/nieuwer')
})

test('/api/hello gaat door maar komt niet in het log', async () => {
  const up = await upstream({ '/api/hello': json(200, { ok: true }), '/v1/messages': json(200, { usage: KLEIN }) })
  const px = await start({ url: up.url })
  assert.equal((await vraag(px.poort, 'GET', '/api/hello')).status, 200)
  await vraag(px.poort, 'POST', '/v1/messages', { body: '{"model":"m/x"}' })
  const regels = await totRegels(px.dir, 1)
  assert.deepEqual(regels.map(r => r.pad), ['/v1/messages'])
})

// ---- plan 9, Task 3: paden voor instellingen ----

const TESTKEY = 'sk-or-v1-testkey-niet-tonen-0123456789'
const STATUS = { heeftKey: true, staart: 'AAAA', orHeeftKey: true, orStaart: 'ZZZZ', orKlaar: true, orM1: 'a/een', orM2: 'a/een', orM3: 'b/drie', orM4: 'a/een' }
const MODELLIJST = { modellen: [{ id: 'a/klein', naam: 'Klein', context: 100000, in: 1, uit: 2 }, { id: 'qwen/q', naam: 'Q', context: 300000 }, { id: 'g/groot', naam: 'Groot', context: 1000000 }], opgehaald: 1, uitCache: true }
const goed = (raak = 5) => ({ oordeel: 'goed', aandeel: 80, raak, van: 5, gemeten: 1 })
const schrijfKop = { 'x-ff': '1', 'content-type': 'application/json', authorization: `Bearer ${TESTKEY}` }

async function metCli(antwoorden, cacheInhoud = {}) {
  let c
  const px = await start({
    voor: d => {
      fs.writeFileSync(path.join(d, 'cache.json'), JSON.stringify(cacheInhoud))
      c = nepCli(d, { status: [0, STATUS], 'openrouter poort': [0, { ok: false, redenen: [{ id: 'b/drie', reden: 'ongemeten' }], shim: true, proxy: true }], ...antwoorden })
    },
  })
  return { px, c }
}
const post = (px, pad, data, headers = schrijfKop) => vraag(px.poort, 'POST', pad, { headers, body: JSON.stringify(data) })
const geenKey = (px, c, ...antwoorden) => {
  for (const a of c.aanroepen()) assert.ok(!JSON.stringify(a).includes(TESTKEY) && !JSON.stringify(a).includes('testkey'))
  for (const r of antwoorden) assert.ok(!r.body.toString().includes(TESTKEY) && !r.body.toString().includes('ZZZZ') && !r.body.toString().includes('AAAA'))
}

test('GET /_ff/instellingen: rijen (2-4 gelijk aan 1 = leeg), uitleg, metingen, startcheck, key als boolean', async () => {
  const { px, c } = await metCli({}, { 'a/een': goed() })
  const r = await vraag(px.poort, 'GET', '/_ff/instellingen')
  assert.equal(r.status, 200)
  const d = JSON.parse(r.body)
  assert.deepEqual(d.rijen, { m1: 'a/een', m3: 'b/drie' })
  assert.equal(d.uitleg.m1, 'start + /model opus')
  assert.deepEqual(d.metingen, { 'a/een': goed() })
  assert.deepEqual(d.poort, { ok: false, redenen: [{ id: 'b/drie', reden: 'ongemeten' }] })
  assert.equal(d.heeftKey, true)
  assert.equal(d.cli, true)
  assert.deepEqual(d.aanbieders, {})
  assert.deepEqual(d.gestopt, [])
  assert.deepEqual(c.aanroepen().map(a => a.args.join(' ')).sort(), ['openrouter poort', 'status'])
  assert.equal(c.aanroepen().find(a => a.args[1] === 'poort').stdin, '{}')
  geenKey(px, c, r)
  assert.equal((await vraag(px.poort, 'GET', '/_ff/instellingen', { headers: { host: 'evil.example' } })).status, 403)
})

test('GET /_ff/instellingen zonder CLI: cli false, geen fout', async () => {
  const px = await start({})
  const d = JSON.parse((await vraag(px.poort, 'GET', '/_ff/instellingen')).body)
  assert.equal(d.cli, false)
  assert.equal(d.heeftKey, false)
  assert.deepEqual(d.rijen, {})
})

test('GET /_ff/modellen: teKlein, zwak, kiesId en meting; ververs=1 geeft --ververs door', async () => {
  const { px, c } = await metCli({ 'openrouter modellen': [0, MODELLIJST] }, { 'g/groot': goed(4) })
  const d = JSON.parse((await vraag(px.poort, 'GET', '/_ff/modellen')).body)
  const per = Object.fromEntries(d.modellen.map(m => [m.id, m]))
  assert.equal(per['a/klein'].teKlein, true)
  assert.equal(per['qwen/q'].teKlein, false)
  assert.equal(per['qwen/q'].zwak, true)
  assert.equal(per['a/klein'].zwak, false)
  assert.equal(per['g/groot'].kiesId, 'g/groot[1m]')
  assert.equal(per['g/groot'].meting.raak, 4)
  assert.equal(per['a/klein'].meting, null)
  await vraag(px.poort, 'GET', '/_ff/modellen?ververs=1')
  assert.deepEqual(c.aanroepen().map(a => a.args), [['openrouter', 'modellen'], ['openrouter', 'modellen', '--ververs']])
})

test('POST /_ff/kies: zonder x-ff of met vreemde Origin 403 en geen CLI', async () => {
  const { px, c } = await metCli({}, { 'b/twee': goed() })
  assert.equal((await post(px, '/_ff/kies', { rij: 'm2', model: 'b/twee' }, { 'content-type': 'application/json' })).status, 403)
  assert.equal((await post(px, '/_ff/kies', { rij: 'm2', model: 'b/twee' }, { ...schrijfKop, origin: 'http://evil.example' })).status, 403)
  assert.equal((await post(px, '/_ff/kies', { rij: 'm2', model: 'b/twee' }, { 'x-ff': '1', 'content-type': 'text/plain' })).status, 403)
  assert.equal((await post(px, '/_ff/meet', { model: 'b/twee' }, { 'content-type': 'application/json' })).status, 403)
  assert.deepEqual(c.aanroepen(), [])
})

test('POST /_ff/kies: geldig = modus openrouter met de nieuwe set; leeg op m3; m1 leeg = 400; ongeldig = 400', async () => {
  const { px, c } = await metCli({ 'modus openrouter': [0, { modus: 'openrouter', gewijzigd: true }] }, { 'b/twee': goed() })
  const r = await post(px, '/_ff/kies', { rij: 'm2', model: 'b/twee' })
  assert.equal(r.status, 200, r.body.toString())
  assert.deepEqual(JSON.parse(r.body), { ok: true, rijen: { m1: 'a/een', m2: 'b/twee', m3: 'b/drie' } })
  const modus = c.aanroepen().filter(a => a.args[0] === 'modus')
  assert.deepEqual(modus.map(a => a.args), [['modus', 'openrouter', '--m1', 'a/een', '--m2', 'b/twee', '--m3', 'b/drie']])
  const leeg = await post(px, '/_ff/kies', { rij: 'm3', model: null })
  assert.equal(leeg.status, 200)
  assert.deepEqual(c.aanroepen().filter(a => a.args[0] === 'modus').pop().args, ['modus', 'openrouter', '--m1', 'a/een'])
  const m1 = await post(px, '/_ff/kies', { rij: 'm1', model: null })
  assert.equal(m1.status, 400)
  assert.match(JSON.parse(m1.body).fout, /Model 1 is verplicht/)
  assert.equal((await post(px, '/_ff/kies', { rij: 'm2', model: 'geen id' })).status, 400)
  assert.equal((await post(px, '/_ff/kies', { rij: 'm9', model: 'b/twee' })).status, 400)
  geenKey(px, c, r, leeg, m1)
})

test('POST /_ff/kies: exit 7 van de CLI = 409 met de fouttekst', async () => {
  const { px, c } = await metCli({ 'modus openrouter': [7, {}, '[api] b/twee is nog niet gemeten; niets klaargezet'] })
  const r = await post(px, '/_ff/kies', { rij: 'm2', model: 'b/twee' })
  assert.equal(r.status, 409)
  assert.deepEqual(JSON.parse(r.body), { ok: false, fout: 'b/twee is nog niet gemeten; niets klaargezet' })
  geenKey(px, c, r)
})

test('POST /_ff/kies met meet: zwak of mislukt = 409 en geen modus; goed = meten en kiezen', async () => {
  const { px, c } = await metCli({
    'openrouter cachetest --model n/zwak': [0, { ok: true, model: 'n/zwak', oordeel: 'zwak', raak: 0, van: 5 }],
    'openrouter cachetest --model n/kapot': [0, { ok: false, model: 'n/kapot', status: 404, fout: 'No endpoints found' }],
    'openrouter cachetest --model n/goed': [0, { ok: true, model: 'n/goed', oordeel: 'goed', raak: 5, van: 5 }],
    'modus openrouter': [0, { modus: 'openrouter' }],
  })
  const zwak = await post(px, '/_ff/kies', { rij: 'm2', model: 'n/zwak', meet: true })
  assert.equal(zwak.status, 409)
  assert.match(JSON.parse(zwak.body).fout, /cachet niet/)
  const kapot = await post(px, '/_ff/kies', { rij: 'm2', model: 'n/kapot', meet: true })
  assert.equal(kapot.status, 409)
  assert.match(JSON.parse(kapot.body).fout, /No endpoints found/)
  assert.equal(c.aanroepen().filter(a => a.args[0] === 'modus').length, 0)
  const ok = await post(px, '/_ff/kies', { rij: 'm4', model: 'n/goed[1m]', meet: true })
  assert.equal(ok.status, 200, ok.body.toString())
  assert.deepEqual(c.aanroepen().filter(a => a.args[0] !== 'status').map(a => a.args.join(' ')), [
    'openrouter cachetest --model n/zwak', 'openrouter cachetest --model n/kapot', 'openrouter cachetest --model n/goed', 'modus openrouter --m1 a/een --m3 b/drie --m4 n/goed[1m]',
  ])
  const m = JSON.parse((await vraag(px.poort, 'GET', '/_ff/meet')).body)
  assert.equal(m.bezig, null)
  assert.deepEqual(m.rij, [])
  assert.deepEqual(m.laatste, { model: 'n/goed', ok: true, oordeel: 'goed', raak: 5, van: 5 })
})

test('POST /_ff/kies: twee tegelijk = de tweede 409 bezig', async () => {
  const { px } = await metCli({ 'modus openrouter': [0, {}, '', 600] }, { 'b/twee': goed(), 'c/c': goed() })
  const [a, b] = await Promise.all([post(px, '/_ff/kies', { rij: 'm2', model: 'b/twee' }), (async () => { await wacht(150); return post(px, '/_ff/kies', { rij: 'm3', model: 'c/c' }) })()])
  assert.equal(a.status, 200)
  assert.equal(b.status, 409)
  assert.match(JSON.parse(b.body).fout, /bezig/)
})

test('POST /_ff/meet: in de rij, één tegelijk; GET /_ff/meet toont bezig, rij en laatste', async () => {
  const { px, c } = await metCli({
    'openrouter cachetest --model m/een': [0, { ok: true, model: 'm/een', oordeel: 'goed', raak: 4, van: 5 }, '', 400],
    'openrouter cachetest --model m/twee': [0, { ok: true, model: 'm/twee', oordeel: 'wisselend', raak: 3, van: 5 }, '', 100],
  })
  assert.deepEqual(JSON.parse((await post(px, '/_ff/meet', { model: 'm/een' })).body), { ok: true })
  assert.deepEqual(JSON.parse((await post(px, '/_ff/meet', { model: 'm/twee' })).body), { ok: true })
  assert.equal((await post(px, '/_ff/meet', { model: 'geen id' })).status, 400)
  const tijdens = JSON.parse((await vraag(px.poort, 'GET', '/_ff/meet')).body)
  assert.equal(tijdens.bezig, 'm/een')
  assert.deepEqual(tijdens.rij, ['m/twee'])
  const na = await totDat(async () => {
    const d = JSON.parse((await vraag(px.poort, 'GET', '/_ff/meet')).body)
    return d.bezig === null && d.laatste?.model === 'm/twee' ? d : false
  }, 5000)
  assert.deepEqual(na.laatste, { model: 'm/twee', ok: true, oordeel: 'wisselend', raak: 3, van: 5 })
  assert.equal(c.aanroepen().filter(a => a.args[1] === 'cachetest').length, 2)
})

// ---- plan 9, Task 4: tab Modellen op de pagina (statisch) ----

test('pagina: tabs Modellen en Logboek, Meet en kies, x-ff; geen innerHTML en geen andere host; CSP', async () => {
  const px = await start({})
  const r = await vraag(px.poort, 'GET', '/')
  assert.equal(r.headers['content-security-policy'], "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
  const html = r.body.toString()
  for (const t of ['Modellen', 'Logboek', 'Meet en kies (~35-60k tokens)', "'x-ff': '1'", 'Ververs lijst', 'Meet opnieuw', 'te klein voor Claude Code', 'cachet niet',
    'claude-or start met deze keuze', 'Bewaar eerst een OpenRouter-key in /futureflow, tab 2 Wisselen.', 'Open /futureflow één keer in een sessie; daarna kun je hier kiezen.',
    'Een wissel geldt meteen voor lopende claude-or-sessies. De eerste beurt daarna is zonder cache.', '… verfijn je zoekopdracht', 'localStorage']) {
    assert.ok(html.includes(t), t)
  }
  assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
  assert.doesNotMatch(html, /https?:\/\//)
  assert.doesNotMatch(html, /<(link|img|iframe)\b/i)
})
