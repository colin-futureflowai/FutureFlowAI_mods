import type { Skin } from '../skin'

// futureflow: FutureFlowAI-huisstijl. Groen #32a029 als accent, grijs #3D3D3D als vlak, wit en zwart.
// Op donker een iets lichter groen, op licht een iets donkerder groen, zodat de tekst leesbaar blijft.
const skin: Skin = {
  name: 'futureflow',
  label: 'FutureFlowAI',
  palette: {
    read: '#8fdc89',
    write: '#3fbf35',
    run: '#e0e0e0',
    search: '#6fcf68',
    web: '#a8e6a3',
    mcp: '#5cc455',
    other: '#bdbdbd',
    user: '#3fbf35',
    fg: '#f2f2f2',
    muted: '#8a8a8a',
    surface: '#3d3d3d',
    zebra: '#2b2b2b',
    ok: '#3fbf35',
    err: '#f26b5b',
    warn: '#e0b341',
  },
  light: {
    read: '#237a1c',
    write: '#2a8a22',
    run: '#3d3d3d',
    search: '#1f6e19',
    web: '#2a8a22',
    mcp: '#237a1c',
    other: '#5c5c5c',
    user: '#2a8a22',
    fg: '#111111',
    muted: '#6b6b6b',
    surface: '#eef6ed',
    zebra: '#f7faf7',
    ok: '#2a8a22',
    err: '#c42b2b',
    warn: '#9a6700',
  },
  spinner: ['Bouwen', 'Stromen', 'Automatiseren', 'Verbinden', 'Schakelen', 'Uitdenken'],
  done: ['Klaar', 'Gebouwd', 'Gestroomd', 'Geautomatiseerd'],
}

export default skin
