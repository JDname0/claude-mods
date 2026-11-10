import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Changes, Connector, Place, Task, Usage } from '../types'

const PANE = 'indicateurs'
const TITLE = 'Indicateurs'

const usage = atom({ plugin: 'indicateurs', key: 'usage' } as const, null, { shape: 'usage-2' })
const place = atom({ plugin: 'indicateurs', key: 'place' } as const, null, { shape: 'place-3' })
const changes = atom({ plugin: 'indicateurs', key: 'changes' } as const, null, { shape: 'changes-2' })
const connectors = atom({ plugin: 'indicateurs', key: 'connectors' } as const, null)
const isChecking = atom({ plugin: 'indicateurs', key: 'isChecking' } as const, false)
const isCompacting = atom({ plugin: 'indicateurs', key: 'isCompacting' } as const, false)
const noTasks: Task[] = []
const tasks = atom({ plugin: 'indicateurs', key: 'tasks' } as const, noTasks, { shape: 'tasks-1' })
const note = atom({ plugin: 'indicateurs', key: 'note' } as const, null)
const warned = new Set<string>()

const SHORTCUTS = {
  point: "Fais-moi un point rapide : où en est-on dans cette session, ce qui est fait, ce qui reste, et la prochaine étape.",
  rituel: "Fais le rituel de fin de session décrit dans le CLAUDE.md de ce projet (RECAP.md, journal du jour), puis dis-moi ce qui mérite d'être figé.",
  fin: "Prépare la fin de session : résume ce qui a été fait, ce qui reste, et propose les commits à faire. Ne pousse rien.",
  serveur: "Lance le serveur local de ce projet en arrière-plan (voir CLAUDE.md ou package.json) et donne-moi l'adresse.",
  verif: "Relis les modifications en cours (git diff), signale les problèmes éventuels et propose un message de commit. Ne commite et ne pousse rien.",
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    if (!(await $.fs.exists(path))) return null
    const t = await $.fs.read(path)
    return typeof t === 'string' ? t : null
  } catch {
    return null
  }
}

function clean(line: string): string {
  const t = line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').replace(/\*\*|`/g, '').trim()
  return t.length > 110 ? `${t.slice(0, 107)}…` : t
}

async function readRules($: EngineInterface, cwd: string): Promise<string[]> {
  let text = await readText($, `${cwd}/CLAUDE.md`)
  if (text && /^\s*@AGENTS\.md\s*$/m.test(text) && text.trim().length < 40) {
    text = await readText($, `${cwd}/AGENTS.md`)
  }
  if (!text) return []
  const lines = text.split('\n')
  const out: string[] = []
  let inRules = false
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      inRules = /r[eè]gle|interdit|vigilance|important|ne jamais|toujours/i.test(line)
      continue
    }
    if (inRules && /^\s*(?:[-*]|\d+[.)])\s+\S/.test(line)) out.push(clean(line))
    if (out.length >= 5) break
  }
  if (out.length === 0) {
    for (const line of lines) {
      if (/^##\s/.test(line)) out.push(clean(line.replace(/^#+\s*/, '')))
      if (out.length >= 5) break
    }
  }
  return out
}

async function loadNote($: EngineInterface, key: string): Promise<void> {
  const v = await $.store.get(`note:${key}`)
  await update($, note, () => (typeof v === 'string' ? v : ''))
}

async function saveNote($: EngineInterface, key: string, value: string): Promise<void> {
  await $.store.set(`note:${key}`, value)
  await update($, note, () => value)
  $.ui.toast('Note enregistrée.')
}
const emptyActivity: Activity = { calls: 0, byTool: {}, outputs: [] }
const activity = atom({ plugin: 'indicateurs', key: 'activity' } as const, emptyActivity)

const WRITERS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit'])

const fmt = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n)

const pctOf = (n: number, w: number): string => `${((n / w) * 100).toFixed(1)} %`

const LIMIT_LABEL: Record<string, string> = {
  five_hour: 'Limite 5 h',
  seven_day: 'Limite 7 jours',
  seven_day_opus: 'Limite 7 jours (Opus)',
}

const ENV_LABEL: Record<string, string> = {
  terminal: 'terminal',
  desktop: 'app desktop',
  mobile: 'mobile',
  vscode: 'VS Code',
}

