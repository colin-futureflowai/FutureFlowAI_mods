import { expect, test } from 'claude-code/testing'

import { spinnerColor, spinnerIcon, toolIcon } from '../hooks/skins/icons'
import dracula from '../hooks/skins/themes/dracula'
import type { SpinnerMode } from '../hooks/skins/icons'

// An animated icon is an image the app may draw afresh when its row redraws, which
// starts its CSS animation over; a loop that repeats in a whole fraction of a second lands back in
// phase on the app's once-a-second redraws instead of jumping.
const periodsMs = (svg: string): number[] =>
  [...svg.matchAll(/animation:[a-z-]+ (\d*\.?\d+)(m?s)/g)].map(([, n, unit]) => (unit === 'ms' ? Number(n) : Math.round(Number(n) * 1000)))

const MODES: SpinnerMode[] = ['requesting', 'responding', 'thinking', 'tool-input', 'tool-use']

test('every spinner and running-tool loop repeats in a whole fraction of a second', () => {
  const icons = [...MODES.map(mode => [mode, spinnerIcon(mode, '#fff')] as const), ['running tool', toolIcon('run', '#fff', true)] as const]

  for (const [name, svg] of icons) {
    const periods = periodsMs(svg)
    expect(periods.length, `${name} animates`).toBeGreaterThan(0)
    // A whole fraction of a second, or whole seconds (the thinking orb breathes over two).
    for (const ms of periods) expect(1000 % ms === 0 || ms % 1000 === 0, `${name}: ${ms}ms`).toBe(true)
  }
})

test('the spinner takes its colour from what the turn is doing', () => {
  // A monochrome skin (noir) gives every activity the same colour, so the spinner keeps its own per activity.
  const mono = { read: '#eee', write: '#eee', run: '#eee', search: '#eee', web: '#eee', mcp: '#eee', user: '#f5f5f5' } as never
  const colours = new Set(MODES.map(mode => spinnerColor(mode, mono)))
  expect(colours.size).toBe(MODES.length)

  // A skin with its own activity colours lends them: thinking in its mcp colour, tools in its run colour.
  const palette = dracula.palette
  expect(spinnerColor('thinking', palette)).toBe(palette.mcp)
  expect(spinnerColor('tool-use', palette)).toBe(palette.run)
})
