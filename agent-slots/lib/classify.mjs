// Herkent zware shell-commando's. Puur JavaScript: gebruikt door de hooks-module én de CLI.
//
// classify(command) → { kind, segment, reason }
//   kind: 'dev' | 'test' | 'browser' | 'agent' | 'unknown-heavy' | null
//   segment: het stuk van het commando dat de doorslag gaf
//   reason: korte uitleg voor het log

// Commando's die zelf niets zwaars doen en het echte commando als argument meekrijgen.
const WRAPPERS = new Set(['env', 'time', 'nohup', 'nice', 'caffeinate', 'command', 'exec', 'sudo', 'timeout'])
// Pakketbeheerders: `pnpm dev` is een script, `pnpm exec x` / `npx x` draait x.
const RUNNERS = new Set(['pnpm', 'npm', 'yarn', 'bun'])
const EXECUTORS = new Set(['npx', 'pnpx', 'bunx'])

const DEV_SCRIPTS = /^(dev|start|serve|preview|watch)([:-].*)?$/
const TEST_SCRIPTS = /^(test|tests|e2e|typecheck|type-check|types|tsc|build|check|lint)([:-].*)?$/
const DEV_BINS = new Set(['next', 'vite', 'nuxt', 'astro', 'remix', 'webpack-dev-server', 'nodemon', 'wrangler', 'expo', 'ng', 'svelte-kit', 'storybook', 'turbo', 'nx', 'tsx'])
const TEST_BINS = new Set(['vitest', 'jest', 'mocha', 'ava', 'tsc', 'vue-tsc', 'tsup', 'esbuild', 'rollup', 'webpack', 'eslint', 'cypress'])
const AGENT_BINS = new Set(['claude', 'codex', 'gemini', 'aider', 'opencode'])

// Splitst op &&, ||, ;, | en nieuwe regels, zonder binnen quotes te knippen.
export function splitSegments(command) {
  const parts = []
  let cur = ''
  let quote = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      cur += c
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < command.length) cur += command[++i]
      continue
    }
    if (c === "'" || c === '"') { quote = c; cur += c; continue }
    if (c === '\\' && i + 1 < command.length) { cur += c + command[++i]; continue }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') { parts.push(cur); cur = ''; i++; continue }
    // `2>&1` en `&>` zijn omleidingen, geen scheiding.
    if (c === '&' && (command[i - 1] === '>' || command[i - 1] === '<' || command[i + 1] === '>')) { cur += c; continue }
    if (c === ';' || c === '|' || c === '\n' || c === '&') { parts.push(cur); cur = ''; continue }
    cur += c
  }
  parts.push(cur)
  return parts.map(s => s.trim().replace(/^[({]\s*|\s*[)}]$/g, '').trim()).filter(Boolean)
}

// Woorden van één stuk, quotes eraf.
export function words(segment) {
  const out = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

// Laat omgevingsvariabelen, wrappers en hun opties weg; geeft de rest terug.
function stripPrefix(w) {
  let i = 0
  while (i < w.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i])) { i++; continue }
    if (WRAPPERS.has(w[i])) {
      i++
      while (i < w.length && (w[i].startsWith('-') || /^\d+[smhd]?$/.test(w[i]))) i++
      continue
    }
    break
  }
  return w.slice(i)
}

const base = s => s.split(/[\\/]/).pop().replace(/\.(cmd|exe|ps1)$/i, '')

