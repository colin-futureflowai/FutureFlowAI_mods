export type Kind = 'dev' | 'test' | 'browser' | 'agent' | 'unknown-heavy' | 'self'
export type Classified = { kind: Kind | null; segment?: string; reason?: string }
export function splitSegments(command: string): string[]
export function words(segment: string): string[]
export function classify(command: string): Classified
export function hasShellBackground(command: string): boolean
export function wrapCommand(command: string, kind: string, cli: string, opts?: { session?: string; label?: string; node?: string }): string
export function unwrapCommand(command: string): string | null
