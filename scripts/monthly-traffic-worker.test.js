import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import worker from './monthly-traffic-worker.js'
import { createDailyTrafficReceiver, parseDailyWindow } from '../src/utils/dailyTrafficState.ts'

/*
 * 用假的 nodeget RPC 跑真实 worker.onCall；时间样本固定 UTC+8，不依赖宿主时区。
 * 默认计数器每毫秒 +1 字节（上行 ×2），T_START 开始有记录，T_REBOOT 重启归零。
 */
const H = 3600e3
const DAY = 86400e3
const UUID = 'u1'
const DAILY_KEY = 'metadata_traffic_daily_utc8'
const WINDOW_KEY = 'metadata_traffic_window'
const midnight = (y, m, d) => Date.UTC(y, m - 1, d) - 8 * H
const at = (y, m, d, h, min = 0) => midnight(y, m, d) + h * H + min * 60e3
const T_START = midnight(2026, 9, 3) - H
const T_REBOOT = midnight(2026, 9, 20) + 12 * H
const rx = t => (t < T_START ? null : t < T_REBOOT ? t - T_START : t - T_REBOOT)
const sample = (timestamp, received = rx(timestamp)) => ({
  uuid: UUID,
  timestamp,
  total_received: received,
  total_transmitted: received == null ? null : 2 * received,
})

let kv
let calls
let latestRow
let snapshotRows
let beforeWrite
let beforeCall
let uuids

