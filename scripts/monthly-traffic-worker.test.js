import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import worker from './monthly-traffic-worker.js'

/*
 * worker 跑在主控的 QuickJS 里，调不了试；这里用假的 nodeget() 把它当普通模块跑一遍。
 * 假后端：一台机器，计数器每毫秒 +1 字节（上行 ×2），从 T_START 开始有记录，
 * T_REBOOT 时重启归零。时间全用本地时区构造，和 worker 的 localDateId 同口径。
 */

const H = 3600e3
const DAY = 86400e3
const UUID = 'u1'
const midnight = (y, m, d) => new Date(y, m - 1, d).getTime()
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const T_START = midnight(2026, 9, 3) - H
const T_REBOOT = midnight(2026, 9, 20) + 12 * H
const rx = t => (t < T_START ? null : t < T_REBOOT ? t - T_START : t - T_REBOOT)

let kv
let calls

beforeEach(() => {
  vi.useFakeTimers()
  kv = new Map()
  calls = []
  globalThis.nodeget = async (method, params) => {
    calls.push({ method, params })
    switch (method) {
      case 'nodeget-server_list_all_agent_uuid':
        return { result: { uuids: [UUID] } }
      case 'agent_dynamic_summary_multi_last_query': {
        const t = Date.now()
        return { result: [{ uuid: UUID, timestamp: t, total_received: rx(t), total_transmitted: 2 * rx(t) }] }
      }
      case 'kv_get_multi_value':
        return {
          result: params.namespace_key.map(({ namespace, key }) => ({
            namespace,
            key,
            value: kv.get(`${namespace}|${key}`) ?? null,
          })),
        }
      case 'kv_set_value':
        kv.set(`${params.namespace}|${params.key}`, params.value)
        return { result: true }
      case 'agent_query_dynamic_summary': {
        const to = params.query.condition.find(c => 'timestamp_to' in c).timestamp_to
        const v = rx(to)
        return { result: v == null ? [] : [{ uuid: UUID, timestamp: to, total_received: v, total_transmitted: 2 * v }] }
      }
      default:
        return { error: { message: `unknown method ${method}` } }
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
  delete globalThis.nodeget
})

async function run(t) {
  vi.setSystemTime(t)
  calls.length = 0
  const res = await worker.onCall({ token: 't' })
  expect(res.error).toBeUndefined()
  return res
}

const daily = () => JSON.parse(kv.get(`${UUID}|metadata_traffic_daily`))
const snapshotQueries = () => calls.filter(c => c.method === 'agent_query_dynamic_summary').length
const dailyWrites = () => calls.filter(c => c.method === 'kv_set_value' && c.params.key === 'metadata_traffic_daily').length

describe('metadata_traffic_daily', () => {
  test('首次部署分几轮回填，跨天后由窗口归档并补全，全部查完后不再打扰后端', async () => {
    // 第 1 轮：每台最多查 12 个午夜快照 → 算出 09-15 ~ 09-25 共 11 天
    await run(at(2026, 9, 26, 8, 30))
    expect(calls.find(c => c.method === 'kv_get_multi_value' && c.params.namespace_key.some(k => k.key === 'metadata_traffic_daily'))).toBeTruthy()
    expect(snapshotQueries()).toBe(12)
    expect(dailyWrites()).toBe(1)
    let d = daily()
    expect(Object.keys(d.days).sort()).toEqual(
      Array.from({ length: 11 }, (_, i) => `2026-09-${String(15 + i).padStart(2, '0')}`),
    )
    expect(d.days['2026-09-25']).toEqual({ received: DAY, transmitted: 2 * DAY, source: 'snapshot' })
    // 09-20 中午重启：差值算不出，退而取重启后累计的 12 小时，并标 reset
    expect(d.days['2026-09-20']).toEqual({ received: 12 * H, transmitted: 24 * H, source: 'snapshot', reset: true })
    expect(d.days['2026-09-19']).toEqual({ received: DAY, transmitted: 2 * DAY, source: 'snapshot' })
    expect(d.days['2026-09-21']).toEqual({ received: DAY, transmitted: 2 * DAY, source: 'snapshot' })
    expect(d.updatedAt).toBe(at(2026, 9, 26, 8, 30))

    // 第 2 轮：再查 12 个 → 09-03 ~ 09-14
    await run(at(2026, 9, 26, 9, 0))
    expect(snapshotQueries()).toBe(12)
    d = daily()
    expect(Object.keys(d.days).length).toBe(23)
    expect(d.days['2026-09-03']).toEqual({ received: DAY, transmitted: 2 * DAY, source: 'snapshot' })

    // 第 3 轮：剩下 8 个午夜（09-02 往前）都在有记录之前 → 记 null，不再重查
    await run(at(2026, 9, 26, 9, 30))
    expect(snapshotQueries()).toBe(8)
    d = daily()
    expect(Object.keys(d.days).length).toBe(23)
    expect(d.snapshots['2026-09-02']).toBeNull()
    expect(d.snapshots['2026-08-26']).toBeNull()

    // 第 4 轮：没有缺口了，一次快照都不查，记录没变也不写
    await run(at(2026, 9, 26, 10, 0))
    expect(snapshotQueries()).toBe(0)
    expect(dailyWrites()).toBe(0)

    // 跨天：窗口里 09-26 是 08:30 才开始累计的（partial），归档后立刻用快照补成整天
    await run(at(2026, 9, 27, 0, 30))
    expect(snapshotQueries()).toBe(1)
    d = daily()
    expect(Object.keys(d.days).length).toBe(24)
    expect(d.days['2026-09-26']).toEqual({ received: DAY, transmitted: 2 * DAY, source: 'snapshot' })
    expect(d.days['2026-09-27']).toBeUndefined()
  })

  test('窗口从零点起就完整累计的一天，归档以窗口为准：不带 source、不标 partial', async () => {
    // 00:30 建窗（距零点不到 1 小时，不算 partial），23:30 最后一采，次日 00:30 归档
    await run(at(2026, 9, 26, 0, 30))
    await run(at(2026, 9, 26, 23, 30))
    await run(at(2026, 9, 27, 0, 30))
    const d = daily()
    // 窗口累计的是建窗到最后一采之间的差值（00:30 ~ 23:30 = 23 小时）；
    // 跨零点那半小时按设计记进下一天，不丢也不重复
    expect(d.days['2026-09-26']).toEqual({ received: 23 * H, transmitted: 46 * H })
  })

  test('快照查询失败只影响本轮回填，周期桶和窗口照常写', async () => {
    const base = globalThis.nodeget
    let failed = 0
    globalThis.nodeget = async (method, params) => {
      if (method === 'agent_query_dynamic_summary') {
        failed++
        return { error: { message: 'boom' } }
      }
      return base(method, params)
    }
    const res = await run(at(2026, 9, 26, 8, 30))
    expect(res.updated).toBe(1)
    expect(kv.get(`${UUID}|metadata_traffic_window`)).toBeTruthy()
    // 一次失败就停，不把剩下 11 次也打出去
    expect(failed).toBe(1)
    expect(kv.get(`${UUID}|metadata_traffic_daily`)).toBeUndefined()
  })
})