function classifyWords(w) {
  w = stripPrefix(w)
  if (!w.length) return null
  const bin = base(w[0])
  const args = w.slice(1)

  if (bin === 'cd' || bin === 'pushd' || bin === 'export' || bin === 'source' || bin === '.') return null
  if (bin === 'agent-slot' || /agent-slot\.mjs$/.test(w[0]) || (bin === 'node' && /agent-slot\.mjs$/.test(args[0] ?? ''))) return { kind: 'self' }

  if (EXECUTORS.has(bin)) return classifyWords(args.filter((a, i) => !(i === 0 && a.startsWith('-')) && a !== '--yes' && a !== '-y'))
  if (RUNNERS.has(bin)) {
    // Opties met een waarde (`--filter web`) slaan we samen met die waarde over;
    // de vorm met `=` (`--filter=web`) is één woord en valt onder de gewone opties.
    const VALUE_FLAGS = ['--filter', '-F', '-C', '--dir', '--prefix', '--cwd', '-w', '--workspace']
    const rest = []
    for (let i = 0; i < args.length; i++) {
      if (VALUE_FLAGS.includes(args[i])) { i++; continue }
      if (args[i].startsWith('-') && args[i] !== '--') continue
      rest.push(args[i])
    }
    // `yarn workspace <naam> <script>`: de naam is geen script.
    if (bin === 'yarn' && rest[0] === 'workspace') rest.splice(0, 2)
    if (rest[0] === 'exec' || rest[0] === 'dlx' || rest[0] === 'x') return classifyWords(rest.slice(1))
    if (rest[0] === 'run' || rest[0] === 'run-script') rest.shift()
    const script = rest[0]
    if (!script) return null
    if (['install', 'i', 'add', 'ci', 'update', 'up'].includes(script)) return { kind: 'unknown-heavy', reason: `${bin} ${script}` }
    if (script === 'playwright' || /^(e2e|test:e2e)/.test(script) && rest.includes('playwright')) return classifyWords(rest)
    if (DEV_SCRIPTS.test(script)) return { kind: 'dev', reason: `${bin} ${script}` }
    if (TEST_SCRIPTS.test(script)) return { kind: 'test', reason: `${bin} ${script}` }
    if (DEV_BINS.has(script) || TEST_BINS.has(script) || script === 'playwright') return classifyWords(rest)
    return null
  }

  if (bin === 'playwright') {
    if (args[0] === 'test') return { kind: 'test', reason: 'playwright test' }
    if (['open', 'codegen', 'show-trace', 'show-report'].includes(args[0])) return { kind: 'browser', reason: `playwright ${args[0]}` }
    return { kind: 'unknown-heavy', reason: `playwright ${args[0] ?? ''}`.trim() }
  }
  if (bin === 'next' || bin === 'nuxt' || bin === 'astro' || bin === 'remix') {
    if (args[0] === 'build') return { kind: 'test', reason: `${bin} build` }
    if (args[0] === 'lint') return { kind: 'test', reason: `${bin} lint` }
    if (!args[0] || ['dev', 'start', 'preview'].includes(args[0])) return { kind: 'dev', reason: `${bin} ${args[0] ?? 'dev'}` }
    return null
  }
  if (bin === 'vite') return args[0] === 'build' ? { kind: 'test', reason: 'vite build' } : { kind: 'dev', reason: 'vite' }
  if (bin === 'wrangler' || bin === 'expo' || bin === 'storybook') return ['dev', 'start', undefined].includes(args[0]) ? { kind: 'dev', reason: `${bin} ${args[0] ?? ''}`.trim() } : null
  if (bin === 'turbo' || bin === 'nx') {
    const task = args.find(a => !a.startsWith('-') && a !== 'run' && a !== 'run-many')
    if (task && DEV_SCRIPTS.test(task)) return { kind: 'dev', reason: `${bin} ${task}` }
    if (task && TEST_SCRIPTS.test(task)) return { kind: 'test', reason: `${bin} ${task}` }
    return { kind: 'unknown-heavy', reason: `${bin} ${task ?? ''}`.trim() }
  }
  if (DEV_BINS.has(bin)) return bin === 'tsx' && !args.includes('watch') ? null : { kind: 'dev', reason: bin }
  if (TEST_BINS.has(bin)) {
    if (bin === 'tsc' && (args.includes('--version') || args.includes('-v'))) return null
    return { kind: 'test', reason: bin }
  }
  if (bin === 'node' || bin === 'deno' || bin === 'bun') {
    if (args.includes('--test') || args[0] === 'test') return { kind: 'test', reason: `${bin} --test` }
    if (args.includes('--watch')) return { kind: 'dev', reason: `${bin} --watch` }
    return null
  }
  if (bin === 'docker' || bin === 'docker-compose' || bin === 'podman') {
    if (args.includes('up') || args[0] === 'run' || args[0] === 'build') return { kind: 'unknown-heavy', reason: `${bin} ${args[0]}` }
    return null
  }
  if (bin === 'python' || bin === 'python3' || bin === 'uv' || bin === 'pytest') {
    if (bin === 'pytest' || args.includes('pytest')) return { kind: 'test', reason: 'pytest' }
    if (args.some(a => /^(runserver|uvicorn|flask|streamlit)$/.test(a))) return { kind: 'dev', reason: `${bin} server` }
    return null
  }
  if (bin === 'uvicorn' || bin === 'flask' || bin === 'streamlit' || bin === 'hugo' || bin === 'jekyll') return { kind: 'dev', reason: bin }
  if (bin === 'cargo' || bin === 'go' || bin === 'gradle' || bin === 'gradlew' || bin === 'mvn' || bin === 'xcodebuild' || bin === 'swift') {
    if (['test', 'build', 'check'].includes(args[0]) || bin === 'xcodebuild') return { kind: 'test', reason: `${bin} ${args[0] ?? ''}`.trim() }
    if (args[0] === 'run') return { kind: 'dev', reason: `${bin} run` }
    return null
  }
  if (AGENT_BINS.has(bin)) {
    // Alleen een nieuwe agent-run telt; `claude plugin …`, `claude --version` niet.
    if (bin === 'claude' && (args.includes('-p') || args.includes('--print'))) return { kind: 'agent', reason: 'claude -p' }
    if (bin === 'codex' && (args[0] === 'exec' || args[0] === 'e')) return { kind: 'agent', reason: 'codex exec' }
    if ((bin === 'gemini' || bin === 'opencode') && (args.includes('-p') || args[0] === 'run')) return { kind: 'agent', reason: bin }
    if (bin === 'aider' && args.includes('--message')) return { kind: 'agent', reason: 'aider --message' }
    return null
  }
  if (bin === 'orca' && args.some(a => /^(spawn|create|new|launch)$/.test(a))) return { kind: 'agent', reason: `orca ${args.join(' ')}`.slice(0, 60) }
  return null
}

