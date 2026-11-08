import type { Register } from 'claude-code'

import { failOpen, oud, stateDir, vergeetOud } from './ctx'
import { registerSlots, startSlots } from './slots'

const MARKETPLACE = 'futureflowai-mods'

export const register: Register = (on, options) => {
  registerSlots(on)

  // Schrijft welke oude plugins aanwezig zijn naar <state>/oud, voor regels.sh.
  on('session.start', async ($, e, next) => {
    vergeetOud()
    const gevonden = await oud($)
    const aanwezig = [gevonden.slots && 'slots', gevonden.minify && 'minify'].filter(Boolean) as string[]
    const dir = await stateDir($)
    if (dir) await $.fs.write(`${dir}/oud`, aanwezig.join(','))
    if (aanwezig.length) {
      const namen = [gevonden.slots && 'agent-slots', gevonden.minify && 'minify'].filter(Boolean).map(n => `${n}@${MARKETPLACE}`)
      $.ui.toast(
        `futureflow: agent-slots en/of minify staan nog aan. futureflow laat die onderdelen over aan de oude plugin tot je ze verwijdert: claude plugin uninstall ${namen.join(' ')}`,
      )
    }
    await startSlots($)
    return next(e)
  }).catch((($: any, e: any, next: any) => {
    if (next.error.kind !== 're-entry') failOpen($, next.error.message ?? next.error.kind)
    return next(e)
  }) as any)
}
