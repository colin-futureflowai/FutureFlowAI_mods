// Audio-bridge voor de voice-chat mod.
// Microfoon (ffmpeg) -> Inworld streaming STT -> JSON-regels op stdout naar de mod.
// De mod stuurt tekst terug via HTTP op een Unix-socket -> Inworld TTS stream -> ffplay.
//
// stdout-protocol (één JSON-object per regel):
//   {type:"ready"} | {type:"state",state} | {type:"partial",text} | {type:"final",text} | {type:"error",message}
// socket-routes (POST): /speak {text} | /stop | /mute | /unmute | /quit

import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOCKET = process.argv[2]
const TTS_RATE = 24000
const MIC_RATE = 16000
const CHUNK_BYTES = 3200 // 100 ms bij 16 kHz mono s16le

function loadEnv() {
  const env = {}
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
  return env
}

// Waarden uit de plugin-instellingen (door de mod meegegeven) gaan voor; .env is de terugval.
const env = { ...loadEnv() }
for (const name of ['INWORLD_API_KEY', 'LANGUAGE', 'INWORLD_VOICE_ID', 'INWORLD_TTS_MODEL', 'MIC_DEVICE', 'BARGE_IN']) {
  if (process.env[name]) env[name] = process.env[name]
}
const API_KEY = (env.INWORLD_API_KEY ?? '').replace(/^Basic\s+/i, '')
const LANGUAGE = env.LANGUAGE || 'nl'
const VOICE = env.INWORLD_VOICE_ID || 'Dennis'
const TTS_MODEL = env.INWORLD_TTS_MODEL || 'inworld-tts-2-flash'
const MIC = env.MIC_DEVICE || 'default'
const BARGE_IN = env.BARGE_IN === 'true'

const emit = msg => process.stdout.write(JSON.stringify(msg) + '\n')
const fail = message => emit({ type: 'error', message })

if (!API_KEY) {
  fail(`Inworld API key ontbreekt: vul hem in bij de plugin-instellingen van voice-chat of in ${join(ROOT, '.env')}`)
  process.exit(1)
}

let quitting = false
let manualMute = false
let speaking = false
let micHoldUntil = 0

// ---------- STT ----------

let ws
let pendingFinal = ''
let finalTimer

function flushFinal() {
  const text = pendingFinal.trim()
  pendingFinal = ''
  if (text) emit({ type: 'final', text })
}

function connectStt() {
  ws = new WebSocket('wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional', {
    headers: { Authorization: `Basic ${API_KEY}` },
  })
  ws.addEventListener('open', () => {
    ws.send(
      JSON.stringify({
        transcribeConfig: {
          modelId: 'inworld/inworld-stt-1',
          audioEncoding: 'LINEAR16',
          sampleRateHertz: MIC_RATE,
          numberOfChannels: 1,
          language: LANGUAGE,
          endOfTurnConfidenceThreshold: 0.6,
          inworldSttV1Config: { minEndOfTurnSilenceWhenConfident: 400, maxTurnSilence: 1200 },
        },
      }),
    )
    emit({ type: 'ready' })
    emit({ type: 'state', state: 'listening' })
  })
  ws.addEventListener('message', ev => {
    let msg
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString())
    } catch {
      return
    }
    if (msg.error) {
      fail(`STT: ${msg.error.message ?? JSON.stringify(msg.error)}`)
      // 3 = ongeldige config, 7 = key bestaat niet, 16 = niet geauthenticeerd: opnieuw verbinden heeft geen zin
      if ([3, 7, 16].includes(msg.error.code)) shutdown(1)
      return
    }
    const r = msg.result ?? {}
    if (r.speechStarted && speaking && BARGE_IN) stopSpeaking()
    const t = r.transcription
    if (!t) return
    if (t.isFinal) {
      pendingFinal += ' ' + (t.transcript ?? '')
      clearTimeout(finalTimer)
      // Korte pauze-merging: wie halverwege adem haalt, wordt niet in twee prompts geknipt.
      finalTimer = setTimeout(flushFinal, 700)
    } else if (t.transcript) {
      clearTimeout(finalTimer)
      emit({ type: 'partial', text: (pendingFinal + ' ' + t.transcript).trim() })
      if (pendingFinal) finalTimer = setTimeout(flushFinal, 1500)
    }
  })
  ws.addEventListener('error', ev => fail(`STT-verbinding: ${ev.message ?? 'fout'}`))
  ws.addEventListener('close', ev => {
    if (quitting) return
    if (ev.code === 1008 || ev.code === 4001 || ev.code === 4003) {
      fail(`STT geweigerd (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}). Klopt de API key?`)
      return shutdown(1)
    }
    setTimeout(connectStt, 1000)
  })
}

