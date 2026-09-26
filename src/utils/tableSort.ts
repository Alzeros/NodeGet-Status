import type { Sort, SortDir } from '../types'
import type { NodeStatusCategory } from './stableStatus'

/** 每个排序项首次选中时的自然方向：数值类"压力大在前"是降序，身份/到期类是升序 */
export const SORT_NATURAL_DIR: Record<Sort, SortDir> = {
  default: 'asc',
  name: 'asc',
  region: 'asc',
  status: 'desc',
  latency: 'desc',
  cpu: 'desc',
  mem: 'desc',
  disk: 'desc',
  netIn: 'desc',
  netOut: 'desc',
  uptime: 'desc',
  traffic: 'desc',
  trafficPct: 'desc',
  expire: 'asc',
}

/** 点当前生效项 = 翻转方向；点新项 = 回到该项的自然方向。排序菜单和表头共用这一条规则 */
export function nextSort(current: Sort, dir: SortDir, key: Sort): [Sort, SortDir] {
  if (key === current) return [current, dir === 'asc' ? 'desc' : 'asc']
  return [key, SORT_NATURAL_DIR[key]]
}

/**
 * 注意/风险行提到最前，两段各自保持传入顺序。
 * 表格是排查用的：按 CPU 排序时，一台流量快超额的机器不该被埋在中间。
 */
export function pinAbnormal<T>(
  rows: T[],
  statusOf: (row: T) => NodeStatusCategory | undefined,
): { pinned: T[]; rest: T[] } {
  const pinned: T[] = []
  const rest: T[] = []
  for (const r of rows) {
    const s = statusOf(r)
    if (s === 'warning' || s === 'risk') pinned.push(r)
    else rest.push(r)
  }
  return { pinned, rest }
}
