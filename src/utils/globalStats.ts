import type { Node } from '../types'
import type { NodeStatusCategory } from './stableStatus'

export interface GlobalStatsResult {
  onlineCount: number
  totalCount: number
  totalNetIn: number
  totalNetOut: number
  totalTrafficIn: number
  totalTrafficOut: number
  regionCount: number
  statusCounts: { normal: number; warning: number; risk: number; offline: number }
  totalBandwidth: number
  totalTraffic: number
}

// 从所有节点的实时快照汇总全局统计量。纯函数，便于测试与复用。
// bandwidthHistory / trafficHistory 这类带副作用的滚动窗口维护留在 App。
export function computeGlobalStats(
  nodes: Map<string, Node>,
  stableStatuses: Map<string, NodeStatusCategory>,
): GlobalStatsResult {
  let onlineCount = 0
  let totalCount = 0
  let totalNetIn = 0
  let totalNetOut = 0
  let totalTrafficIn = 0
  let totalTrafficOut = 0
  const regions = new Set<string>()

  for (const n of nodes.values()) {
    if (n.meta?.hidden) continue
    totalCount++
    if (n.online) onlineCount++
    // 实时速率是瞬时量：节点掉线后 live Map 里的旧快照不会消失，
    // 若不计守卫会被永久计入，导致总带宽虚高。离线即归零。
    // 月流量是累积量，掉线不清零，照常累加。
    if (n.online) {
      totalNetIn += n.dynamic?.receive_speed ?? 0
      totalNetOut += n.dynamic?.transmit_speed ?? 0
    }
    totalTrafficIn += n.monthlyTraffic?.received ?? 0
    totalTrafficOut += n.monthlyTraffic?.transmitted ?? 0
    const code = n.meta?.region?.trim().toUpperCase()
    if (code) regions.add(code)
  }

  const statusCounts = { normal: 0, warning: 0, risk: 0, offline: 0 }
  for (const n of nodes.values()) {
    if (n.meta?.hidden) continue
    const cat = stableStatuses.get(n.uuid) ?? 'normal'
    statusCounts[cat]++
  }

  return {
    onlineCount,
    totalCount,
    totalNetIn,
    totalNetOut,
    totalTrafficIn,
    totalTrafficOut,
    regionCount: regions.size,
    statusCounts,
    totalBandwidth: totalNetIn + totalNetOut,
    totalTraffic: totalTrafficIn + totalTrafficOut,
  }
}