// ---------- Microfoon ----------

let mic
function startMic() {
  mic = spawn(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-i', `:${MIC}`,
      '-ac', '1', '-ar', String(MIC_RATE), '-f', 's16le', '-'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let buf = Buffer.alloc(0)
  mic.stdout.on('data', data => {
    buf = Buffer.concat([buf, data])
    while (buf.length >= CHUNK_BYTES) {
      const chunk = buf.subarray(0, CHUNK_BYTES)
      buf = buf.subarray(CHUNK_BYTES)
      const muted = manualMute || ((speaking || Date.now() < micHoldUntil) && !BARGE_IN)
      if (!muted && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ audioChunk: { content: chunk.toString('base64') } }))
      }
    }
  })
  let err = ''
  mic.stderr.on('data', d => (err += d))
  mic.on('exit', code => {
    if (quitting) return
    fail(`Microfoon gestopt (ffmpeg ${code}): ${err.trim().slice(-300)}`)
    shutdown(1)
  })
}

// ---------- TTS ----------

const queue = []
let player
let ttsAbort

function setState() {
  emit({ type: 'state', state: speaking ? 'speaking' : manualMute ? 'muted' : 'listening' })
}

async function speakNext() {
  if (speaking || queue.length === 0) return
  speaking = true
  setState()
  const text = queue.shift()
  ttsAbort = new AbortController()
  player = spawn(
    'ffplay',
    ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-f', 's16le', '-ar', String(TTS_RATE),
      '-ch_layout', 'mono', '-i', '-'],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  )
  player.stdin.on('error', () => {})
  const done = new Promise(resolve => player.on('exit', resolve))
  try {
    const res = await fetch('https://api.inworld.ai/tts/v1/voice:stream', {
      method: 'POST',
      signal: ttsAbort.signal,
      headers: { Authorization: `Basic ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voiceId: VOICE,
        modelId: TTS_MODEL,
        language: LANGUAGE,
        audioConfig: { audioEncoding: 'PCM', sampleRateHertz: TTS_RATE },
      }),
    })
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const decoder = new TextDecoder()
    let pending = ''
    const handle = line => {
      if (!line.trim()) return
      const msg = JSON.parse(line)
      if (msg.error) throw new Error(`TTS: ${msg.error.message ?? JSON.stringify(msg.error)}`)
      const audio = msg.result?.audioContent
      if (audio && !player.killed) player.stdin.write(Buffer.from(audio, 'base64'))
    }
    for await (const part of res.body) {
      pending += decoder.decode(part, { stream: true })
      let i
      while ((i = pending.indexOf('\n')) >= 0) {
        handle(pending.slice(0, i))
        pending = pending.slice(i + 1)
      }
    }
    handle(pending)
  } catch (e) {
    if (e.name !== 'AbortError') fail(String(e.message ?? e))
  }
  player.stdin.end()
  await done
  player = undefined
  speaking = false
  micHoldUntil = Date.now() + 400 // galm van de speaker niet terug laten transcriberen
  setState()
  speakNext()
}

function stopSpeaking() {
  queue.length = 0
  ttsAbort?.abort()
  player?.kill('SIGKILL')
}

// ---------- Socket voor de mod ----------

const server = createServer((req, res) => {
  let body = ''
  req.on('data', d => (body += d))
  req.on('end', () => {
    const json = () => {
      try {
        return JSON.parse(body || '{}')
      } catch {
        return {}
      }
    }
    switch (req.url) {
      case '/speak': {
        const { text } = json()
        if (text?.trim()) queue.push(text.trim())
        speakNext()
        break
      }
      case '/stop':
        stopSpeaking()
        break
      case '/mute':
        manualMute = true
        setState()
        break
      case '/unmute':
        manualMute = false
        setState()
        break
      case '/quit':
        res.end('ok')
        return shutdown(0)
    }
    res.end('ok')
  })
})

function shutdown(code) {
  quitting = true
  stopSpeaking()
  mic?.kill('SIGKILL')
  try {
    ws?.send(JSON.stringify({ closeStream: {} }))
    ws?.close()
  } catch {}
  server.close()
  try {
    rmSync(SOCKET, { force: true })
  } catch {}
  setTimeout(() => process.exit(code), 100)
}

process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))
// Wees: als Claude Code wegvalt, niet met open microfoon blijven hangen.
const parent = process.ppid
setInterval(() => {
  if (process.ppid !== parent) shutdown(0)
}, 2000).unref()

rmSync(SOCKET, { force: true })
server.listen(SOCKET, () => {
  connectStt()
  startMic()
})
