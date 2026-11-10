import { expect, mock, test } from 'claude-code/testing'

type Answer = Record<string, unknown>

// Nep-omgeving: env, sessie, bestanden (in een Map) en een systeemprompt met één sectie.
// Alle mocks vóór de eerste $-aanroep registreren.
function fake(on: any, begin: Record<string, string> = {}) {
  // De ingebouwde skin (claude-skins) meet tijd en start tikkers: een nepklok, en het design-tool.
  mock.clock(on)
  on('tool.register', () => ({ value: undefined }))
  const files = new Map<string, string>(Object.entries(begin))
  const store = new Map<string, unknown>()
  const status: (string | undefined)[] = []
  on('store.get', ($: any, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: { key: string; value: unknown }) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.status', ($: any, e: { text?: string }) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('env.get', ($: any, e: { name: string }) => ({ value: ({ HOME: '/home/t' } as Record<string, string>)[e.name] }))
  on('session.id', () => ({ value: 'sessie-1' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.write', ($: any, e: { path: string; text: string }) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', ($: any, e: { path: string }) => ({ value: files.get(e.path) ?? '' }))
  on('fs.exists', ($: any, e: { path: string }) => ({ value: files.has(e.path) }))
  // session.start van futureflow start ook Slots (niet in deze tests: agent-slots staat in oud) en registreert /minify.
  const registered: unknown[] = []
  on('command.register', ($: any, e: unknown) => {
    registered.push(e)
    return { value: undefined } as any
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', ($: any, e: any) => e)
  // Slots pakt Bash-commando's in (tenzij agent-slots in oud staat); een neppe CLI die alles toestaat.
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{"ok":true}\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  return { files, store, status, registered }
}

const minify = ($: any, args: string) =>
  $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 }, command: 'minify', args } as any)

const lang = (n: number) => Array.from({ length: n }, (_, i) => `✓ test ${i} slaagt in module-${String.fromCharCode(97 + (i % 26))}${i % 7}`).join('\n')

test('/minify O3 en uit schrijven het niveau voor het script; status zegt of de regels meegingen', async ($, on) => {
  const { files } = fake(on)
  await minify($, 'O3')
  expect(files.get('/home/t/.claude/minify/niveau/sessie-1')).toBe('O3')
  expect(String(((await minify($, 'status')) as Answer).text)).toContain('nog niet; ze gaan mee met je volgende bericht')
  files.set('/home/t/.claude/minify/gemeld/sessie-1', 'O3')
  expect(String(((await minify($, 'status')) as Answer).text)).toContain('Regels meegegeven aan Claude: ja, -O3')
  await minify($, 'uit')
  expect(files.get('/home/t/.claude/minify/niveau/sessie-1')).toBe('uit')
  await minify($, 'standaard O1')
  expect(files.get('/home/t/.claude/minify/standaard')).toBe('O1')
})

test('lange Bash-uitvoer wordt ingekort, het origineel staat op schijf', async ($, on) => {
  const { files } = fake(on)
  const stdout = lang(600) + '\nFAIL src/a.test.ts\n' + lang(400) + '\nTests: 1 failed'
  on('tool.call', () => ({ result: { stdout, stderr: '', interrupted: false } }))
  const r = (await $.tool.call({ tool: 'Bash', command: 'pnpm test' } as any)) as Answer
  const out = (r.result as { stdout: string }).stdout
  expect(out.length < stdout.length / 3).toBe(true)
  expect(out).toContain('FAIL src/a.test.ts')
  expect(out).toContain('Tests: 1 failed')
  expect(out).toContain('Volledige uitvoer: /home/t/.claude/minify/uitvoer/sessie-1/1-Bash.txt')
  expect(files.get('/home/t/.claude/minify/uitvoer/sessie-1/1-Bash.txt')).toBe(stdout)
  expect(r.ref).toBeUndefined()
})

test('korte uitvoer en minify uit: ongewijzigd', async ($, on) => {
  fake(on)
  let stdout = 'klaar\n'
  on('tool.call', () => ({ result: { stdout, stderr: '', interrupted: false } }))
  const kort = (await $.tool.call({ tool: 'Bash', command: 'ls' } as any)) as Answer
  expect((kort.result as { stdout: string }).stdout).toBe('klaar\n')
  await minify($, 'uit')
  stdout = lang(1000)
  const lang2 = (await $.tool.call({ tool: 'Bash', command: 'ls' } as any)) as Answer
  expect((lang2.result as { stdout: string }).stdout).toBe(stdout)
})

test('mislukt commando: de fouttekst wordt ingekort en blijft een fout', async ($, on) => {
  fake(on)
  const tekst = lang(800) + '\nError: kapot\n' + lang(300)
  on('tool.call', () => ({ isError: true, result: tekst, text: tekst }))
  const r = (await $.tool.call({ tool: 'Bash', command: 'pnpm build' } as any)) as Answer
  expect(String(r.deny)).toContain('wél uitgevoerd en mislukte')
  expect(String(r.deny)).toContain('Error: kapot')
  expect(String(r.deny).length < tekst.length / 3).toBe(true)
})

test('MCP-tool met tekstblokken wordt ingekort', async ($, on) => {
  fake(on)
  const snapshot = lang(1500)
  on('tool.call', () => ({ result: [{ type: 'text', text: snapshot }] }))
  const r = (await $.tool.call({ tool: 'mcp__plugin_playwright_playwright__browser_snapshot' } as any)) as Answer
  const blok = (r.result as { text: string }[])[0]!
  expect(blok.text).toContain('minify: uitvoer ingekort')
  expect(blok.text.length < snapshot.length / 3).toBe(true)
})

test('Read wordt nooit ingekort', async ($, on) => {
  fake(on)
  const inhoud = lang(2000)
  on('tool.call', () => ({ result: { type: 'text', file: { content: inhoud } } }))
  const r = (await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' } as any)) as Answer
  expect((r.result as { file: { content: string } }).file.content).toBe(inhoud)
})

test('/minify bestand weigert vault-notities en andere bestandstypen', async ($, on) => {
  fake(on)
  expect(String(((await minify($, 'bestand vault/plan.md')) as Answer).text)).toContain('vault')
  expect(String(((await minify($, 'bestand src/app.ts')) as Answer).text)).toContain('alleen .md')
})

test('/minify bestand, toepassen en herstel', async ($, on) => {
  const { files } = fake(on)
  const origineel = '# Project\n\nJe moet er eigenlijk altijd voor zorgen dat je eerst de tests draait voordat je iets pusht naar `main`.\n'
  const kort = '# Project\n\nTests draaien vóór push naar `main`.\n'
  files.set('/proj/CLAUDE.md', origineel)
  on('model.complete', () => ({ value: { isAnswered: true, text: kort, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))

  const voorstel = String(((await minify($, 'bestand CLAUDE.md')) as Answer).text)
  expect(voorstel).toContain('/minify toepassen')
  expect(files.get('/proj/CLAUDE.md')).toBe(origineel)

  await minify($, 'toepassen')
  expect(files.get('/proj/CLAUDE.md')).toBe(kort)
  expect(files.get('/home/t/.claude/minify/backups/proj__CLAUDE.original.md')).toBe(origineel)

  await minify($, 'herstel CLAUDE.md')
  expect(files.get('/proj/CLAUDE.md')).toBe(origineel)
})

test('/minify bestand: afgekeurd als het model code weghaalt', async ($, on) => {
  const { files } = fake(on)
  files.set('/proj/CLAUDE.md', '# A\n\nDraai altijd eerst `pnpm test` voordat je iets commit naar de repository.\n')
  on('model.complete', () => ({ value: { isAnswered: true, text: '# A\n\nTests vóór commit.\n', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  const r = String(((await minify($, 'bestand CLAUDE.md')) as Answer).text)
  expect(r).toContain('afgekeurd')
  expect(r).toContain('pnpm test')
  expect(String(((await minify($, 'toepassen')) as Answer).text)).toContain('geen voorstel')
})

test('output-tokens van de hoofdsessie worden geteld, die van subagents niet', async ($, on) => {
  const { store, status } = fake(on)
  const usage = { input_tokens: 10, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: 'm' }
  on('turn.complete', () => ({ text: 'x' }))
  const beurt = { answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', usage }
  await $.turn.complete({ ...beurt, turnId: 't1' } as any)
  await $.turn.complete({ ...beurt, turnId: 't2', agentId: 'a1' } as any)
  expect(store.get('minify.perNiveau')).toEqual({ O2: { beurten: 1, output: 120 } })
  expect(status.at(-1)).toBe('minify -O2 · ⌀ 120 uit/beurt')
  expect(String(((await minify($, 'stats')) as Answer).text)).toContain('O2        1 beurten')
})

test('heel grote uitvoer die Claude Code zelf wegschreef: het hele bestand wordt ingekort', async ($, on) => {
  const { files } = fake(on)
  const volledig = lang(3000) + '\nFAIL src/b.test.ts\nTests: 1 failed'
  files.set('/home/t/tool-results/x.txt', volledig)
  on('tool.call', () => ({ result: { stdout: volledig.slice(0, 2000), stderr: '', interrupted: false, persistedOutputPath: '/home/t/tool-results/x.txt', persistedOutputSize: volledig.length } }))
  const r = (await $.tool.call({ tool: 'Bash', command: 'pnpm test' } as any)) as Answer
  const res = r.result as { stdout: string; persistedOutputPath?: string }
  expect(res.persistedOutputPath).toBeUndefined()
  expect(res.stdout).toContain('FAIL src/b.test.ts')
  expect(res.stdout).toContain('Volledige uitvoer: /home/t/tool-results/x.txt')
})


const PANE = {
  plugin: 'futureflow',
  component: 'Pane',
  requestId: 'futureflow',
  props: { title: 'FutureFlowAI', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('dashboard: kaarten, grafiek op desktop, tekst in de terminal, niveauknop werkt', async ($, on) => {
  const { files } = fake(on)
  on('turn.complete', () => ({ text: 'x' }))
  on('tool.call', () => ({ result: { stdout: lang(800), stderr: '', interrupted: false } }))
  const usage = { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: 'm' }
  for (const [i, out] of [200, 400, 300].entries())
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', turnId: `t${i}`, usage: { ...usage, output_tokens: out } } as any)
  await $.tool.call({ tool: 'Bash', command: 'pnpm test' } as any)

  await minify($, '')
  // Ingeklapt: kerncijfers wel, grafiek pas onder Meer ▸ (hotkey m).
  const dicht = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(JSON.stringify(await dicht.drawn())).not.toContain('▄█▆')
  expect(await dicht.find({ type: 'Button', key: 'meer-zuinig', hotkey: 'm' } as any)).toBeDefined()
  await dicht.press({ key: 'meer-zuinig' } as any)
  await dicht.unmount()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Uitvoer ingekort$/ }))?.text).toBe('Uitvoer ingekort')
    expect((await ui.find({ type: 'Text', text: /^300$/ }))?.text).toBe('300')
    expect((await ui.find({ type: 'Text', text: /3 beurten deze sessie/ }))?.text).toBe('3 beurten deze sessie')
    const boom = JSON.stringify(await ui.drawn())
    if (surface === 'desktop') expect(boom).toContain('"type":"Svg"')
    else expect(boom).toContain('▄█▆')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'niveau-O3' } as any)
  expect(files.get('/home/t/.claude/minify/niveau/sessie-1')).toBe('O3')
  await ui.unmount()
})

const geen = { cwd: '/r', surface: 'terminal', isInteractive: true } as any
const S = 'agent-slots@futureflowai-mods'
const M = 'minify@futureflowai-mods'
const installed = (...namen: string[]) => JSON.stringify({ plugins: Object.fromEntries(namen.map(n => [n, [{}]])) })

test('neemt standaard uit het oude bestand over', async ($, on) => {
  const { files, store, registered } = fake(on, {
    '/home/t/.claude/plugins/installed_plugins.json': installed(S),
    '/home/t/.claude/minify/standaard': 'O1',
  })
  await $.session.start(geen)
  // /futureflow (dashboard) registreert ook; het gaat hier om /minify.
  expect(registered.filter(r => (r as { name: string }).name === 'minify').length).toBe(1)
  expect(files.get('/home/t/.claude/minify/niveau/sessie-1')).toBe('O1')
  expect(files.get('/home/t/.claude/minify/standaard')).toBe('O1')
  expect(store.get('minify.standaard')).toBeUndefined()
})

test('eigen standaard in de store gaat voor het oude bestand', async ($, on) => {
  const { files, store } = fake(on, {
    '/home/t/.claude/plugins/installed_plugins.json': installed(S),
    '/home/t/.claude/minify/standaard': 'O1',
  })
  store.set('minify.standaard', 'O3')
  await $.session.start(geen)
  expect(files.get('/home/t/.claude/minify/niveau/sessie-1')).toBe('O3')
})

test('zonder oud bestand of store is de standaard O2', async ($, on) => {
  const { files } = fake(on, { '/home/t/.claude/plugins/installed_plugins.json': installed(S) })
  await $.session.start(geen)
  expect(files.get('/home/t/.claude/minify/niveau/sessie-1')).toBe('O2')
})

test('kort niets in als oude minify aan staat', async ($, on) => {
  const { files } = fake(on, { '/home/t/.claude/plugins/installed_plugins.json': installed(S, M) })
  const stdout = lang(1500)
  expect(stdout.length > 40_000).toBe(true)
  on('tool.call', () => ({ result: { stdout, stderr: '', interrupted: false } }))
  await $.session.start(geen)
  const r = (await $.tool.call({ tool: 'Bash', command: 'pnpm test' } as any)) as Answer
  expect((r.result as { stdout: string }).stdout).toBe(stdout)
  expect([...files.keys()].some(p => p.includes('/uitvoer/'))).toBe(false)
})

test('oude minify aan: session.start registreert /minify niet en schrijft geen regels', async ($, on) => {
  const { files, registered } = fake(on, { '/home/t/.claude/plugins/installed_plugins.json': installed(S, M) })
  await $.session.start(geen)
  expect(registered.filter(r => (r as { name: string }).name === 'minify').length).toBe(0)
  expect([...files.keys()].some(p => p.startsWith('/home/t/.claude/minify/'))).toBe(false)
})

test('oude minify aan: command.run minify gaat door naar de oude plugin', async ($, on) => {
  const { files } = fake(on, { '/home/t/.claude/plugins/installed_plugins.json': installed(S, M) })
  on('command.run', () => ({ text: 'oude plugin' }) as any)
  await $.session.start(geen)
  const r = (await minify($, 'O3')) as Answer
  expect(r.text).toBe('oude plugin')
  expect(files.get('/home/t/.claude/minify/niveau/sessie-1')).toBeUndefined()
})

test('oude minify aan: het dashboard tekent futureflow niet', async ($, on) => {
  const { files } = fake(on, { '/home/t/.claude/plugins/installed_plugins.json': installed(S) })
  // Eerst zonder oude minify (het niveau staat dan in de state), daarna komt de oude plugin erbij.
  await $.session.start(geen)
  files.set('/home/t/.claude/plugins/installed_plugins.json', installed(S, M))
  await $.session.start(geen)
  // Er is niets onder futureflow dat het paneel tekent (de oude plugin staat buiten deze test): mounten mag falen.
  let getekend = ''
  try {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    getekend = JSON.stringify(await ui.drawn())
    await ui.unmount()
  } catch {
    // verwacht: geen implementatie eronder
  }
  expect(getekend).not.toContain('Uitvoer ingekort')
})

test('oude minify aan: prompt.submit en turn.complete tellen niets', async ($, on) => {
  const { store } = fake(on, { '/home/t/.claude/plugins/installed_plugins.json': installed(S, M) })
  on('turn.complete', () => ({ text: 'x' }))
  await $.session.start(geen)
  const usage = { input_tokens: 10, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: 'm' }
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', usage, turnId: 't1' } as any)
  expect(store.get('minify.perNiveau')).toBeUndefined()
})

test('oude minify aan: "doe normaal" zet het niveau van futureflow niet uit', async ($, on) => {
  const { files } = fake(on, { '/home/t/.claude/plugins/installed_plugins.json': installed(S, M) })
  on('prompt.submit', ($: any, e: any) => e)
  await $.session.start(geen)
  await $.prompt.submit({ text: 'doe normaal' } as any)
  expect(files.get('/home/t/.claude/minify/niveau/sessie-1')).toBeUndefined()
})
