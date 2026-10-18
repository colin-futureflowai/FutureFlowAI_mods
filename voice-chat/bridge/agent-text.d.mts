// Types voor agent-text.mjs, zodat de tests van de mod het type-checken.

export const TOOL: string

export const TOOL_DEFINITION: { type: 'function'; name: string; description: string; parameters: object }

export function isTrusted(cwd: string, roots: readonly string[]): boolean

export function repoContext(input: {
  cwd: string
  project: string
  entries?: readonly string[]
  claudeMd?: string
  trusted: boolean
}): string

export function instructions(context: string): string

export function resultMessage(text: string): string

export type GateOutput = { status: string; toelichting?: string }

export type GateVerdict = { ok: true; taak: string; output: GateOutput } | { ok: false; output: GateOutput }

export function createTaskGate(): {
  userSpoke(): void
  reset(): void
  check(args: { taak?: unknown; bevestiging?: unknown } | null | undefined): GateVerdict
}
