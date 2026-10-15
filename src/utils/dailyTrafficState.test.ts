import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { DynamicSummary, MonthlyTraffic } from '../types'
import { createDailyHistoryRefresh, createDailyTrafficReceiver, currentDailyTraffic, parseDailyHistory, parseDailyWindow, previewDailyTraffic } from './dailyTrafficState'

const now = new Date('2026-09-26T12:00:00+08:00')
const sampledAt = Date.parse('2026-09-26T11:00:00+08:00')
const rawWindow = {
  id: '2026-09-26', received: 20, transmitted: 30,
  lastReceived: 100, lastTransmitted: 200,
  startedAt: Date.parse('2026-09-26T00:00:00+08:00'), updatedAt: sampledAt,
  partial: true, reset: true,
}

function window(cycleId = '2026-09-26'): MonthlyTraffic {
  return { ...rawWindow, cycleId, total: 50 }
}

function sample(timestamp: number, total_received = 110, total_transmitted = 220): DynamicSummary {
  return { uuid: 'a', timestamp, total_received, total_transmitted }
}

function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('parseDailyWindow', () => {
  test('只解析 dayUtc8，原生对象和 JSON 字符串均保留采样时刻与标记', () => {
    const raw = { day: { ...rawWindow, received: 999 }, month: { ...rawWindow, id: '2026-09' }, dayUtc8: rawWindow }
    for (const value of [raw, JSON.stringify(raw)]) {
      expect(parseDailyWindow(value)).toEqual({
        cycleId: '2026-09-26', received: 20, transmitted: 30, total: 50,
        lastReceived: 100, lastTransmitted: 200,
        startedAt: rawWindow.startedAt, updatedAt: sampledAt, partial: true, reset: true,
      })
    }
  })

  test('保留正整数revision，缺失或非法revision按未版本化窗口兼容', () => {
    for (const revision of [1, 2, Number.MAX_SAFE_INTEGER]) {
      expect(parseDailyWindow({ dayUtc8: { ...rawWindow, revision } })?.revision).toBe(revision)
    }
    for (const revision of [undefined, 0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2']) {
      expect(parseDailyWindow({ dayUtc8: { ...rawWindow, revision } })?.revision).toBeUndefined()
    }
  })

  test('旧 day、不合法窗口及缺失计数器不回退为有效零用量', () => {
    for (const raw of [null, '{', { day: rawWindow }, { dayUtc8: null }, { dayUtc8: { ...rawWindow, id: '2026-09' } }, { dayUtc8: { ...rawWindow, received: undefined } }, { dayUtc8: { ...rawWindow, transmitted: -1 } }]) {
      expect(parseDailyWindow(raw)).toBeUndefined()
    }
    expect(parseDailyWindow({ dayUtc8: { ...rawWindow, received: 0, transmitted: 0 } })?.total).toBe(0)
  })
})

describe('parseDailyHistory', () => {
  test('只接纳带固定时区标记的新历史，日期排序并保留 partial/reset', () => {
    const raw = {
      timeZone: 'UTC+08:00', snapshots: { ignored: true }, updatedAt: sampledAt,
      days: {
        '2026-09-25': { received: 2, transmitted: 3, reset: true },
        '2026-09-24': { received: 0, transmitted: 0, partial: true },
        invalid: { received: 999, transmitted: 999 },
        '2026-09-23': { received: -1, transmitted: 5 },
        '2026-09-22': { received: 1 },
      },
    }
    for (const value of [raw, JSON.stringify(raw)]) {
      expect(parseDailyHistory(value)).toEqual([
        { id: '2026-09-24', received: 0, transmitted: 0, partial: true },
        { id: '2026-09-25', received: 2, transmitted: 3, reset: true },
      ])
    }
  })

  test('旧历史、错误时区及损坏记录不能混入，合法空历史保留为空数组', () => {
    const days = { '2026-09-25': { received: 999, transmitted: 999 } }
    for (const raw of [null, '{', { days }, { timeZone: 'UTC', days }, { timeZone: 'UTC+8', days }, { timeZone: 'UTC+08:00', days: [] }]) {
      expect(parseDailyHistory(raw)).toBeUndefined()
    }
    expect(parseDailyHistory({ timeZone: 'UTC+08:00', days: {} })).toEqual([])
  })
})

describe('currentDailyTraffic / previewDailyTraffic', () => {
  test('只有 UTC+8 当日桶有效，旧日和未来日均不冒充今日', () => {
    const current = window()
    expect(currentDailyTraffic(current, now)).toBe(current)
    expect(currentDailyTraffic(undefined, now)).toBeUndefined()
    expect(currentDailyTraffic(window('2026-09-25'), new Date('2026-09-25T16:00:00Z'))).toBeUndefined()
    expect(currentDailyTraffic(window('2026-09-27'), now)).toBeUndefined()
  })

  test('在实时预览之前剔除过期窗口，午夜无需等 Worker 换桶', () => {
    const row = sample(Date.parse('2026-09-26T16:00:00Z'), 500, 800)
    expect(previewDailyTraffic(window(), row, new Date('2026-09-26T16:00:00Z'))).toBeUndefined()
    expect(previewDailyTraffic(window('2026-09-27'), row, now)).toBeUndefined()
  })

  test('当前日较新采样按非负增量预览，不改变原记录和标记', () => {
    const record = window()
    const result = previewDailyTraffic(record, sample(sampledAt + 1000), now)
    expect(result).toMatchObject({ received: 30, transmitted: 50, total: 80, updatedAt: sampledAt, partial: true, reset: true })
    expect(record.total).toBe(50)
    expect(previewDailyTraffic(record, null, now)).toBe(record)
  })

  test('落后、同一采样、前一日、未来或无效动态时刻都不能推进当前桶', () => {
    const record = window()
    for (const timestamp of [sampledAt - 1000, sampledAt, Date.parse('2026-09-25T15:59:59Z'), now.getTime() + 1, Number.NaN]) {
      expect(previewDailyTraffic(record, sample(timestamp, 999, 999), now)).toBe(record)
    }
  })

  test('回退或缺失计数器不虚增，只对有可靠增量的方向预览', () => {
    expect(previewDailyTraffic(window(), sample(sampledAt + 1000, 50, 220), now)).toMatchObject({ received: 20, transmitted: 50, total: 70 })
    expect(previewDailyTraffic(window(), { uuid: 'a', timestamp: sampledAt + 1000 }, now)?.total).toBe(50)
  })
})

describe('createDailyTrafficReceiver（hook 日桶接线）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })
  afterEach(() => vi.useRealTimers())

  test('旧日请求晚于新日回包时，不能回滚日桶或让 observer 倒退', async () => {
    let state = new Map<string, MonthlyTraffic>()
    const observed: string[] = []
    let reads = 0
    const refresh = createDailyHistoryRefresh(async () => { reads++ })
    const receiver = createDailyTrafficReceiver(update => { state = update(state) }, (key, id) => {
      observed.push(`${key}:${id}`)
      return refresh.observe(key, id)
    })
    const oldResponse = deferred()
    const pending = oldResponse.promise.then(() => receiver.accept(new Map([['main:a', window('2026-09-25')]])))
    const fresh = window()
    await receiver.accept(new Map([['main:a', fresh]]))
    oldResponse.resolve()
    await pending
    expect(state.get('main:a')).toBe(fresh)
    expect(observed).toEqual(['main:a:2026-09-26'])
    expect(reads).toBe(1)
  })

  test('同日旧 baseline 不覆盖新 updatedAt，幂等回包不 setState 或重复加载历史', async () => {
    let state = new Map<string, MonthlyTraffic>()
    let commits = 0
    let reads = 0
    const refresh = createDailyHistoryRefresh(async () => { reads++ })
    const receiver = createDailyTrafficReceiver(update => { commits++; state = update(state) }, refresh.observe)
    const stale = { ...window(), updatedAt: sampledAt - 1000, received: 999, lastReceived: 999 }
    const oldResponse = deferred()
    const pending = oldResponse.promise.then(() => receiver.accept(new Map([['main:a', stale]])))
    const fresh = window()
    await receiver.accept(new Map([['main:a', fresh]]))
    oldResponse.resolve()
    await pending
    await receiver.accept(new Map([['main:a', { ...fresh }]]))
    expect(state.get('main:a')).toBe(fresh)
    expect(commits).toBe(1)
    expect(reads).toBe(1)
  })

  test('同日版本优先于采样时刻；旧revision及重复版不提交，也不倒退observer', async () => {
    let state = new Map<string, MonthlyTraffic>()
    let commits = 0
    const observe = vi.fn(async () => {})
    const receiver = createDailyTrafficReceiver(update => { commits++; state = update(state) }, observe)
    const current = { ...window(), revision: 2 }
    await receiver.accept(new Map([['main:a', current]]))
    await receiver.accept(new Map([['main:a', { ...window(), revision: 1, updatedAt: sampledAt + 1000 }]]))
    expect(state.get('main:a')).toBe(current)
    expect(observe).toHaveBeenCalledTimes(1)
    await receiver.accept(new Map([['main:a', { ...current }]]))
    expect(commits).toBe(1)
    const corrected = { ...window(), revision: 3, received: 100, updatedAt: sampledAt - 1000 }
    await receiver.accept(new Map([['main:a', corrected]]))
    expect(state.get('main:a')).toBe(corrected)
    expect(commits).toBe(2)
  })

  test('同日版本化窗口可替代无版本窗口，后到无版本窗口不回滚；新日仍先按ID排序', async () => {
    let state = new Map<string, MonthlyTraffic>()
    const observe = vi.fn(async () => {})
    const receiver = createDailyTrafficReceiver(update => { state = update(state) }, observe)
    await receiver.accept(new Map([['main:a', { ...window(), updatedAt: sampledAt + 1000 }]]))
    const versioned = { ...window(), revision: 1 }
    await receiver.accept(new Map([['main:a', versioned]]))
    expect(state.get('main:a')).toBe(versioned)
    await receiver.accept(new Map([['main:a', { ...window(), updatedAt: sampledAt + 2000 }]]))
    expect(state.get('main:a')).toBe(versioned)
    expect(observe).toHaveBeenCalledTimes(2)
    const nextDay = window('2026-09-27')
    await receiver.accept(new Map([['main:a', nextDay]]))
    await receiver.accept(new Map([['main:a', { ...versioned, revision: 999 }]]))
    expect(state.get('main:a')).toBe(nextDay)
    expect(observe).toHaveBeenCalledTimes(3)
  })

  test('以 source:uuid 独立排序，先比较日 id、再比较采样时刻', async () => {
    let state = new Map<string, MonthlyTraffic>()
    const receiver = createDailyTrafficReceiver(update => { state = update(state) }, async () => {})
    await receiver.accept(new Map([
      ['main:a', window()],
      ['backup:a', { ...window('2026-09-25'), updatedAt: sampledAt + 2000 }],
    ]))
    const backupNewDay = { ...window(), updatedAt: sampledAt - 1000 }
    await receiver.accept(new Map([['backup:a', backupNewDay]]))
    expect(state.get('backup:a')).toBe(backupNewDay)
    expect(state.get('main:a')?.updatedAt).toBe(sampledAt)
    const nextSample = { ...backupNewDay, updatedAt: sampledAt + 1000 }
    await receiver.accept(new Map([['backup:a', nextSample]]))
    expect(state.get('backup:a')).toBe(nextSample)
  })

  test('旧 effect 清理后，晚回包和已排队的 state updater 都不能污染新 effect', async () => {
    let state = new Map<string, MonthlyTraffic>()
    const queued: ((previous: Map<string, MonthlyTraffic>) => Map<string, MonthlyTraffic>)[] = []
    const commit = (update: (previous: Map<string, MonthlyTraffic>) => Map<string, MonthlyTraffic>) => { queued.push(update) }
    let oldObservations = 0
    const oldReceiver = createDailyTrafficReceiver(commit, async () => { oldObservations++ })
    await oldReceiver.accept(new Map([['main:a', window('2026-09-27')]]))
    const late = deferred()
    const pending = late.promise.then(() => oldReceiver.accept(new Map([['main:a', window('2026-09-28')]])))
    oldReceiver.dispose()
    const newReceiver = createDailyTrafficReceiver(commit, async () => {})
    const fresh = window()
    await newReceiver.accept(new Map([['main:a', fresh]]))
    const replacementState = new Map([['main:a', fresh]])
    expect(queued[0](replacementState)).toBe(replacementState)
    // 模拟 React 在清理完成后才执行先前排队的 updater。
    for (const update of queued) state = update(state)
    expect(state.get('main:a')).toBe(fresh)
    late.resolve()
    await pending
    expect(queued).toHaveLength(2)
    expect(oldObservations).toBe(1)
    expect(state.get('main:a')).toBe(fresh)
  })

  test('真实接线每两秒接受同版本回包，失败仅冷却到期重读，恢复后不再重复加载', async () => {
    let state = new Map<string, MonthlyTraffic>()
    let commits = 0
    const reads = { healthy: 0, failing: 0 }
    let offline = true
    const refresh = createDailyHistoryRefresh(async () => {
      const results = await Promise.allSettled([
        (async () => { reads.healthy++ })(),
        (async () => { reads.failing++; if (offline) throw new Error('offline') })(),
      ])
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })
    const receiver = createDailyTrafficReceiver(update => { commits++; state = update(state) }, refresh.observe)
    const poll = () => receiver.accept(new Map([['main:a', window()]])).catch(() => {})
    await poll()
    for (let elapsed = 2_000; elapsed <= 88_000; elapsed += 2_000) {
      vi.advanceTimersByTime(2_000)
      await poll()
      const expected = elapsed < 30_000 ? 1 : 2
      expect(reads).toEqual({ healthy: expected, failing: expected })
    }
    offline = false
    vi.advanceTimersByTime(2_000)
    await poll()
    expect(reads).toEqual({ healthy: 3, failing: 3 })
    for (let i = 0; i < 45; i++) {
      vi.advanceTimersByTime(2_000)
      await poll()
    }
    expect(reads).toEqual({ healthy: 3, failing: 3 })
    expect(state.get('main:a')?.cycleId).toBe('2026-09-26')
    expect(commits).toBe(1)
  })
})

