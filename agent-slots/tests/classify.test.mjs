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
    'pnpm --filter=web dev',
    'yarn workspace web dev',
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
    'yarn workspace api test',
  ]) assert.equal(kind(c), 'test', c)
})

test('yarn workspaces foreach classificeert naar het script', () => {
  assert.equal(kind('yarn workspaces foreach -A run test'), 'test')
  assert.equal(kind('yarn workspaces foreach --all --parallel run dev'), 'dev')
  assert.equal(kind('yarn workspaces foreach -A test'), 'test')
  assert.equal(kind('yarn workspaces foreach -pi -v --topological run build'), 'test')
  assert.equal(kind('yarn workspaces foreach --all -p --interlaced dev'), 'dev')
  assert.equal(kind("yarn workspaces foreach --include 'apps/*' --exclude 'apps/docs' -p run dev"), 'dev')
  assert.equal(kind('yarn workspaces foreach --include test run lint'), 'test')
  assert.equal(kind('yarn workspaces foreach --exclude dev -A run dev'), 'dev')
  assert.equal(kind('yarn workspaces foreach -A -j 4 run typecheck'), 'test')
  assert.equal(classify('yarn workspaces foreach -A run test').reason, 'yarn test')
  assert.equal(kind('yarn workspaces foreach -A run clean'), null)
  assert.equal(kind('yarn workspaces list'), null)
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
  // Pakketten toevoegen in een workspace is geen dev-server of test.
  for (const c of ['yarn workspace web add react', 'pnpm --filter=web add react']) {
    assert.notEqual(kind(c), 'dev', c)
    assert.notEqual(kind(c), 'test', c)
  }
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

test('geheimen worden gemaskeerd in labels, het commando zelf blijft ongewijzigd', async () => {
  const { maskSecrets } = await import('../lib/classify.mjs')
  const cases = [
    ['TWILIO_WEBHOOK_BASE_URL=http://x.ngrok.app PORT=6001 pnpm dev', 'TWILIO_WEBHOOK_BASE_URL=*** PORT=6001 pnpm dev'],
    ['OPENAI_API_KEY=sk-abcdefghijklmnopqrstuv pnpm test', 'OPENAI_API_KEY=*** pnpm test'],
    ['curl -H "Authorization: Bearer abcdefghijkl123" https://api', 'curl -H "Authorization: Bearer ***" https://api'],
    ['git clone https://user:hunter2@github.com/x/y', 'git clone https://***@github.com/x/y'],
    ['pnpm dev --token=abc123 --port 3000', 'pnpm dev --token=*** --port 3000'],
    ['NODE_ENV=test vitest run', 'NODE_ENV=test vitest run'],
    ['echo ghp_abcdefghijklmnopqrstuvwxyz12', 'echo ***'],
    ['pnpm --filter=web dev', 'pnpm --filter=web dev'],
  ]
  for (const [input, want] of cases) assert.equal(maskSecrets(input), want, input)

  const cmd = 'cd web && STRIPE_SECRET_KEY=sk_test_abcdefghijkl pnpm dev'
  const c = classify(cmd)
  assert.equal(c.segment, 'STRIPE_SECRET_KEY=*** pnpm dev', 'label gemaskeerd')
  const w = wrapCommand(cmd, c.kind, '/x/agent-slot.mjs', { label: c.segment })
  assert.equal(unwrapCommand(w), cmd, 'het echte commando draait ongewijzigd')
  assert.doesNotMatch(w.split(' -- sh -c ')[0], /sk_test_/, 'geen geheim in het label van de wrapper')
})