// Het stuk zonder omleidingen (`> log`, `2>&1`), zodat meldingen tonen wát er draait.
export function cleanSegment(segment) {
  return segment.replace(/\s*\d*(>>?|<)&?\s*("[^"]*"|'[^']*'|\S+)/g, '').replace(/\s+/g, ' ').trim()
}

// Volgorde van zwaarte: het zwaarste stuk wint.
const RANK = { browser: 5, dev: 4, test: 3, agent: 2, 'unknown-heavy': 1 }

export function classify(command) {
  if (typeof command !== 'string' || !command.trim()) return { kind: null }
  let best = { kind: null }
  for (const segment of splitSegments(command)) {
    const r = classifyWords(words(segment))
    if (!r) continue
    if (r.kind === 'self') return { kind: 'self', segment }
    if (!best.kind || RANK[r.kind] > RANK[best.kind]) best = { ...r, segment: cleanSegment(segment) }
  }
  return best
}

// True als het commando iets met een losse `&` op de achtergrond zet (buiten quotes).
// Dan zou `agent-slot run` het proces kwijtraken; de mod vraagt om run_in_background.
export function hasShellBackground(command) {
  let quote = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) { if (c === quote) quote = null; else if (c === '\\') i++; continue }
    if (c === "'" || c === '"') { quote = c; continue }
    if (c === '\\') { i++; continue }
    if (c !== '&') continue
    const prev = command[i - 1], next = command[i + 1]
    if (next === '&') { i++; continue }
    if (prev === '>' || prev === '<' || next === '>') continue // 2>&1, &>
    return true
  }
  return false
}

// Het commando ingepakt in `agent-slot run`. `cli` is het pad naar agent-slot.mjs.
export function wrapCommand(command, kind, cli, { session, label, node = 'node' } = {}) {
  const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`
  const sess = session ? ` --session ${q(session)}` : ''
  const lab = label ? ` --label ${q(label.slice(0, 120))}` : ''
  return `${q(node)} ${q(cli)} run ${kind}${sess}${lab} -- sh -c ${q(command)}`
}

// Haalt het originele commando terug uit een ingepakt commando (voor tool.check).
export function unwrapCommand(command) {
  const m = /^'[^']*' '[^']*agent-slot\.mjs' run [a-z-]+(?: --session '[^']*')?(?: --label '(?:[^']|'\\'')*')? -- sh -c '((?:[^']|'\\'')*)'$/.exec(command)
  return m ? m[1].replace(/'\\''/g, "'") : null
}
