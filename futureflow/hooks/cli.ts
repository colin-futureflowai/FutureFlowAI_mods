import type { EngineInterface as Engine } from 'claude-code'

export function cliPath($: Engine): string {
  return `${$.plugin.root}/cli/api.mjs`
}

// Vaste waarden voor de CLI: `env` van $.process.run komt bovenop die van de host, dus zonder deze
// zouden SECURITY_BIN of SETTINGS_JSON uit een settings-`env`-blok de CLI bereiken (en SECURITY_BIN
// de key op stdin krijgen). Leeg = de standaard van de CLI.
const CLI_ENV = { SECURITY_BIN: '/usr/bin/security', SETTINGS_JSON: '', CLAUDE_JSON: '', OPENROUTER_DIR: '', OPENROUTER_URL: '', SHIM_DIR: '' }

// Draait cli/api.mjs. De desktop-app heeft een kaal PATH en argv[0] wordt daarop gezocht,
// dus `node` via /usr/bin/env met een PATH waar Homebrew vooraan staat.
// Ook gebruikt door hooks/openrouter.tsx en hooks/herstart.tsx (via deze module, zonder import-cyclus).
export async function cli($: Engine, args: string[], stdin?: string) {
  const init = { timeoutMs: 20_000, ...(stdin === undefined ? {} : { stdin }) }
  const isWin = (await $.env.get('OS')) === 'Windows_NT'
  if (isWin) return $.process.run(['node', cliPath($), ...args], { ...init, env: CLI_ENV })
  const hostPath = (await $.env.get('PATH')) ?? ''
  const PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${hostPath}`
  return $.process.run(['/usr/bin/env', 'node', cliPath($), ...args], { ...init, env: { ...CLI_ENV, PATH } })
}