function duration(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

function short(path: string, cwd: string): string {
  return path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path
}

async function refreshUsage($: EngineInterface): Promise<void> {
  const u = await $.session.usage({ breakdown: 'summary' })
  const b = u.context.breakdown
  const next: Usage = {
    tokens: u.context.tokens ?? null,
    window: u.context.window,
    percent: u.context.percent ?? null,
    costUsd: u.cost?.usd ?? null,
    categories: (b?.categories ?? [])
      .filter(c => c.tokens > 0)
      .map(c => ({ name: c.name, tokens: c.tokens, isDeferred: c.isDeferred }))
      .sort((x, y) => Number(x.isDeferred) - Number(y.isDeferred) || y.tokens - x.tokens),
    mcpTools: b?.mcpTools.length ?? 0,
    memoryFiles: b?.memoryFiles.length ?? 0,
    agents: b?.agents.length ?? 0,
    skills: b?.skills?.totalSkills ?? 0,
    limits: u.rateLimits.map(r => ({
      kind: r.kind,
      percent: r.percentUsed,
      resetsAt: r.resetsAt ?? null,
    })),
  }
  await update($, usage, () => next)
  for (const l of next.limits) {
    if (l.percent >= 80 && !warned.has(l.kind)) {
      warned.add(l.kind)
      $.ui.toast(`⚠ ${LIMIT_LABEL[l.kind] ?? l.kind} à ${l.percent} %`)
    }
  }
}

async function git($: EngineInterface, args: string[]): Promise<string | null> {
  try {
    const r = await $.process.run(['git', ...args], { timeoutMs: 10000 })
    return r.exitCode === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

async function refreshPlace($: EngineInterface): Promise<void> {
  const repo = await $.session.repo()
  const cwd = await $.session.cwd()
  const pkg = await readText($, `${cwd}/package.json`)
  const repoName = repo ? (repo.name ?? repo.remote?.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') ?? repo.root) : null
  const next: Place = {
    cwd,
    branch: repo ? await git($, ['rev-parse', '--abbrev-ref', 'HEAD']) : null,
    repo: repoName,
    envType: (await $.env.get('CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE')) ?? null,
    model: await $.session.model(),
    surfaces: [...(await $.session.surfaces())],
    turns: await $.session.turns(),
    startedAt: (await $.session.usage()).startedAt,
    projectKey: (repoName ?? cwd).toLowerCase(),
    hasRecap: await $.fs.exists(`${cwd}/RECAP.md`).catch(() => false),
    hasDevServer: /"dev"\s*:/.test(pkg ?? '') || (await $.fs.exists(`${cwd}/scripts/interface.py`).catch(() => false)),
    rules: await readRules($, cwd).catch(() => []),
  }
  const prev = await read($, place)
  await update($, place, () => next)
  if (prev?.projectKey !== next.projectKey || (await read($, note)) === null) {
    await loadNote($, next.projectKey).catch(() => undefined)
  }

  if (!repo) {
    await update($, changes, () => null)
    return
  }
  const status = (await git($, ['status', '--porcelain'])) ?? ''
  const list = status.split('\n').filter(Boolean).map(l => l.slice(3))
  const numstat = (await git($, ['diff', 'HEAD', '--numstat'])) ?? ''
  let added = 0
  let removed = 0
  for (const line of numstat.split('\n')) {
    const [a, r] = line.split('\t')
    added += Number(a) || 0
    removed += Number(r) || 0
  }
  const ahead = Number((await git($, ['rev-list', '--count', '@{upstream}..HEAD'])) ?? 0) || 0
  const lastCommit = await git($, ['log', '-1', '--format=%h %s (%cr)'])
  const c: Changes = { files: list.length, added, removed, list: list.slice(0, 8), ahead, lastCommit }
  await update($, changes, () => c)
}

function parseMcp(out: string): Connector[] {
  const list: Connector[] = []
  for (const line of out.split('\n')) {
    const m = /^(.+?): .* - (.+)$/.exec(line)
    if (!m) continue
    const name = (m[1] ?? '').replace(/^plugin:[^:]+:/, '').replace(/^claude\.ai /, '')
    const s = m[2] ?? ''
    const status: Connector['status'] = s.includes('Connected')
      ? 'ok'
      : /auth/i.test(s)
        ? 'auth'
        : /Not configured/i.test(s)
          ? 'off'
          : 'fail'
    if (!list.some(c => c.name === name)) list.push({ name, status })
  }
  return list
}

async function refreshConnectors($: EngineInterface): Promise<void> {
  if (await read($, isChecking)) return
  await update($, isChecking, () => true)
  try {
    const r = await $.process.run(['claude', 'mcp', 'list'], { timeoutMs: 120000 })
    const list = parseMcp(r.stdout)
    const checkedAt = await $.clock.now()
    await update($, connectors, () => ({ checkedAt, list }))
  } catch {
    // keep the previous reading
  } finally {
    await update($, isChecking, () => false)
  }
}

async function compactNow($: EngineInterface): Promise<void> {
  if (await read($, isCompacting)) return
  await update($, isCompacting, () => true)
  try {
    const r = await $.session.compact()
    $.ui.toast('skip' in r && r.skip ? `Compactage annulé : ${r.skip}` : 'Session compactée.')
  } catch {
    $.ui.toast('Compactage impossible pour le moment.')
  } finally {
    await update($, isCompacting, () => false)
    await refreshUsage($).catch(() => undefined)
  }
}

async function refreshAll($: EngineInterface, withConnectors: boolean): Promise<void> {
  await Promise.all([
    refreshUsage($).catch(() => undefined),
    refreshPlace($).catch(() => undefined),
    withConnectors ? refreshConnectors($) : Promise.resolve(),
  ])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'indicateurs',
      description: 'Ouvre le panneau Indicateurs (contexte, limites, connecteurs, modifications)',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    void refreshAll($, true)

    return started
  })

  on('command.run', { command: 'indicateurs' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    void refreshAll($, true)

    return { text: 'Panneau Indicateurs ouvert.' }
  })

  on('session.measure', async ($, e, next) => {
    void refreshUsage($).catch(() => undefined)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const file = WRITERS.has(e.tool)
      ? String(input['file_path'] ?? input['notebook_path'] ?? '')
      : ''
    await update($, activity, a => ({
      calls: a.calls + 1,
      byTool: { ...a.byTool, [e.tool]: (a.byTool[e.tool] ?? 0) + 1 },
      outputs: file && !a.outputs.includes(file) ? [...a.outputs, file].slice(-30) : a.outputs,
    }))
    const ran = await next(e)
    try {
      const res = (ran as { result?: Record<string, unknown> }).result ?? {}
      if (e.tool === 'TaskCreate') {
        const t = res['task'] as { id?: string; subject?: string } | undefined
        if (t?.id) {
          const created: Task = { id: t.id, subject: t.subject ?? String(input['subject'] ?? ''), status: 'pending' }
          await update($, tasks, list => [...list.filter(x => x.id !== created.id), created].slice(-50))
        }
      } else if (e.tool === 'TaskUpdate') {
        const id = String(input['taskId'] ?? '')
        const st = input['status']
        await update($, tasks, list =>
          st === 'deleted'
            ? list.filter(x => x.id !== id)
            : list.map(x =>
                x.id === id
                  ? {
                      ...x,
                      subject: typeof input['subject'] === 'string' ? input['subject'] : x.subject,
                      status: st === 'pending' || st === 'in_progress' || st === 'completed' ? st : x.status,
                    }
                  : x,
              ),
        )
      } else if (e.tool === 'TodoWrite') {
        const todos = (input['todos'] as { content: string; status: Task['status'] }[] | undefined) ?? []
        await update($, tasks, () => todos.map((t, i) => ({ id: `todo-${i}`, subject: t.content, status: t.status })))
      }
    } catch {
      // never break a tool call over the panel
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      void refreshPlace($).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const u = await read($, usage)
    const p = await read($, place)
    const c = await read($, changes)
    const k = await read($, connectors)
    const act = await read($, activity)
    const checking = await read($, isChecking)
    const compacting = await read($, isCompacting)
    const taskList = await read($, tasks)
    const noteText = await read($, note)
    const now = await $.clock.now()

    const pct = u?.percent ?? null
    const barWidth = 20
    const filled = pct === null ? 0 : Math.round((pct / 100) * barWidth)
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)
    const tone = (v: number) => (v >= 85 ? 'error' : v >= 60 ? 'warning' : 'success')

    const ok = k?.list.filter(x => x.status === 'ok') ?? []
    const auth = k?.list.filter(x => x.status === 'auth') ?? []
    const fail = k?.list.filter(x => x.status === 'fail') ?? []
    const topTools = Object.entries(act.byTool).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const remote = p?.surfaces.filter(s => s !== 'terminal') ?? []
    const done = taskList.filter(t => t.status === 'completed').length
    const taskBar = taskList.length === 0 ? '' : '█'.repeat(Math.round((done / taskList.length) * 20)).padEnd(20, '░')
    const submit = (text: string) => () => $.prompt.submit({ text })
    const highLimit = u?.limits.find(l => l.percent >= 80)

    return (
      <Box flexDirection="column" gap={1}>
        {(highLimit || (c?.ahead ?? 0) > 0 || (pct ?? 0) >= 85) && (
          <Box flexDirection="column">
            <Text bold color="warning">Alertes</Text>
            {(pct ?? 0) >= 85 && <Text color="error">⚠ Contexte à {pct} % : compacte maintenant</Text>}
            {highLimit && (
              <Text color="error">⚠ {LIMIT_LABEL[highLimit.kind] ?? highLimit.kind} à {highLimit.percent} %</Text>
            )}
            {(c?.ahead ?? 0) > 0 && <Text color="warning">↑ {c?.ahead} commit(s) pas encore poussé(s)</Text>}
          </Box>
        )}

        <Box flexDirection="column">
          <Text bold>Raccourcis</Text>
          <Box flexDirection="column" gap={0}>
            <Button key="sc-point" label="Où en est-on ?" onPress={submit(SHORTCUTS.point)} />
            {p?.hasRecap ? (
              <Button key="sc-rituel" label="Rituel de fin de session" onPress={submit(SHORTCUTS.rituel)} />
            ) : (
              <Button key="sc-fin" label="Préparer la fin de session" onPress={submit(SHORTCUTS.fin)} />
            )}
            {p?.hasDevServer && (
              <Button key="sc-serveur" label="Lancer le serveur local" onPress={submit(SHORTCUTS.serveur)} />
            )}
            {p?.repo && <Button key="sc-verif" label="Vérifier avant de pousser" onPress={submit(SHORTCUTS.verif)} />}
          </Box>
        </Box>

        <Box flexDirection="column">
          <Text bold>Tâches en cours</Text>
          {taskList.length === 0 ? (
            <Text dimColor>Aucune tâche suivie dans cette session.</Text>
          ) : (
            <Box flexDirection="column">
              <Text>{done} / {taskList.length} faites</Text>
              <Text color="success">{taskBar}</Text>
              {taskList.slice(-10).map(t => (
                <Text
                  key={t.id}
                  dimColor={t.status === 'completed'}
                  color={t.status === 'in_progress' ? 'warning' : undefined}
                >
                  {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▶' : '○'} {t.subject}
                </Text>
              ))}
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Notes du projet</Text>
          <Input
            key="note"
            placeholder="Rappels, décisions, à ne pas oublier…"
            value={noteText ?? ''}
            rows={3}
            submitLabel="Enregistrer"
            onSubmit={value => (p ? saveNote($, p.projectKey, value) : undefined)}
          />
          <Text dimColor>Gardées d'une session à l'autre pour ce projet.</Text>
        </Box>

        {p && p.rules.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Règles du projet</Text>
            {p.rules.map((r, i) => (
              <Text key={`rule-${i}`} dimColor>• {r}</Text>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          <Text bold>Environnement</Text>
          {p === null ? (
            <Text dimColor>Lecture…</Text>
          ) : (
            <Box flexDirection="column">
              <Text>☁ {p.envType ? `Cloud (${p.envType})` : 'Local (cet ordinateur)'}</Text>
              <Text>📁 {p.cwd}</Text>
              <Text>⎇ {p.branch ?? 'pas de dépôt git'}{p.repo ? ` · ${p.repo}` : ''}</Text>
              <Text>📡 {remote.length > 0 ? `Suivi depuis : ${remote.map(s => ENV_LABEL[s] ?? s).join(', ')}` : 'Remote Control : aucun appareil'}</Text>
              <Text dimColor>
                {p.model} · {p.turns} messages · {duration(now - p.startedAt)}
              </Text>
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Contexte</Text>
          {u === null || pct === null ? (
            <Text dimColor>Disponible après la première réponse.</Text>
          ) : (
            <Box flexDirection="column">
              <Text>{pct} % utilisé · {fmt(u.tokens ?? 0)} / {fmt(u.window)}</Text>
              <Text color={tone(pct)}>{bar}</Text>
              {pct >= 70 && (
                <Text color={pct >= 85 ? 'error' : 'warning'} bold>
                  ⚠ Contexte bientôt plein : pense à compacter
                </Text>
              )}
              {u.categories.map(cat => (
                <Text key={cat.name} dimColor={cat.isDeferred}>
                  {cat.name}{cat.isDeferred ? ' (différé)' : ''} : {fmt(cat.tokens)}
                  {cat.isDeferred ? '' : ` · ${pctOf(cat.tokens, u.window)}`}
                </Text>
              ))}
              <Text dimColor>
                Outils MCP {u.mcpTools} · Fichiers mémoire {u.memoryFiles} · Agents {u.agents} · Skills {u.skills}
              </Text>
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Limites d'usage</Text>
          {u === null || u.limits.length === 0 ? (
            <Text dimColor>Pas encore de mesure.</Text>
          ) : (
            u.limits.map(l => (
              <Text key={l.kind} color={tone(l.percent)}>
                {LIMIT_LABEL[l.kind] ?? l.kind} : {l.percent} %
                {l.resetsAt ? ` · reset ${l.resetsAt.slice(5, 16).replace('T', ' ')}` : ''}
              </Text>
            ))
          )}
          {u?.costUsd != null && <Text dimColor>Coût de la session : {u.costUsd.toFixed(2)} $</Text>}
        </Box>

        <Box flexDirection="column">
          <Text bold>Connecteurs</Text>
          {k === null ? (
            <Text dimColor>{checking ? 'Vérification…' : 'Pas encore vérifiés.'}</Text>
          ) : (
            <Box flexDirection="column">
              <Text>
                ✓ {ok.length} connectés · ⚠ {auth.length} à connecter · ✗ {fail.length} bloqués
              </Text>
              {ok.slice(0, 12).map(x => (
                <Text key={`ok-${x.name}`} color="success">✓ {x.name}</Text>
              ))}
              {auth.slice(0, 8).map(x => (
                <Text key={`auth-${x.name}`} color="warning">⚠ {x.name} — se connecter</Text>
              ))}
              {fail.slice(0, 4).map(x => (
                <Text key={`fail-${x.name}`} dimColor>✗ {x.name}</Text>
              ))}
              {fail.length > 4 && <Text dimColor>… et {fail.length - 4} autres bloqués par le réseau</Text>}
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Activité de la session</Text>
          {act.calls === 0 ? (
            <Text dimColor>Aucun outil utilisé pour l'instant.</Text>
          ) : (
            <Box flexDirection="column">
              <Text>{act.calls} actions</Text>
              {topTools.map(([tool, n]) => (
                <Text key={tool} dimColor>{tool.replace(/^mcp__/, '').replace(/__/g, ' › ')} : {n}</Text>
              ))}
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Résultats</Text>
          {act.outputs.length === 0 ? (
            <Text dimColor>Aucun fichier créé ou modifié par Claude.</Text>
          ) : (
            act.outputs.slice(-10).map(f => (
              <Text key={f}>📄 {p ? short(f, p.cwd) : f}</Text>
            ))
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Modifications</Text>
          {c === null ? (
            <Text dimColor>Aucun dépôt git ouvert.</Text>
          ) : (
            <Box flexDirection="column">
              {c.files === 0 ? (
                <Text dimColor>Aucune modification en cours.</Text>
              ) : (
                <Text>
                  {c.files} fichiers · <Text color="success">+{c.added}</Text>{' '}
                  <Text color="error">−{c.removed}</Text>
                </Text>
              )}
              {c.list.map(f => (
                <Text key={f} dimColor>{f}</Text>
              ))}
              {c.ahead > 0 && <Text color="warning">↑ {c.ahead} commit(s) pas encore poussé(s)</Text>}
              {c.lastCommit && <Text dimColor>Dernier commit : {c.lastCommit}</Text>}
            </Box>
          )}
        </Box>

        <Box gap={1}>
          <Button
            key="refresh"
            label={checking ? 'Actualisation…' : 'Actualiser'}
            onPress={() => refreshAll($, true)}
          />
          <Button
            key="compact"
            label={compacting ? 'Compactage…' : 'Compacter'}
            onPress={() => compactNow($)}
          />
        </Box>
      </Box>
    )
  })
}
