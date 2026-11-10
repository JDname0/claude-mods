import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'indicateurs', component: 'Pane', requestId: 'indicateurs',
  props: { title: 'Indicateurs', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const CLAUDE_MD = `# Projet\n\n## Les trois règles qui priment\n\n1. **L'outil propose, tu décides.** Rien ne part sans oui.\n2. Aucune preuve inventée.\n\n## Où se trouve quoi\n`

test('raccourcis, tâches, notes et règles', async ($, on) => {
  const submitted: string[] = []
  const store = new Map<string, unknown>([['note:jdname0/qg', 'ancienne note']])
  on('command.register', () => ({ value: { command: 'indicateurs' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 1 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 85 }] } }))
  on('session.repo', () => ({ value: { root: '/w', remote: 'https://github.com/JDname0/QG.git', internal: false, name: null } }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.model', () => ({ value: 'opus' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.turns', () => ({ value: 1 }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('fs.exists', (_, e) => ({ value: ['/w/CLAUDE.md', '/w/RECAP.md', '/w/package.json'].includes((e as { path: string }).path) }))
  on('fs.read', (_, e) => {
    const path = (e as { path: string }).path
    return { value: path.endsWith('CLAUDE.md') ? CLAUDE_MD : '{ "scripts": { "dev": "next dev" } }' }
  })
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => { const x = e as { key: string; value: unknown }; store.set(x.key, x.value); return { value: undefined } })
  on('prompt.submit', (_, e) => { submitted.push((e as { text: string }).text); return { text: (e as { text: string }).text } })
  on('tool.call', (_, e) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: '1', subject: 'Écrire le test' } } }
    return { result: { success: true } }
  })

  await $.session.start({ cwd: '/w', surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 60))
  await $.tool.call({ tool: 'TaskCreate', subject: 'Écrire le test', description: 'x' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /L'outil propose, tu décides/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /▶ Écrire le test/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Limite 5 h à 85/ })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'sc-rituel' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'sc-serveur' })).toBeTruthy()

  await ui.press({ key: 'sc-point' })
  expect(submitted[0]).toContain('point rapide')

  await ui.input({ key: 'note', text: 'Penser au RECAP', kind: 'submit' })
  await new Promise(r => setTimeout(r, 20))
  expect(store.get('note:jdname0/qg')).toBe('Penser au RECAP')
  await ui.unmount()

  for (const surface of ['mobile', 'terminal'] as const) {
    const m = await $.ui.mount({ ...PANE, surface })
    expect(await m.find({ type: 'Text', text: /Tâches en cours/ })).toBeTruthy()
    await m.unmount()
  }
})

test('Résultats : un fichier écrit par Claude est listé', async ($, on) => {
  on('ui.toast', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1 }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Write', file_path: '/w/src/page.tsx', content: 'x' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /page\.tsx/ })).toBeTruthy()
  await ui.unmount()
})
