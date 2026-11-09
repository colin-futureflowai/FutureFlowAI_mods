import { expect, mock, test } from 'claude-code/testing'

const S = 'agent-slots@futureflowai-mods'
const M = 'minify@futureflowai-mods'

// Nep-omgeving: bestanden in een Map; alle on(...)-mocks vóór de eerste $-aanroep.
function fake(on: any, files: Record<string, string>, env: Record<string, string> = {}, dirs: Record<string, string[]> = {}) {
  // De ingebouwde skin (claude-skins) meet tijd en start tikkers: een nepklok, en het design-tool.
  mock.clock(on)
  on('tool.register', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.usage', () => ({ value: { context: { tokens: 0, window: 200000 }, rateLimits: [] } }))
  on('config.list', () => ({ value: [] }))
  const written = new Map<string, string>()
  const toasts: string[] = []
  const vars: Record<string, string> = { HOME: '/home/t', ...env }
  on('env.get', ($: any, e: { name: string }) => ({ value: vars[e.name] }))
  on('fs.read', ($: any, e: { path: string }) => ({ value: files[e.path] ?? '' }))
  on('fs.write', ($: any, e: { path: string; text: string }) => {
    written.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.toast', ($: any, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // fs.list: alleen mappen uit `dirs` bestaan (naam eindigend op `/` = submap); andere paden falen zoals een ontbrekende map.
  on('fs.list', ($: any, e: { path: string }) => {
    if (!(e.path in dirs)) throw new Error('ENOENT')
    return { value: dirs[e.path].map(naam => ({ name: naam, kind: 'dir', size: 0, mtimeMs: 0 })) }
  })
  on('session.start', ($: any, e: any) => e)
  // Het onderdeel Slots start mee in session.start (tenzij de oude plugin aan staat): neppe CLI en paneel.
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.panes', () => ({ value: [] }))
  // Het onderdeel Minify start ook mee (tenzij de oude plugin aan staat): neppe store, statusregel en sessie.
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'sessie-1' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{}\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  return { written, toasts }
}

const installedBoth = JSON.stringify({ plugins: { [S]: [{}], [M]: [{}] } })

test('session.start schrijft oud met slots,minify als beide aanwezig zijn', async ($, on) => {
  const f = fake(on, { '/home/t/.claude/plugins/installed_plugins.json': installedBoth })
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true } as any)
  expect(f.written.get('/home/t/.claude/futureflow/oud')).toBe('slots,minify')
  expect(f.toasts.length).toBe(1)
  expect(f.toasts[0]).toContain(`claude plugin uninstall ${S} ${M}`)
})

test('session.start schrijft een leeg oud-bestand zonder oude plugins, en geen toast', async ($, on) => {
  const f = fake(on, {})
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true } as any)
  expect(f.written.get('/home/t/.claude/futureflow/oud')).toBe('')
  expect(f.toasts).toEqual([])
})

test('FUTUREFLOW_HOME bepaalt waar oud komt; uitgeschakelde plugin telt niet mee', async ($, on) => {
  const f = fake(
    on,
    {
      '/home/t/.claude/plugins/installed_plugins.json': installedBoth,
      '/home/t/.claude/settings.json': JSON.stringify({ enabledPlugins: { [M]: false } }),
    },
    { FUTUREFLOW_HOME: '/tmp/ff' },
  )
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true } as any)
  expect(f.written.get('/tmp/ff/oud')).toBe('slots')
  expect(f.toasts[0]).toContain(`claude plugin uninstall ${S}`)
  expect(f.toasts[0]).not.toContain(M)
})

test('oud herkent een gesynchroniseerde kopie onder plugins/synced, tenzij uitgeschakeld', async ($, on) => {
  const dirs = {
    '/home/t/.claude/plugins/synced': ['acc1', 'acc2'],
    '/home/t/.claude/plugins/synced/acc1': ['minify~g2', 'andere'],
    '/home/t/.claude/plugins/synced/acc2': ['agent-slots'],
  }
  const f = fake(on, {}, {}, dirs)
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true } as any)
  expect(f.written.get('/home/t/.claude/futureflow/oud')).toBe('slots,minify')
})

test('oud: een uitgeschakelde of ontbrekende synced kopie telt niet mee', async ($, on) => {
  const dirs = { '/home/t/.claude/plugins/synced': ['acc1'], '/home/t/.claude/plugins/synced/acc1': ['minify', 'agent-slots'] }
  const f = fake(on, { '/home/t/.claude/settings.json': JSON.stringify({ enabledPlugins: { 'minify@synced': false } }) }, {}, dirs)
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true } as any)
  expect(f.written.get('/home/t/.claude/futureflow/oud')).toBe('slots')
})
