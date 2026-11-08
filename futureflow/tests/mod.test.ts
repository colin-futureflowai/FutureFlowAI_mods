import { expect, test } from 'claude-code/testing'

const S = 'agent-slots@futureflowai-mods'
const M = 'minify@futureflowai-mods'

// Nep-omgeving: bestanden in een Map; alle on(...)-mocks vóór de eerste $-aanroep.
function fake(on: any, files: Record<string, string>, env: Record<string, string> = {}) {
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
  on('session.start', ($: any, e: any) => e)
  // Het onderdeel Slots start mee in session.start (tenzij de oude plugin aan staat): neppe CLI en paneel.
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.panes', () => ({ value: [] }))
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
  expect(f.toasts.length).toBe(0)
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
