// node --test agent-slots/tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, cleanSegment, hasShellBackground, unwrapCommand, wrapCommand } from '../lib/classify.mjs'

const kind = c => classify(c).kind

test('dev-servers in allerlei vormen', () => {
  for (const c of [
    'pnpm dev',
    'next dev',
    'NODE_OPTIONS=--max-old-space-size=4096 pnpm dev',
    'cd apps/web && pnpm dev',
    'cd "my app" && npm run dev -- --port 3001',
    'pnpm --filter web dev',
    'npx next dev -p 3000',
    'npm start',
    'yarn dev:web',
    'env PORT=4000 pnpm run dev',
    'vite',
    'wrangler dev',
    'turbo run dev',
    'node --watch server.js',
  ]) assert.equal(kind(c), 'dev', c)
})

test('tests, typecheck en builds', () => {
  for (const c of [
    'pnpm test',
    'vitest run',
    'npx vitest',
    'node --test',
    'node --test tests/',
    'tsc --noEmit',
    'pnpm typecheck',
    'pnpm exec tsc -p .',
    'npx playwright test',
    'pnpm build',
    'next build',
    'cargo test',
    'pytest -x',
    'jest --watch',
  ]) assert.equal(kind(c), 'test', c)
})

test('browser en agents', () => {
  assert.equal(kind('npx playwright open https://example.com'), 'browser')
  assert.equal(kind('npx playwright codegen'), 'browser')
  assert.equal(kind('claude -p "doe iets"'), 'agent')
  assert.equal(kind('codex exec "fix"'), 'agent')
  assert.equal(kind('orca worktree spawn --agent claude'), 'agent')
})

test('label: het zware deel zonder omleidingen', () => {
  assert.equal(classify('echo "START $(date +%T)"; pnpm test > /tmp/x/out.log 2>&1').segment, 'pnpm test')
  assert.equal(classify('PORT=6001 pnpm dev 2>&1 | head -15').segment, 'PORT=6001 pnpm dev')
  assert.equal(cleanSegment('vitest run >> "my log.txt"'), 'vitest run')
})

test('zwaarste stuk wint', () => {
  assert.equal(kind('pnpm test && pnpm dev'), 'dev')
  assert.equal(kind('pnpm install && pnpm test'), 'test')
})

test('lichte commando\'s blijven ongemoeid', () => {
  for (const c of [
    'ls -la',
    'git status',
    'cat package.json',
    'grep -r "pnpm dev" .',
    'echo "pnpm dev"',
    'kill 1234',
    'pkill -f "next dev"',
    'node script.mjs',
    'node --check bin/x.mjs',
    'tsc --version',
    'claude plugin validate .',
    'claude --version',
    'pnpm --version',
    'npm view react version',
    'lsof -i :3000',
  ]) assert.equal(kind(c), null, c)
})

test('twijfelgevallen worden zwaar-onbekend (doorlaten en loggen)', () => {
  assert.equal(kind('pnpm install'), 'unknown-heavy')
  assert.equal(kind('docker compose up'), 'unknown-heavy')
})

test('agent-slot zelf wordt herkend', () => {
  assert.equal(kind('agent-slot wait dev'), 'self')
  assert.equal(kind("node '/x/agent-slot.mjs' status"), 'self')
})

test('achtergrond met & wordt herkend, 2>&1 en && niet', () => {
  assert.equal(hasShellBackground('pnpm dev &'), true)
  assert.equal(hasShellBackground('pnpm dev > log 2>&1 &'), true)
  assert.equal(hasShellBackground('pnpm dev > log 2>&1'), false)
  assert.equal(hasShellBackground('cd x && pnpm dev'), false)
  assert.equal(hasShellBackground('echo "a & b"'), false)
  assert.equal(hasShellBackground('pnpm dev &> log'), false)
})

test('inpakken en terughalen geeft het originele commando', () => {
  for (const c of ['pnpm dev', `cd "it's here" && pnpm dev`, "echo 'a' | grep a && next dev"]) {
    const w = wrapCommand(c, 'dev', '/Users/x/.claude/agent-slots/bin/agent-slot.mjs', { session: 'abc-123', label: "it's pnpm dev" })
    assert.equal(unwrapCommand(w), c)
  }
  assert.equal(unwrapCommand('pnpm dev'), null)
})
