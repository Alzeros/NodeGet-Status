import type { Node, DynamicSummary } from '../types'

export type NodeStatusCategory = 'normal' | 'warning' | 'risk' | 'offline'

export interface AbnormalCounters {
  cpu: number
  memory: number
  disk: number
  tcp: number
  udp: number
  process: number
}

interface ThresholdDef {
  key: keyof AbnormalCounters
  label: string
  threshold: number
  getCurrent: (d: DynamicSummary) => number
  format: (v: number) => string
}

const THRESHOLDS: ThresholdDef[] = [
  { key: 'cpu', label: 'CPU', threshold: 80, getCurrent: d => d.cpu_usage ?? 0, format: v => `${Math.round(v)}%` },
  { key: 'memory', label: '内存', threshold: 85, getCurrent: d => d.total_memory ? ((d.used_memory ?? 0) / d.total_memory) * 100 : 0, format: v => `${Math.round(v)}%` },
  { key: 'disk', label: '磁盘', threshold: 85, getCurrent: d => d.total_space ? ((d.total_space - (d.available_space ?? d.total_space)) / d.total_space) * 100 : 0, format: v => `${Math.round(v)}%` },
  { key: 'tcp', label: 'TCP', threshold: 1000, getCurrent: d => d.tcp_connections ?? 0, format: v => String(Math.round(v)) },
  { key: 'udp', label: 'UDP', threshold: 1000, getCurrent: d => d.udp_connections ?? 0, format: v => String(Math.round(v)) },
  { key: 'process', label: '进程', threshold: 250, getCurrent: d => d.process_count ?? 0, format: v => String(Math.round(v)) },
]

const STORAGE_KEY = 'nodeget.abnormalCounters'

export function loadCounters(): Map<string, AbnormalCounters> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, AbnormalCounters>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

export function saveCounters(map: Map<string, AbnormalCounters>) {
  try {
    const obj: Record<string, AbnormalCounters> = {}
    for (const [k, v] of map) obj[k] = v
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch { /* ignore */ }
}

function dec(v: number) {
  return Math.max(0, v - 2)
}

export function updateSingleCounter(node: Node, existing?: AbnormalCounters): AbnormalCounters {
  const c: AbnormalCounters = existing
    ? { ...existing }
    : Object.fromEntries(THRESHOLDS.map(t => [t.key, 0])) as unknown as AbnormalCounters

  const d = node.dynamic

  // 离线或没有动态数据时不继续累加，保留已有计数器
  if (!node.online || !d) return c

  for (const t of THRESHOLDS) {
    const current = t.getCurrent(d)
    c[t.key] = current > t.threshold ? c[t.key] + 1 : dec(c[t.key])
  }

  return c
}

export interface StatusReason {
  key: string
  label: string
  display: string
}

export function getStatusReasons(node: Node, counters?: AbnormalCounters): StatusReason[] {
  if (!counters) return []
  const d = node.dynamic
  const reasons: StatusReason[] = []
  for (const t of THRESHOLDS) {
    if (counters[t.key] >= 15 && d) {
      reasons.push({ key: t.key, label: t.label, display: `${t.label} ${t.format(t.getCurrent(d))}` })
    }
  }
  return reasons
}

export function getStableStatus(
  node: Node,
  counters?: AbnormalCounters,
): NodeStatusCategory {
  if (!node.online) return 'offline'
  if (!counters) return 'normal'
  const vals = [counters.cpu, counters.memory, counters.disk, counters.tcp, counters.udp, counters.process]
  if (vals.some(v => v >= 60)) return 'risk'
  if (vals.some(v => v >= 15)) return 'warning'
  return 'normal'
}
