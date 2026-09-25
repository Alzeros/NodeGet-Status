import type { TaskQueryResult } from '../types'
import { normalizeTs } from './latency'

/*
 * 延迟数据的增量缓存。
 *
 * 后端 task_query 只给原始记录、不做聚合，色块又按 Date.now() 滑动分桶，
 * 所以手上必须有整窗原始行才能重算。从前每轮都把整窗重拉一遍——24h 窗口
 * 每节点约 4300 行，43 台机器一轮就是 40MB JSON，每 30 秒一次。
 * 现在首轮拉满窗口，之后只补上次截止时间之后的增量，并进缓存再裁掉窗口外的旧行，
 * 分桶结果与整窗重拉一致。
 */

export interface LatencyBuffer {
  /** 窗口内的行：按 task_id 去重、时间升序 */
  rows: TaskQueryResult[]
  /** 上一次成功拉取的截止时间 */
  fetchedTo: number
}

// 实测上报延迟 p90 约 20 秒；往前重叠 3 分钟，晚到的行下一轮也能补上
export const LATENCY_OVERLAP_MS = 3 * 60_000

/** 下一轮该拉的时间窗：首轮拉满窗口，之后从上次截止时间往前留一段重叠 */
export function nextFetchWindow(
  buf: LatencyBuffer | undefined,
  now: number,
  windowMs: number,
  overlapMs = LATENCY_OVERLAP_MS,
): [number, number] {
  const from = now - windowMs
  return [buf ? Math.max(from, buf.fetchedTo - overlapMs) : from, now]
}

// 缓存常驻内存，只留分桶和统计用得到的字段；task_event_type 这类每行一个小对象的字段很占地方
function slim(r: TaskQueryResult, uuid: string): TaskQueryResult {
  return {
    task_id: r.task_id,
    timestamp: r.timestamp,
    uuid,
    success: r.success,
    cron_source: r.cron_source,
    task_event_result: r.task_event_result,
  }
}

/** 把新拉到的行并入缓存：按 task_id 去重（新行覆盖旧行）、裁掉窗口外的旧行、保持时间升序 */
export function mergeLatencyRows(
  buf: LatencyBuffer | undefined,
  fresh: TaskQueryResult[],
  now: number,
  windowMs: number,
): LatencyBuffer {
  const from = now - windowMs
  const byId = new Map<number, TaskQueryResult>()
  // JSON.parse 不合并长字符串，每行各带一份 36 字符的 uuid；统一指向同一份，
  // 实测 24h × 43 台的缓存从 26MB 降到 18MB
  const uuids = new Map<string, string>()
  const share = (s: string) => uuids.get(s) ?? (uuids.set(s, s), s)
  for (const r of buf?.rows ?? []) {
    byId.set(r.task_id, r)
    share(r.uuid) // 旧行入缓存时已指向共享的那份，登记下来给新行复用
  }
  for (const r of fresh) byId.set(r.task_id, slim(r, share(r.uuid)))
  const rows = [...byId.values()]
    .filter(r => normalizeTs(r.timestamp) >= from)
    .sort((a, b) => normalizeTs(a.timestamp) - normalizeTs(b.timestamp))
  return { rows, fetchedTo: now }
}