describe('createDailyHistoryRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })
  afterEach(() => vi.useRealTimers())

  test('启动/慢轮询用 refresh；成功后同 key/id 的 observe 不重复读', async () => {
    let reads = 0
    const coordinator = createDailyHistoryRefresh(async () => { reads++ })
    await coordinator.refresh()
    expect(reads).toBe(1)
    await coordinator.observe('main:a', '2026-09-26')
    expect(reads).toBe(2)
    await coordinator.observe('main:a', '2026-09-26')
    await coordinator.observe('main:a', '2026-09-26')
    expect(reads).toBe(2)
    await coordinator.refresh()
    expect(reads).toBe(3)
  })

  test('加载期间换日或另一个主控换桶会排队补读，所有 Promise 等到补读完成', async () => {
    const first = deferred()
    const second = deferred()
    const secondStarted = deferred()
    let reads = 0
    const coordinator = createDailyHistoryRefresh(() => {
      reads++
      if (reads === 1) return first.promise
      secondStarted.resolve()
      return second.promise
    })
    const initial = coordinator.observe('main:a', '2026-09-25')
    await Promise.resolve()
    expect(reads).toBe(1)
    const changed = coordinator.observe('main:a', '2026-09-26')
    const other = coordinator.observe('backup:a', '2026-09-26')
    let settled = false
    void changed.then(() => { settled = true })
    first.resolve()
    await secondStarted.promise
    expect(reads).toBe(2)
    expect(settled).toBe(false)
    second.resolve()
    await Promise.all([initial, changed, other])
    await coordinator.observe('main:a', '2026-09-26')
    await coordinator.observe('backup:a', '2026-09-26')
    expect(reads).toBe(2)
  })

  test('启动 refresh 期间观察到窗口也会补读，而不是错误确认已归档', async () => {
    const first = deferred()
    let reads = 0
    const coordinator = createDailyHistoryRefresh(() => ++reads === 1 ? first.promise : Promise.resolve())
    const initial = coordinator.refresh()
    await Promise.resolve()
    const observed = coordinator.observe('main:a', '2026-09-26')
    first.resolve()
    await Promise.all([initial, observed])
    expect(reads).toBe(2)
  })

  test('失败不确认观察版本，同一 id 冷却结束后的 observe 可重试', async () => {
    let reads = 0
    const coordinator = createDailyHistoryRefresh(async () => {
      if (++reads === 1) throw new Error('offline')
    })
    await expect(coordinator.observe('main:a', '2026-09-26')).rejects.toThrow('offline')
    await coordinator.observe('main:a', '2026-09-26')
    expect(reads).toBe(1)
    vi.advanceTimersByTime(30_000)
    await coordinator.observe('main:a', '2026-09-26')
    await coordinator.observe('main:a', '2026-09-26')
    expect(reads).toBe(2)
  })

  test('补读失败后仍会重试 pending 版本，不与未完成的加载并发', async () => {
    const first = deferred()
    let reads = 0
    const coordinator = createDailyHistoryRefresh(() => {
      reads++
      if (reads === 1) return first.promise
      return reads === 2 ? Promise.reject(new Error('retry later')) : Promise.resolve()
    })
    const pending = coordinator.observe('main:a', '2026-09-25')
    await Promise.resolve()
    const changed = coordinator.observe('main:a', '2026-09-26')
    const failures = Promise.all([
      expect(pending).rejects.toThrow('retry later'),
      expect(changed).rejects.toThrow('retry later'),
    ])
    first.resolve()
    await failures
    vi.advanceTimersByTime(30_000)
    await coordinator.observe('main:a', '2026-09-26')
    expect(reads).toBe(3)
  })

  test('同一版本慢轮询失败后，下一次 observe 仍可重试', async () => {
    let reads = 0
    const coordinator = createDailyHistoryRefresh(async () => {
      if (++reads === 2) throw new Error('offline')
    })
    await coordinator.observe('main:a', '2026-09-26')
    await expect(coordinator.refresh()).rejects.toThrow('offline')
    vi.advanceTimersByTime(30_000)
    await coordinator.observe('main:a', '2026-09-26')
    expect(reads).toBe(3)
  })

  test('每两秒 observe 时，失败按30秒/60秒冷却且成功主控不会被高频重读', async () => {
    const backendReads = { healthy: 0, failing: 0 }
    let offline = true
    const coordinator = createDailyHistoryRefresh(async () => {
      const results = await Promise.allSettled([
        (async () => { backendReads.healthy++ })(),
        (async () => {
          backendReads.failing++
          if (offline) throw new Error('offline')
        })(),
      ])
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })
    const poll = () => coordinator.observe('main:a', '2026-09-26').catch(() => {})
    await poll()
    for (let elapsed = 2_000; elapsed <= 148_000; elapsed += 2_000) {
      vi.advanceTimersByTime(2_000)
      await poll()
      const expected = elapsed < 30_000 ? 1 : elapsed < 90_000 ? 2 : 3
      expect(backendReads).toEqual({ healthy: expected, failing: expected })
    }
    // t=150s：第三次失败后的60秒冷却已过，后端恢复，无需换桶即可重试成功。
    offline = false
    vi.advanceTimersByTime(2_000)
    await poll()
    expect(backendReads).toEqual({ healthy: 4, failing: 4 })
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(2_000)
      await poll()
    }
    expect(backendReads).toEqual({ healthy: 4, failing: 4 })
  })

  test('新日 revision 可跳过旧失败冷却，显式 refresh 同样可立即尝试', async () => {
    let reads = 0
    const coordinator = createDailyHistoryRefresh(async () => {
      reads++
      throw new Error('offline')
    })
    await expect(coordinator.observe('main:a', '2026-09-25')).rejects.toThrow('offline')
    await coordinator.observe('main:a', '2026-09-25')
    expect(reads).toBe(1)
    await expect(coordinator.observe('main:a', '2026-09-26')).rejects.toThrow('offline')
    expect(reads).toBe(2)
    await expect(coordinator.refresh()).rejects.toThrow('offline')
    expect(reads).toBe(3)
  })

  test('旧 revision 加载期间换桶后失败，不把新 revision 一并置于冷却', async () => {
    const first = deferred()
    let reads = 0
    const coordinator = createDailyHistoryRefresh(() => ++reads === 1 ? first.promise : Promise.resolve())
    const initial = coordinator.observe('main:a', '2026-09-25')
    await Promise.resolve()
    const changed = coordinator.observe('main:a', '2026-09-26')
    const failures = Promise.all([
      expect(initial).rejects.toThrow('offline'),
      expect(changed).rejects.toThrow('offline'),
    ])
    first.reject(new Error('offline'))
    await failures
    await coordinator.observe('main:a', '2026-09-26')
    expect(reads).toBe(2)
  })
})
