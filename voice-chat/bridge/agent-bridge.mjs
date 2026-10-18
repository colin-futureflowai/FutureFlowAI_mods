// Spraakagent-bridge voor de voice-chat mod.
// Microfoon (ffmpeg) -> Inworld Realtime (speech-to-speech, eigen LLM) -> ffplay.
// De agent voert het gesprek zelf en geeft grote taken via een tool door aan Claude Code;
// het antwoord van Claude Code komt via de socket terug en de agent vertelt het na.
//
// stdout-protocol (één JSON-object per regel):
//   {type:"ready"} | {type:"state",state,claudeBusy} | {type:"heard",text} | {type:"said",text}
//   | {type:"task",text} | {type:"error",message}
// socket-routes (POST): /result {text} | /notice {text} | /context {text} | /note {text} | /stop | /mute | /unmute | /quit
// Draait in de werkmap van de sessie (cwd); alleen in een vertrouwde map (AGENT_CONTEXT_ROOTS) krijgt de
// agent bestandsnamen en CLAUDE.md mee. Teksten en de taakpoort staan in agent-text.mjs.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TOOL, TOOL_DEFINITION, createTaskGate, instructions, isTrusted, repoContext, resultMessage } from './agent-text.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOCKET = process.argv[2]
const RATE = 24000
const CHUNK_BYTES = 4800 // 100 ms bij 24 kHz mono s16le

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
for (const name of ['INWORLD_API_KEY', 'LANGUAGE', 'INWORLD_VOICE_ID', 'MIC_DEVICE', 'BARGE_IN', 'AGENT_MODEL', 'AGENT_CONTEXT_ROOTS']) {
  if (process.env[name]) env[name] = process.env[name]
}
const API_KEY = (env.INWORLD_API_KEY ?? '').replace(/^Basic\s+/i, '')
const LANGUAGE = env.LANGUAGE || 'nl'
const LANG_TAG = LANGUAGE.includes('-') ? LANGUAGE : `${LANGUAGE}-${LANGUAGE === 'en' ? 'US' : LANGUAGE.toUpperCase()}`
const VOICE = env.INWORLD_VOICE_ID || 'Dennis'
const MODEL = env.AGENT_MODEL || 'openai/gpt-4.1-mini'
const MIC = env.MIC_DEVICE || 'default'
const BARGE_IN = env.BARGE_IN === 'true'
// Mappen die je vertrouwt: alleen daaronder krijgt de agent bestandsnamen en CLAUDE.md mee.
const CONTEXT_ROOTS = (env.AGENT_CONTEXT_ROOTS ?? '')
  .split(',')
  .map(p => resolve(p.trim().replace(/^~(?=\/|$)/, homedir())))
  .filter(p => p !== resolve(''))

const emit = msg => process.stdout.write(JSON.stringify(msg) + '\n')
const fail = message => emit({ type: 'error', message })

if (!API_KEY) {
  fail(`Inworld API key ontbreekt: vul hem in bij de plugin-instellingen van voice-chat of in ${join(ROOT, '.env')}`)
  process.exit(1)
}

// ---------- Context en instructies ----------

function readContext() {
  const cwd = process.cwd()
  const trusted = isTrusted(cwd, CONTEXT_ROOTS)
  let entries = []
  let claudeMd = ''
  if (trusted) {
    try {
      entries = readdirSync(cwd).filter(n => !n.startsWith('.')).slice(0, 40)
    } catch {}
    try {
      claudeMd = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8').slice(0, 8000)
    } catch {}
  }
  return repoContext({ cwd, project: basename(cwd), entries, claudeMd, trusted })
}

const INSTRUCTIONS = instructions(readContext())
const gate = createTaskGate()

// ---------- Realtime-verbinding ----------

let quitting = false
let manualMute = false
let ws
let responseActive = false
let needResponse = false
let saidText = ''
let claudeBusy = 0

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function setState() {
  const state = player ? 'speaking' : manualMute ? 'muted' : 'listening'
  emit({ type: 'state', state, claudeBusy: claudeBusy > 0 })
}

// Een response.create terwijl er al een loopt wordt geweigerd; dan wachten op response.done.
function requestResponse() {
  if (responseActive) needResponse = true
  else {
    responseActive = true
    send({ type: 'response.create' })
  }
}

function sessionUpdate() {
  send({
    type: 'session.update',
    session: {
      type: 'realtime',
      model: MODEL,
      instructions: INSTRUCTIONS,
      output_modalities: ['audio', 'text'],
      audio: {
        input: {
          transcription: { model: 'inworld/inworld-stt-1' },
          turn_detection: { type: 'semantic_vad', eagerness: 'medium', create_response: true, interrupt_response: true },
        },
        output: { voice: VOICE },
      },
      tools: [TOOL_DEFINITION],
      providerData: {
        auto_tool_response: false,
        stt: { language_hints: [LANG_TAG] },
        tts: { language: LANG_TAG },
      },
    },
  })
}

function onToolCall({ call_id, name, arguments: args }) {
  let output = { status: 'onbekende tool' }
  if (name === TOOL) {
    let parsed = {}
    try {
      parsed = JSON.parse(args || '{}')
    } catch {}
    const verdict = gate.check(parsed)
    output = verdict.output
    if (verdict.ok) {
      claudeBusy++
      emit({ type: 'task', text: verdict.taak })
      setState()
    }
  }
  send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify(output) } })
  requestResponse()
}

// Stil geheugen: wat er in de Claude Code-sessie gebeurt, zonder dat de agent reageert.
// Bewaard zodat het na het opnieuw verbinden weer meegestuurd wordt.
const memory = []
const MEMORY_MAX = 40