beforeEach(() => {
  vi.useFakeTimers()
  kv = new Map()
  calls = []
  latestRow = undefined
  snapshotRows = to => rx(to) == null ? [] : [sample(to)]
  beforeWrite = undefined
  beforeCall = undefined
  uuids = [UUID]
  globalThis.nodeget = async (method, params) => {
    calls.push({ method, params })
    await beforeCall?.(method, params)
    switch (method) {
      case 'nodeget-server_list_all_agent_uuid':
        return { result: { uuids } }
      case 'agent_dynamic_summary_multi_last_query':
        return { result: uuids.map(uuid => ({ ...(latestRow ?? sample(Date.now())), uuid })) }
      case 'kv_get_multi_value':
        return {
          result: params.namespace_key.map(({ namespace, key }) => ({
            namespace,
            key,
            value: kv.get(`${namespace}|${key}`) ?? null,
          })),
        }
      case 'kv_set_value':
        await beforeWrite?.(params)
        kv.set(`${params.namespace}|${params.key}`, params.value)
        return { result: true }
      case 'agent_query_dynamic_summary': {
        const to = params.query.condition.find(c => 'timestamp_to' in c).timestamp_to
        return { result: await snapshotRows(to) }
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

const windows = () => JSON.parse(kv.get(`${UUID}|${WINDOW_KEY}`) ?? '{}')
const daily = () => JSON.parse(kv.get(`${UUID}|${DAILY_KEY}`) ?? '{"days":{},"snapshots":{}}')
const snapshotQueries = () => calls.filter(c => c.method === 'agent_query_dynamic_summary')
const queryTimes = () => snapshotQueries().map(c => c.params.query.condition.find(c => 'timestamp_to' in c).timestamp_to)
const dailyWrites = () => calls.filter(c => c.method === 'kv_set_value' && c.params.key === DAILY_KEY)

describe('UTC+8 日窗口与历史', () => {
  test('15:59:59Z → 16:00:00Z 固定换日，与宿主时区无关', async () => {
    await run(Date.parse('2026-09-25T15:59:59Z'))
    expect(windows().dayUtc8?.id).toBe('2026-09-25')
    const result = await run(Date.parse('2026-09-25T16:00:00Z'))
    expect(result.dayId).toBe('2026-09-26')
    expect(windows().dayUtc8).toMatchObject({
      id: '2026-09-26', received: 0, transmitted: 0,
      startedAt: midnight(2026, 9, 26), updatedAt: midnight(2026, 9, 26),
    })
    expect(queryTimes()).toContain(Date.parse('2026-09-25T16:00:00Z'))
  })

  test.each([
    ['2026-09-30', '2026-10-01', '2026-09-30T16:00:00Z'],
    ['2026-12-31', '2027-01-01', '2026-12-31T16:00:00Z'],
    ['2028-02-28', '2028-02-29', '2028-02-28T16:00:00Z'],
    ['2028-02-29', '2028-03-01', '2028-02-29T16:00:00Z'],
    ['2027-03-14', '2027-03-15', '2027-03-14T16:00:00Z'], // New York DST 开始
    ['2027-11-07', '2027-11-08', '2027-11-07T16:00:00Z'], // New York DST 结束
  ])('%s → %s 的日历边界使用 UTC+8', async (previousId, nextId, iso) => {
    const boundary = Date.parse(iso)
    await run(boundary - 1000)
    expect(windows().dayUtc8?.id).toBe(previousId)
    await run(boundary)
    expect(windows().dayUtc8?.id).toBe(nextId)
    expect(daily().days[previousId]).toEqual({ received: DAY, transmitted: 2 * DAY })
    expect(queryTimes()).toContain(boundary)
  })

  test('首日加载午夜基线，换日补齐旧桶而非把跨日流量塞进新桶', async () => {
    await run(at(2026, 9, 26, 0, 30))
    expect(windows().dayUtc8).toMatchObject({
      received: H / 2, transmitted: H, startedAt: midnight(2026, 9, 26),
    })
    await run(at(2026, 9, 26, 23, 30))
    await run(at(2026, 9, 27, 0, 30))
    expect(daily().days['2026-09-26']).toEqual({ received: DAY, transmitted: 2 * DAY })
    expect(windows().dayUtc8).toMatchObject({ id: '2026-09-27', received: H / 2, transmitted: H })
    expect(windows().dayUtc8.partial).toBeUndefined()
    expect(daily().days['2026-09-27']).toBeUndefined()
  })

  test('相同日期的旧 day 不复用，旧历史字符串原样保留且不读取', async () => {
    const legacyDay = {
      id: '2026-09-26', received: 999999, transmitted: 888888,
      lastReceived: 1, lastTransmitted: 2,
      startedAt: midnight(2026, 9, 26), updatedAt: at(2026, 9, 26, 0, 15),
    }
    const legacyHistory = ' { "days": { "2026-09-25": { "received": 123456789 } }, "snapshots": {} }\n'
    kv.set(`${UUID}|${WINDOW_KEY}`, JSON.stringify({ day: legacyDay }))
    kv.set(`${UUID}|metadata_traffic_daily`, legacyHistory)
    await run(at(2026, 9, 26, 0, 30))
    expect(windows().dayUtc8?.received).toBe(H / 2)
    expect(windows().day).toEqual(legacyDay)
    expect(kv.get(`${UUID}|metadata_traffic_daily`)).toBe(legacyHistory)
    expect(daily().timeZone).toBe('UTC+08:00')
    expect(daily().days['2026-09-25'].received).toBe(DAY)
    expect(calls.filter(c => c.method === 'kv_get_multi_value')
      .flatMap(c => c.params.namespace_key).some(k => k.key === 'metadata_traffic_daily')).toBe(false)
  })

  test('动态行使用真实 timestamp，重复或落后的行不回退基线、不重复累计', async () => {
    latestRow = sample(at(2026, 9, 26, 11))
    await run(at(2026, 9, 26, 12))
    expect(windows().dayUtc8).toMatchObject({ received: 11 * H, updatedAt: latestRow.timestamp })
    const original = windows().dayUtc8
    await run(at(2026, 9, 26, 12, 30))
    expect(windows().dayUtc8).toEqual(original)
    latestRow = sample(at(2026, 9, 26, 11), 1)
    await run(at(2026, 9, 26, 13))
    expect(windows().dayUtc8).toEqual(original)
    latestRow = sample(at(2026, 9, 26, 10, 30), 1)
    await run(at(2026, 9, 26, 13, 30))
    expect(windows().dayUtc8).toEqual(original)
    latestRow = sample(at(2026, 9, 26, 12))
    await run(at(2026, 9, 26, 14))
    expect(windows().dayUtc8).toMatchObject({ received: 12 * H, updatedAt: latestRow.timestamp })
    expect(windows().dayUtc8.reset).toBeUndefined()
  })

  test('同日计数器回退永久保留 reset/partial，午夜差分不能伪造完整日', async () => {
    const start = midnight(2026, 9, 26)
    const end = start + DAY
    snapshotRows = to => to === start ? [sample(to, 1000)] : to === end ? [sample(to, 2100)] : []
    latestRow = sample(start + H / 2, 1100)
    await run(latestRow.timestamp)
    latestRow = sample(start + 12 * H, 10)
    await run(latestRow.timestamp)
    expect(windows().dayUtc8).toMatchObject({ received: 100, partial: true, reset: true })
    latestRow = sample(end - H / 2, 2000)
    await run(latestRow.timestamp)
    expect(windows().dayUtc8).toMatchObject({ received: 2090, partial: true, reset: true })
    latestRow = sample(end + H / 2, 2200)
    await run(latestRow.timestamp)
    expect(daily().days['2026-09-26']).toEqual({ received: 2190, transmitted: 4380, partial: true, reset: true })
    expect(windows().dayUtc8).toMatchObject({ received: 100, transmitted: 200 })
    expect(windows().dayUtc8.reset).toBeUndefined()
    await run(end + H)
    expect(daily().days['2026-09-26']).toMatchObject({ received: 2190, partial: true, reset: true })
  })

  test('历史已检测到的 reset 不被回填范围外滞留的 partial 旧窗口抹掉', async () => {
    const id = '2026-08-20'
    const entry = { received: 123, transmitted: 246, partial: true, reset: true, source: 'snapshot' }
    kv.set(`${UUID}|${DAILY_KEY}`, JSON.stringify({ timeZone: 'UTC+08:00', days: { [id]: entry }, snapshots: {} }))
    kv.set(`${UUID}|${WINDOW_KEY}`, JSON.stringify({ dayUtc8: {
      id, received: 100, transmitted: 200, lastReceived: 1000, lastTransmitted: 2000,
      startedAt: at(2026, 8, 20, 12), updatedAt: at(2026, 8, 20, 13), partial: true,
    } }))
    await run(at(2026, 9, 26, 0, 30))
    expect(daily().days[id]).toEqual(entry)
  })

  test('节点最后数据仍在前一天时，不创建带旧计数器的新日桶', async () => {
    await run(at(2026, 9, 26, 23, 30))
    latestRow = sample(at(2026, 9, 26, 23, 59))
    snapshotRows = to => rx(to) == null ? [] : [sample(Math.min(to, latestRow.timestamp))]
    await run(at(2026, 9, 27, 0, 30))
    expect(windows().dayUtc8?.id).toBe('2026-09-26')
    expect(daily().days['2026-09-27']).toBeUndefined()
  })

  test.each(['previous day', 'future', 'missing timestamp'])('首次采样 %s 的动态行不能成为当天基线', async kind => {
    const now = at(2026, 9, 26, 0, 30)
    latestRow = sample(kind === 'previous day' ? midnight(2026, 9, 26) - 1000 : now + H)
    if (kind === 'missing timestamp') delete latestRow.timestamp
    await run(now)
    expect(windows().dayUtc8).toBeUndefined()
    expect(windows().month).toBeTruthy()
  })

  test('跨多天时旧桶只补到自身次日午夜，新桶仍从今日午夜开始', async () => {
    await run(at(2026, 9, 23, 0, 30))
    await run(at(2026, 9, 26, 0, 30))
    expect(daily().days['2026-09-23']).toEqual({ received: DAY, transmitted: 2 * DAY })
    expect(windows().dayUtc8).toMatchObject({ id: '2026-09-26', received: H / 2, transmitted: H })
    expect(queryTimes()).toContain(midnight(2026, 9, 24))
    expect(queryTimes()).toContain(midnight(2026, 9, 26))
    expect(snapshotQueries().length).toBeLessThanOrEqual(12)
  })
})

describe('UTC+8 快照精度、回填与查询预算', () => {
  test('首次部署分轮回填，边界和回填共享 12 次预算，缓存后不重复查询或写历史', async () => {
    await run(at(2026, 9, 26, 8, 30))
    expect(snapshotQueries()).toHaveLength(12)
    expect(dailyWrites()).toHaveLength(1)
    let d = daily()
    expect(d.timeZone).toBe('UTC+08:00')
    expect(Object.keys(d.days).sort()).toEqual(
      Array.from({ length: 11 }, (_, i) => `2026-09-${String(15 + i).padStart(2, '0')}`),
    )
    expect(d.days['2026-09-25']).toEqual({ received: DAY, transmitted: 2 * DAY, source: 'snapshot' })
    expect(d.days['2026-09-20']).toEqual({ received: 12 * H, transmitted: 24 * H, source: 'snapshot', reset: true, partial: true })
    expect(d.updatedAt).toBe(at(2026, 9, 26, 8, 30))

    await run(at(2026, 9, 26, 9))
    expect(snapshotQueries()).toHaveLength(12)
    expect(Object.keys(daily().days)).toHaveLength(23)
    expect(daily().days['2026-09-03']).toEqual({ received: DAY, transmitted: 2 * DAY, source: 'snapshot' })
    await run(at(2026, 9, 26, 9, 30))
    expect(snapshotQueries()).toHaveLength(8)
    d = daily()
    expect(Object.keys(d.days)).toHaveLength(23)
    expect(d.snapshots['2026-09-02']).toBeNull()
    expect(d.snapshots['2026-08-26']).toBeNull()
    await run(at(2026, 9, 26, 10))
    expect(snapshotQueries()).toHaveLength(0)
    expect(dailyWrites()).toHaveLength(0)

    await run(at(2026, 9, 27, 0, 30))
    expect(snapshotQueries()).toHaveLength(1)
    expect(daily().days['2026-09-26']).toEqual({ received: DAY, transmitted: 2 * DAY })
  })

  test('历史数据足够时只回填 31 天、32 个午夜，分三轮 12/12/8 查询', async () => {
    const start = midnight(2026, 8, 1)
    snapshotRows = to => [sample(to, to - start)]
    latestRow = sample(at(2026, 9, 26, 12), at(2026, 9, 26, 12) - start)
    for (const count of [12, 12, 8, 0]) {
      await run(at(2026, 9, 26, 12))
      expect(snapshotQueries()).toHaveLength(count)
    }
    expect(Object.keys(daily().days)).toHaveLength(31)
    expect(Object.keys(daily().snapshots)).toHaveLength(32)
    expect(daily().days['2026-08-26'].received).toBe(DAY)
    expect(daily().days['2026-08-25']).toBeUndefined()
  })

  test('首日边界查询错误终止本轮查询但不缓存 null，次轮可重试', async () => {
    const normal = snapshotRows
    snapshotRows = () => { throw new Error('snapshot boom') }
    await run(at(2026, 9, 26, 8, 30))
    expect(snapshotQueries()).toHaveLength(1)
    expect(windows().dayUtc8).toMatchObject({ received: 0, partial: true })
    expect(daily().snapshots['2026-09-26']).toBeUndefined()
    expect(kv.get(`${UUID}|metadata_traffic_cycle:2026-09-01`)).toBeTruthy()
    snapshotRows = normal
    await run(at(2026, 9, 26, 9))
    expect(queryTimes()).toContain(midnight(2026, 9, 26))
    expect(daily().snapshots['2026-09-26'].ts).toBe(midnight(2026, 9, 26))
    expect(snapshotQueries().length).toBeLessThanOrEqual(12)
  })

  test('上一桶结束边界错误后，新桶及回填不继续重试，本轮最多一次失败请求', async () => {
    await run(at(2026, 9, 23, 0, 30))
    const normal = snapshotRows
    snapshotRows = () => { throw new Error('boundary boom') }
    await run(at(2026, 9, 26, 0, 30))
    expect(snapshotQueries()).toHaveLength(1)
    expect(daily().days['2026-09-23']).toMatchObject({ partial: true })
    expect(windows().dayUtc8).toMatchObject({ id: '2026-09-26', received: 0, partial: true })
    expect(daily().snapshots['2026-09-24']).toBeUndefined()
    snapshotRows = normal
    await run(at(2026, 9, 26, 1))
    // 保存的窗口锚点直接补齐尾部，仍是窗口来源，而不是重新用两端点覆盖。
    expect(daily().days['2026-09-23']).toEqual({ received: DAY, transmitted: 2 * DAY })
  })

  test('缺少首日午夜快照时从当前采样起记且归档保留 partial', async () => {
    const start = midnight(2026, 9, 26)
    const normal = snapshotRows
    snapshotRows = to => to === start ? [] : normal(to)
    await run(at(2026, 9, 26, 0, 30))
    expect(windows().dayUtc8).toMatchObject({ received: 0, startedAt: start + H / 2, partial: true })
    await run(at(2026, 9, 26, 23, 30))
    await run(at(2026, 9, 27, 0, 30))
    expect(daily().days['2026-09-26']).toEqual({ received: 23.5 * H, transmitted: 47 * H, partial: true })
    expect(windows().dayUtc8?.received).toBe(H / 2)
  })

  test.each([
    [0, true], [5 * 60e3, true], [5 * 60e3 + 1, false], [-1, false], [null, false],
  ])('午夜快照陈旧 %s ms，仅接受不晚于边界且最多 5 分钟的样本', async (age, accepted) => {
    const start = midnight(2026, 9, 26)
    snapshotRows = to => {
      const row = sample(to - (age ?? 0))
      if (age === null) delete row.timestamp
      return row.total_received == null ? [] : [row]
    }
    await run(start + H / 2)
    expect(windows().dayUtc8?.received).toBe(accepted ? H / 2 + age : 0)
    expect(Boolean(windows().dayUtc8?.partial)).toBe(!accepted)
    if (accepted) {
      expect(daily().snapshots['2026-09-26'].ts).toBe(start - age)
    } else {
      expect(daily().snapshots['2026-09-26']).toBeNull()
      expect(daily().days['2026-09-25']).toBeUndefined()
      await run(start + 23.5 * H)
      await run(start + DAY + H / 2)
      expect(daily().days['2026-09-26']).toEqual({ received: 23 * H, transmitted: 46 * H, partial: true })
    }
  })

  test('结束快照落后已消费行时，两桶共用容差内较晚的已消费样本，合计不重复', async () => {
    const end = midnight(2026, 9, 27)
    await run(end - 60e3)
    const normal = snapshotRows
    snapshotRows = to => to === end ? [sample(end - 5 * 60e3)] : normal(to)
    await run(end + H / 2)
    const previous = daily().days['2026-09-26']
    expect(previous).toEqual({ received: DAY - 60e3, transmitted: 2 * (DAY - 60e3) })
    expect(daily().snapshots['2026-09-27'].ts).toBe(end - 60e3)
    expect(windows().dayUtc8).toMatchObject({ received: H / 2 + 60e3, transmitted: H + 120e3 })
    expect(previous.received + windows().dayUtc8.received).toBe(DAY + H / 2)
    expect(previous.transmitted + windows().dayUtc8.transmitted).toBe(2 * DAY + H)
  })

  test('午夜快照与已消费行时间重复但计数器不同时，也只采用已消费的共同边界', async () => {
    const end = midnight(2026, 9, 27)
    await run(end - 60e3)
    const normal = snapshotRows
    snapshotRows = to => to === end ? [sample(end - 60e3, 1)] : normal(to)
    await run(end + H / 2)
    expect(daily().snapshots['2026-09-27']).toMatchObject({ received: rx(end - 60e3), ts: end - 60e3 })
    expect(daily().days['2026-09-26'].received + windows().dayUtc8.received).toBe(DAY + H / 2)
    expect(windows().dayUtc8.reset).toBeUndefined()
  })

  test('较晚已消费行计数器不全时拒绝回退边界，两桶 partial，次轮可用完整快照修补历史', async () => {
    const end = midnight(2026, 9, 27)
    latestRow = { ...sample(end - 60e3), total_received: null }
    await run(end - 60e3)
    expect(windows().dayUtc8?.partial).toBe(true)
    const normal = snapshotRows
    snapshotRows = to => to === end ? [sample(end - 5 * 60e3)] : normal(to)
    latestRow = undefined
    await run(end + H / 2)
    expect(daily().days['2026-09-26']).toMatchObject({ received: 0, partial: true })
    expect(windows().dayUtc8).toMatchObject({ received: 0, transmitted: 0, partial: true })
    expect(daily().snapshots['2026-09-27']).toBeUndefined()
    expect(queryTimes().filter(t => t === end)).toHaveLength(1)
    snapshotRows = normal
    await run(end + H)
    expect(daily().days['2026-09-26']).toEqual({ received: DAY, transmitted: 2 * DAY, source: 'snapshot' })
  })

  test('新历史按 92 天保留，今日/未来历史不保留，旧快照按既有回填窗口裁剪', async () => {
    kv.set(`${UUID}|${DAILY_KEY}`, JSON.stringify({
      timeZone: 'UTC+08:00',
      days: {
        '2026-06-25': { received: 1 }, '2026-06-26': { received: 2 },
        '2026-09-26': { received: 3 }, '2026-09-27': { received: 4 },
      },
      snapshots: { '2026-08-24': null, '2026-08-25': null },
    }))
    await run(at(2026, 9, 26, 12))
    expect(daily().days['2026-06-25']).toBeUndefined()
    expect(daily().days['2026-06-26']).toEqual({ received: 2 })
    expect(daily().days['2026-09-26']).toBeUndefined()
    expect(daily().days['2026-09-27']).toBeUndefined()
    expect(daily().snapshots['2026-08-24']).toBeUndefined()
    expect(daily().snapshots['2026-08-25']).toBeNull()
  })
})

describe('存储顺序与原月口径回归', () => {
  test('历史写成功后才发布新日；写失败保留旧窗口，周期桶仍更新，重跑不重复累计', async () => {
    await run(at(2026, 9, 26, 23, 30))
    const oldWindow = kv.get(`${UUID}|${WINDOW_KEY}`)
    const oldDaily = kv.get(`${UUID}|${DAILY_KEY}`)
    beforeWrite = ({ key }) => { if (key === DAILY_KEY) throw new Error('daily write boom') }
    const now = at(2026, 9, 27, 0, 30)
    vi.setSystemTime(now)
    calls.length = 0
    const failed = await worker.onCall({ token: 't' })
    expect(failed.error).toContain('daily write boom')
    expect(windows().dayUtc8).toEqual(JSON.parse(oldWindow).dayUtc8)
    expect(windows().month.received).toBe(JSON.parse(oldWindow).month.received + H)
    expect(kv.get(`${UUID}|${DAILY_KEY}`)).toBe(oldDaily)
    expect(JSON.parse(kv.get(`${UUID}|metadata_traffic_cycle:2026-09-01`)).received).toBe(H)
    const writtenWindow = calls.find(c => c.method === 'kv_set_value' && c.params.key === WINDOW_KEY)
    expect(JSON.parse(writtenWindow.params.value).dayUtc8).toEqual(JSON.parse(oldWindow).dayUtc8)

    beforeWrite = ({ key }) => {
      if (key === WINDOW_KEY) expect(daily().days['2026-09-26']?.received).toBe(DAY)
    }
    await run(now)
    expect(windows().dayUtc8?.received).toBe(H / 2)
    const day = windows().dayUtc8
    await run(now)
    expect(windows().dayUtc8).toEqual(day)
    expect(daily().days['2026-09-26'].received).toBe(DAY)
    expect(JSON.parse(kv.get(`${UUID}|metadata_traffic_cycle:2026-09-01`)).received).toBe(H)
  })

  test('自然月仍按主控本地月换桶，继承旧基线；计费周期保持独立', async () => {
    kv.set(`${UUID}|metadata_traffic_reset_day`, 20)
    const before = Date.parse('2026-09-30T03:00:00Z')
    const after = Date.parse('2026-10-01T13:00:00Z')
    await run(before)
    expect(windows().month).toMatchObject({ id: '2026-09', received: 0 })
    await run(after)
    expect(windows().month).toMatchObject({ id: '2026-10', received: after - before, startedAt: after })
    expect(JSON.parse(kv.get(`${UUID}|metadata_traffic_cycle:2026-09-20`))).toMatchObject({
      cycleId: '2026-09-20', received: after - before, startedAt: before,
    })
    expect(windows().dayUtc8?.received).toBe(21 * H)
  })

  test('UTC+8 换日不改变主控本地自然月或计费周期 ID', async () => {
    const now = Date.parse('2026-09-30T16:00:00Z')
    const local = new Date(now)
    const monthId = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`
    await run(now)
    expect(windows().dayUtc8?.id).toBe('2026-10-01')
    expect(windows().month.id).toBe(monthId)
    expect(kv.get(`${UUID}|metadata_traffic_cycle:${monthId}-01`)).toBeTruthy()
  })

  test('计费重置日 31 仍夹到当月最后一天，新的周期不继承上一周期用量', async () => {
    kv.set(`${UUID}|metadata_traffic_reset_day`, 31)
    // 这里只验证原主控本地计费语义；不能让绝对 UTC 样本在 Auckland 提前跨日。
    latestRow = sample(new Date(2026, 1, 27, 12).getTime(), 1000)
    await run(latestRow.timestamp)
    expect(JSON.parse(kv.get(`${UUID}|metadata_traffic_cycle:2026-01-31`)).received).toBe(0)
    latestRow = sample(new Date(2026, 1, 28, 12).getTime(), 2000)
    await run(latestRow.timestamp)
    expect(JSON.parse(kv.get(`${UUID}|metadata_traffic_cycle:2026-02-28`))).toMatchObject({
      cycleId: '2026-02-28', received: 0, lastReceived: 2000,
    })
    expect(windows().month).toMatchObject({ id: '2026-02', received: 1000 })
  })
})

describe('审查回归：采样来源、恢复与失败重跑', () => {
  test('缺 RX 样本不丢最后有效计数器，随后回退仍被识别并永久标记', async () => {
    const start = midnight(2026, 9, 26)
    const end = start + DAY
    const row = (t, r) => ({ ...sample(t, r), total_transmitted: t - start + 1000 })
    snapshotRows = to => to === start ? [row(to, 1000)] : to === end ? [row(to, 2100)] : []
    latestRow = row(start + H, 1100)
    await run(latestRow.timestamp)
    latestRow = row(start + 2 * H, null)
    await run(latestRow.timestamp)
    expect(windows().dayUtc8.lastReceived).toBe(1100)
    latestRow = row(start + 3 * H, 10)
    await run(latestRow.timestamp)
    expect(windows().dayUtc8).toMatchObject({ received: 100, reset: true, partial: true })
    latestRow = row(start + 23 * H, 2000)
    await run(latestRow.timestamp)
    latestRow = row(end + H / 2, 2200)
    await run(latestRow.timestamp)
    expect(daily().days['2026-09-26']).toMatchObject({ received: 2190, reset: true, partial: true })
    await run(end + H)
    expect(daily().days['2026-09-26']).toMatchObject({ received: 2190, reset: true, partial: true })
  })

  test.each(['2026-09-26T04:00:00Z', '2026-09-30T15:59:59.500Z'])(
    'RPC 等待后用观察时间接纳真实新数据和定义日 ID（%s）', async iso => {
      const start = Date.parse(iso)
      const local = new Date(start)
      const monthId = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`
      beforeCall = method => {
        if (method === 'nodeget-server_list_all_agent_uuid') vi.setSystemTime(Date.now() + 1000)
      }
      const result = await run(start)
      const expectedId = new Date(start + 1000 + 8 * H).toISOString().slice(0, 10)
      expect(result.dayId).toBe(expectedId)
      expect(windows().dayUtc8).toMatchObject({ id: expectedId, updatedAt: start + 1000 })
      expect(windows().month.id).toBe(monthId)
      expect(kv.has(`${UUID}|metadata_traffic_cycle:${monthId}-01`)).toBe(true)
    },
  )

  test('午夜 RPC 首轮失败后，同日重试补上基线且累计仍幂等', async () => {
    const start = midnight(2026, 9, 26)
    const normal = snapshotRows
    snapshotRows = () => { throw new Error('temporary failure') }
    await run(start + H / 2)
    expect(windows().dayUtc8).toMatchObject({ received: 0, partial: true })
    snapshotRows = normal
    await run(start + H)
    expect(windows().dayUtc8).toMatchObject({ received: H, transmitted: 2 * H, startedAt: start })
    expect(windows().dayUtc8.partial).toBeUndefined()
    await run(start + H)
    expect(windows().dayUtc8.received).toBe(H)
  })

  test('迟到的起始快照暴露建桶前重置时，修复基线也不能抹掉重置缺口', async () => {
    const start = midnight(2026, 9, 26)
    snapshotRows = () => { throw new Error('temporary failure') }
    latestRow = sample(start + H / 2, 10)
    await run(latestRow.timestamp)
    snapshotRows = to => to === start ? [sample(to, 1000)] : []
    latestRow = sample(start + H, 1100)
    await run(latestRow.timestamp)
    expect(windows().dayUtc8).toMatchObject({ received: 1090, reset: true, partial: true })
  })

  test('首采缺RX时，迟到午夜快照仍能依据后来有效RX识别重置', async () => {
    const start = midnight(2026, 9, 26)
    snapshotRows = () => { throw new Error('temporary failure') }
    latestRow = { ...sample(start + H / 2, null), total_transmitted: 2000 }
    await run(latestRow.timestamp)
    snapshotRows = to => to === start ? [sample(to, 1000)] : []
    latestRow = { ...sample(start + H, 10), total_transmitted: 2100 }
    await run(latestRow.timestamp)
    expect(windows().dayUtc8).toMatchObject({ received: 0, reset: true, partial: true })
  })

  test('连续缺RX且午夜先恢复时，后续RX首次出现仍需与午夜基线比较并永久保留reset', async () => {
    const start = midnight(2026, 9, 26)
    snapshotRows = () => { throw new Error('temporary failure') }
    latestRow = { ...sample(start + H / 2, null), total_transmitted: 2000 }
    await run(latestRow.timestamp)
    snapshotRows = to => to === start ? [sample(to, 1000)] : to === start + DAY ? [sample(to, 2100)] : []
    latestRow = { ...sample(start + H, null), total_transmitted: 2100 }
    await run(latestRow.timestamp)
    latestRow = { ...sample(start + 2 * H, 10), total_transmitted: 2200 }
    await run(latestRow.timestamp)
    expect(windows().dayUtc8).toMatchObject({ received: 0, reset: true, partial: true })
    latestRow = sample(start + 23 * H, 2000)
    await run(latestRow.timestamp)
    latestRow = sample(start + DAY + H / 2, 2200)
    await run(latestRow.timestamp)
    expect(daily().days['2026-09-26']).toMatchObject({ received: 2090, reset: true, partial: true })
    await run(start + DAY + H)
    expect(daily().days['2026-09-26']).toMatchObject({ received: 2090, reset: true, partial: true })
  })

  test('真实Worker→parse→receiver：同采样修复靠revision更新，重跑不升版，迟到旧版不回滚', async () => {
    const start = midnight(2026, 9, 26)
    let boundaryMissing = true
    snapshotRows = to => {
      if (boundaryMissing) throw new Error('temporary failure')
      return to === start ? [sample(to, 1000)] : []
    }
    latestRow = sample(start + H, 1100)
    await run(latestRow.timestamp)
    const initialRaw = kv.get(`${UUID}|${WINDOW_KEY}`)
    const initial = parseDailyWindow(initialRaw)
    expect(initial).toMatchObject({ received: 0, partial: true, updatedAt: latestRow.timestamp, revision: 1 })
    let state = new Map()
    let commits = 0
    const observed = vi.fn(async () => {})
    const receiver = createDailyTrafficReceiver(update => { commits++; state = update(state) }, observed)
    await receiver.accept(new Map([[UUID, initial]]))

    boundaryMissing = false
    await run(start + 2 * H) // 同一动态行，仅午夜历史恢复。
    const correctedRaw = kv.get(`${UUID}|${WINDOW_KEY}`)
    const corrected = parseDailyWindow(correctedRaw)
    expect(corrected).toMatchObject({ received: 100, transmitted: 200, updatedAt: latestRow.timestamp, revision: 2 })
    expect(corrected.partial).toBeUndefined()
    await receiver.accept(new Map([[UUID, corrected]]))
    expect(state.get(UUID)).toBe(corrected)
    expect(commits).toBe(2)
    expect(windows().month.revision).toBeUndefined()
    expect(JSON.parse(kv.get(`${UUID}|metadata_traffic_cycle:2026-09-01`)).revision).toBeUndefined()

    await run(start + 3 * H)
    expect(kv.get(`${UUID}|${WINDOW_KEY}`)).not.toBe(initialRaw)
    expect(windows().dayUtc8).toEqual(JSON.parse(correctedRaw).dayUtc8)
    await receiver.accept(new Map([[UUID, parseDailyWindow(kv.get(`${UUID}|${WINDOW_KEY}`))]]))
    const observationsBeforeStale = observed.mock.calls.length
    await receiver.accept(new Map([[UUID, parseDailyWindow(initialRaw)]]))
    expect(state.get(UUID)).toBe(corrected)
    expect(commits).toBe(2)
    expect(observed).toHaveBeenCalledTimes(observationsBeforeStale)
  })

  test('首次版本化兼容无revision日桶；载荷不变不升版，新样本推进仅升一次', async () => {
    const start = midnight(2026, 9, 26)
    await run(start + H)
    const legacy = windows()
    delete legacy.dayUtc8.revision
    kv.set(`${UUID}|${WINDOW_KEY}`, JSON.stringify(legacy))
    await run(start + H)
    expect(windows().dayUtc8.revision).toBe(1)
    await run(start + H)
    expect(windows().dayUtc8.revision).toBe(1)
    await run(start + 2 * H)
    expect(windows().dayUtc8.revision).toBe(2)
    await run(start + 2 * H)
    expect(windows().dayUtc8.revision).toBe(2)
    await run(start + DAY + H)
    expect(windows().dayUtc8.revision).toBe(1)
    const newDay = windows().dayUtc8
    await run(start + DAY + H)
    expect(windows().dayUtc8).toEqual(newDay)
  })

  test('reset 日结束快照失败后保留待闭合锚点，次轮只补尾部且不重新计算重置日', async () => {
    const start = midnight(2026, 9, 26)
    const end = start + DAY
    let failEnd = true
    snapshotRows = to => {
      if (to === end && failEnd) throw new Error('end failure')
      return to === start ? [sample(to, 1000)] : to === end ? [sample(to, 200)] : []
    }
    for (const [t, r] of [[start + H, 1100], [start + 12 * H, 10], [start + 23 * H, 100]]) {
      latestRow = sample(t, r)
      await run(t)
    }
    latestRow = sample(end + H / 2, 250)
    await run(latestRow.timestamp)
    expect(daily().days['2026-09-26']).toMatchObject({ received: 190, reset: true, partial: true })
    failEnd = false
    latestRow = sample(end + H, 300)
    await run(latestRow.timestamp)
    expect(daily().days['2026-09-26']).toMatchObject({ received: 290, transmitted: 580, reset: true, partial: true })
    await run(end + 2 * H)
    expect(daily().days['2026-09-26'].received).toBe(290)
  })

  test.each(['empty', 'error'])('持久化23:59完整样本独立作为共同边界，午夜RPC %s也不丢31分钟', async kind => {
    const end = midnight(2026, 9, 27)
    await run(end - 60e3)
    const normal = snapshotRows
    snapshotRows = to => {
      if (to !== end) return normal(to)
      if (kind === 'error') throw new Error('boundary failure')
      return []
    }
    await run(end + H / 2)
    expect(daily().days['2026-09-26'].received).toBe(DAY - 60e3)
    expect(windows().dayUtc8.received).toBe(H / 2 + 60e3)
    expect(daily().days['2026-09-26'].received + windows().dayUtc8.received).toBe(DAY + H / 2)
    expect(daily().snapshots['2026-09-27'].ts).toBe(end - 60e3)
    expect(snapshotQueries().length).toBeLessThanOrEqual(12)
  })

  test.each(['empty', 'stale', 'missing field'])('近期 %s 快照不能永久负缓存，迟到午夜样本次轮恢复日桶', async kind => {
    const start = midnight(2026, 9, 26)
    const normal = snapshotRows
    snapshotRows = to => {
      if (to !== start) return normal(to)
      if (kind === 'empty') return []
      if (kind === 'stale') return [sample(to - 6 * 60e3)]
      return [{ ...sample(to), total_received: null }]
    }
    await run(start + H)
    expect(daily().snapshots['2026-09-26']).toBeNull()
    snapshotRows = normal
    await run(start + 2 * H)
    expect(queryTimes().filter(to => to === start)).toHaveLength(1)
    expect(windows().dayUtc8).toMatchObject({ received: 2 * H, startedAt: start })
    expect(windows().dayUtc8.partial).toBeUndefined()
    expect(daily().days['2026-09-25'].received).toBe(DAY)
  })

  test('历史写失败仍保存新月用量，但不暴露新日', async () => {
    const before = Date.parse('2026-09-30T03:00:00Z')
    const after = Date.parse('2026-10-01T13:00:00Z')
    await run(before)
    const oldDay = windows().dayUtc8
    beforeWrite = ({ key }) => { if (key === DAILY_KEY) throw new Error('history failure') }
    vi.setSystemTime(after)
    expect((await worker.onCall({ token: 't' })).error).toContain('history failure')
    expect(windows().dayUtc8).toEqual(oldDay)
    expect(windows().month).toMatchObject({ id: '2026-10', received: after - before })
  })

  test('历史成功窗口失败重跑时，从已落盘权威锚点继续，partial不能退回更少用量', async () => {
    const start = midnight(2026, 9, 26)
    snapshotRows = () => []
    latestRow = sample(start + 12 * H, 1000)
    await run(latestRow.timestamp)
    latestRow = sample(start + DAY - 60e3, 1200)
    beforeWrite = ({ key }) => { if (key === WINDOW_KEY) throw new Error('window failure') }
    vi.setSystemTime(start + DAY + H / 2)
    expect((await worker.onCall({ token: 't' })).error).toContain('window failure')
    expect(daily().days['2026-09-26']).toMatchObject({ received: 200, partial: true })
    beforeWrite = undefined
    latestRow = sample(start + DAY + H, 1300)
    await run(latestRow.timestamp)
    expect(daily().days['2026-09-26']).toMatchObject({ received: 200, partial: true })
    expect(windows().dayUtc8.received).toBe(100)
  })

  test('离线超过32天的旧桶依赖缓存不被立即裁掉，不每轮重查相同结束边界', async () => {
    latestRow = sample(at(2026, 8, 20, 12), 1000)
    snapshotRows = () => []
    await run(latestRow.timestamp)
    await run(at(2026, 9, 26, 12))
    expect(queryTimes().filter(to => to === midnight(2026, 8, 21))).toHaveLength(1)
    await run(at(2026, 9, 26, 12, 30))
    expect(queryTimes().filter(to => to === midnight(2026, 8, 21))).toHaveLength(0)
  })

  test('归档落盘后窗口写失败，迟到旧样本不能单边修订已被邻日使用的共同边界', async () => {
    const start = midnight(2026, 9, 24)
    const minute = 60e3
    const linear = t => sample(t, (t - start) / minute)
    snapshotRows = to => to < start ? [] : [linear(to === start + DAY ? to - 5 * minute : to)]
    latestRow = linear(start + 23.5 * H)
    await run(latestRow.timestamp)
    beforeWrite = ({ key }) => { if (key === WINDOW_KEY) throw new Error('window failure') }
    latestRow = linear(start + 2 * DAY + H / 2)
    vi.setSystemTime(latestRow.timestamp)
    expect((await worker.onCall({ token: 't' })).error).toContain('window failure')
    expect(daily().days['2026-09-24'].received).toBe(1435)
    expect(daily().days['2026-09-25'].received).toBe(1445)
    beforeWrite = undefined
    latestRow = linear(start + DAY - minute)
    await run(start + 2 * DAY + H)
    expect(daily().days['2026-09-24'].received + daily().days['2026-09-25'].received).toBe(2880)
  })

  test.each(['same node', 'other node'])('失败回调等待 %s 已启动写分支settle，不留下迟到窗口写', async scope => {
    if (scope === 'other node') uuids = [UUID, 'u2']
    let release
    let markEntered
    const gate = new Promise(resolve => { release = resolve })
    const entered = new Promise(resolve => { markEntered = resolve })
    beforeWrite = async ({ key, namespace }) => {
      if (key.startsWith('metadata_traffic_cycle:') && namespace === UUID) throw new Error('cycle failure')
      if (key === DAILY_KEY && namespace === (scope === 'same node' ? UUID : 'u2')) {
        markEntered()
        await gate
      }
    }
    vi.setSystemTime(at(2026, 9, 26, 12))
    let settled = false
    const first = worker.onCall({ token: 't' }).then(value => { settled = true; return value })
    await entered
    for (let i = 0; i < 30; i++) await Promise.resolve()
    const settledBeforeRelease = settled
    release()
    const failed = await first
    expect(settledBeforeRelease).toBe(false)
    expect(failed.error).toContain('cycle failure')
    beforeWrite = undefined
    await run(at(2026, 9, 26, 13))
    const saved = kv.get(`${UUID}|${WINDOW_KEY}`)
    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(kv.get(`${UUID}|${WINDOW_KEY}`)).toBe(saved)
    expect(windows().dayUtc8.received).toBe(13 * H)
  })

  test('跨多日缺方向的待闭合桶收到完整样本后，两日共享修复边界', async () => {
    const start = midnight(2026, 9, 24)
    const minute = 60e3
    const linear = t => sample(t, (t - start) / minute)
    snapshotRows = to => to < start ? [] : [linear(to === start + DAY ? to - 5 * minute : to)]
    latestRow = { ...linear(start + DAY - minute), total_received: null }
    await run(latestRow.timestamp)
    latestRow = linear(start + 2 * DAY + H / 2)
    await run(latestRow.timestamp)
    // 第一次可信的较晚完整样本到达后，两日必须共享一次边界，不能只补邻日一侧。
    latestRow = linear(start + DAY - 30e3)
    await run(start + 2 * DAY + 2 * H)
    const days = daily().days
    expect(days['2026-09-25']).toBeDefined()
    expect(days['2026-09-24'].received + days['2026-09-25'].received).toBe(2880)
  })

  test('坏日ID和不可构造Date的动态timestamp不使整轮throw', async () => {
    kv.set(`${UUID}|${WINDOW_KEY}`, JSON.stringify({ dayUtc8: {
      id: 'not-a-date', received: 0, transmitted: 0, startedAt: 1, updatedAt: 1,
    } }))
    latestRow = sample(-9e15, 1000)
    await run(at(2026, 9, 26, 12))
    expect(windows().dayUtc8).toBeUndefined()
    expect(windows().month).toBeTruthy()
  })
})
