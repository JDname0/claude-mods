export type Category = { name: string; tokens: number; isDeferred: boolean }
export type Limit = { kind: string; percent: number; resetsAt: string | null }
export type Usage = {
  tokens: number | null
  window: number
  percent: number | null
  costUsd: number | null
  categories: Category[]
  mcpTools: number
  memoryFiles: number
  agents: number
  skills: number
  limits: Limit[]
}
export type Place = {
  cwd: string
  branch: string | null
  repo: string | null
  envType: string | null
  model: string
  surfaces: string[]
  turns: number
  startedAt: number
  projectKey: string
  hasRecap: boolean
  hasDevServer: boolean
  rules: string[]
}
export type Changes = {
  files: number
  added: number
  removed: number
  list: string[]
  ahead: number
  lastCommit: string | null
}
export type Connector = { name: string; status: 'ok' | 'auth' | 'fail' | 'off' }
export type Connectors = { checkedAt: number; list: Connector[] } | null
export type Task = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed' }
export type Activity = { calls: number; byTool: Record<string, number>; outputs: string[] }

declare module 'claude-code' {
  interface PluginState {
    indicateurs: {
      usage: Shaped<Usage | null>
      place: Shaped<Place | null>
      changes: Shaped<Changes | null>
      connectors: Connectors
      isChecking: boolean
      isCompacting: boolean
      tasks: Shaped<Task[]>
      note: string | null
      activity: Activity
    }
  }
}