function addMemory(text) {
  memory.push(text)
  if (memory.length > MEMORY_MAX) memory.splice(0, memory.length - MEMORY_MAX)
  sendMemory(text)
}

function sendMemory(text) {
  send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } })
}

// Een bericht van Claude Code aan de agent, die het daarna navertelt. Als systeembericht, niet als
// gebruiker: wat Claude Code schrijft (en wat het uit bestanden of het web las) is geen opdracht.
function tellAgent(text) {
  gate.reset()
  send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } })
  requestResponse()
}

function onResult(text) {
  claudeBusy = Math.max(0, claudeBusy - 1)
  setState()
  tellAgent(resultMessage(text))
}

const BENIGN = new Set(['response_cancel_not_active', 'conversation_already_has_active_response'])

let connected = false

function connect() {
  connected = false
  const key = `voice-chat-${randomUUID()}`
  ws = new WebSocket(`wss://api.inworld.ai/api/v1/realtime/session?key=${key}&protocol=realtime`, {
    headers: { Authorization: `Basic ${API_KEY}` },
  })
  ws.addEventListener('message', ev => {
    let msg
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString())
    } catch {
      return
    }
    switch (msg.type) {
      case 'session.created':
        sessionUpdate()
        break
      case 'session.updated':
        if (!connected) {
          connected = true
          for (const text of memory) sendMemory(text)
          emit({ type: 'ready' })
        }
        setState()
        break
      case 'input_audio_buffer.speech_started':
        if (player) stopSpeaking() // onderbroken: direct stil
        break
      case 'input_audio_buffer.committed':
        gate.userSpoke() // de gebruiker heeft iets gezegd; pas daarna mag er een taak door
        break
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript?.trim()) emit({ type: 'heard', text: msg.transcript.trim() })
        break
      case 'response.created':
        responseActive = true
        saidText = ''
        break
      case 'response.output_audio.delta':
        play(Buffer.from(msg.delta, 'base64'))
        break
      case 'response.output_audio.done':
        player?.stdin.end()
        break
      case 'response.output_audio_transcript.delta':
        saidText += msg.delta ?? ''
        break
      case 'response.output_audio_transcript.done':
        if (msg.transcript) saidText = msg.transcript
        break
      case 'response.function_call_arguments.done':
        onToolCall(msg)
        break
      case 'response.done':
        responseActive = false
        gate.reset() // na elke beurt van de agent eerst weer de gebruiker
        if (saidText.trim()) emit({ type: 'said', text: saidText.trim() })
        saidText = ''
        if (needResponse) {
          needResponse = false
          requestResponse()
        }
        break
      case 'error':
        if (!BENIGN.has(msg.error?.code)) fail(`Realtime: ${msg.error?.message ?? JSON.stringify(msg.error)}`)
        break
    }
  })
  ws.addEventListener('error', ev => fail(`Realtime-verbinding: ${ev.message ?? 'fout'}`))
  ws.addEventListener('close', ev => {
    if (quitting) return
    if (ev.code === 1008 || ev.code === 4001 || ev.code === 4003) {
      fail(`Realtime geweigerd (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}). Klopt de API key?`)
      return shutdown(1)
    }
    fail(`Realtime-verbinding verbroken (code ${ev.code}), opnieuw verbinden…`)
    responseActive = false
    setTimeout(connect, 1000)
  })
}

// ---------- Afspelen ----------

let player
let micHoldUntil = 0

function play(pcm) {
  if (!player) {
    const p = spawn(
      'ffplay',
      ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-f', 's16le', '-ar', String(RATE), '-ch_layout', 'mono', '-i', '-'],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    )
    p.stdin.on('error', () => {})
    p.on('exit', () => {
      if (player !== p) return
      player = undefined
      micHoldUntil = Date.now() + 400 // galm van de speaker niet terug laten horen
      setState()
    })
    player = p
    setState()
  }
  if (!player.stdin.writableEnded) player.stdin.write(pcm)
}

function stopSpeaking() {
  const p = player
  player = undefined
  p?.kill('SIGKILL')
  setState()
}

// ---------- Microfoon ----------

let mic
function startMic() {
  mic = spawn(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-i', `:${MIC}`,
      '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let buf = Buffer.alloc(0)
  mic.stdout.on('data', data => {
    buf = Buffer.concat([buf, data])
    while (buf.length >= CHUNK_BYTES) {
      const chunk = buf.subarray(0, CHUNK_BYTES)
      buf = buf.subarray(CHUNK_BYTES)
      // Half-duplex zonder koptelefoon: de agent mag zichzelf niet horen.
      const muted = manualMute || ((player || Date.now() < micHoldUntil) && !BARGE_IN)
      if (!muted) send({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') })
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
      case '/result':
        onResult(String(json().text ?? '').trim() || 'Claude Code gaf geen antwoord.')
        break
      case '/notice':
        tellAgent(`[Claude Code] ${String(json().text ?? '').trim()}`)
        break
      case '/context': {
        const text = String(json().text ?? '').trim()
        if (text) addMemory(`[Sessie-context] Wat er eerder in deze Claude Code-sessie gebeurde:\n${text}`)
        break
      }
      case '/note': {
        const text = String(json().text ?? '').trim()
        if (text) addMemory(`[Sessie-update] ${text}`)
        break
      }
      case '/stop':
        stopSpeaking()
        send({ type: 'response.cancel' })
        break
      case '/mute':
        manualMute = true
        send({ type: 'input_audio_buffer.clear' })
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
  connect()
  startMic()
})
