import type { Node } from '../types'

export type NodeStatusCategory = 'normal' | 'warning' | 'risk' | 'offline'

export interface AbnormalCounters {
  cpu: number
  memory: number
  disk: number
  tcp: number
  udp: number
  process: number
}

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
    : { cpu: 0, memory: 0, disk: 0, tcp: 0, udp: 0, process: 0 }

  const d = node.dynamic

  // 离线或没有动态数据时不继续累加，保留已有计数器
  if (!node.online || !d) return c

  // CPU > 80
  const cpuUsage = d.cpu_usage ?? 0
  c.cpu = cpuUsage > 80 ? c.cpu + 1 : dec(c.cpu)

  // 内存使用率 > 85
  const memTotal = d.total_memory || 0
  const memUsage = memTotal && d.used_memory != null
    ? (d.used_memory / memTotal) * 100
    : 0
  c.memory = memUsage > 85 ? c.memory + 1 : dec(c.memory)

  // 磁盘使用率 > 85
  const diskTotal = d.total_space || 0
  const diskUsage = diskTotal && d.available_space != null
    ? ((diskTotal - d.available_space) / diskTotal) * 100
    : 0
  c.disk = diskUsage > 85 ? c.disk + 1 : dec(c.disk)

  // TCP > 1000
  const tcp = d.tcp_connections ?? 0
  c.tcp = tcp > 1000 ? c.tcp + 1 : dec(c.tcp)

  // UDP > 1000
  const udp = d.udp_connections ?? 0
  c.udp = udp > 1000 ? c.udp + 1 : dec(c.udp)

  // 进程数 > 120
  const proc = d.process_count ?? 0
  c.process = proc > 120 ? c.process + 1 : dec(c.process)

  return c
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
