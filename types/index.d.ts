export type Category = { name: string; tokens: number }
export type Usage = {
  tokens: number | null
  window: number
  percent: number | null
  costUsd: number | null
  categories: Category[]
}
export type Place = {
  cwd: string
  branch: string | null
  repo: string | null
  envType: string | null
  model: string
}
export type Changes = { files: number; added: number; removed: number; list: string[] }
export type Connector = { name: string; status: 'ok' | 'auth' | 'fail' | 'off' }
export type Connectors = { checkedAt: number; list: Connector[] } | null

declare module 'claude-code' {
  interface PluginState {
    indicateurs: {
      usage: Usage | null
      place: Place | null
      changes: Changes | null
      connectors: Connectors
      isChecking: boolean
    }
  }
}
