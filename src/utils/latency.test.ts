import { afterEach, beforeEach, describe, test, expect, vi } from 'vitest'
import { buildLatencyTracks } from './latency'
import type { TaskQueryResult } from '../types'

const HOUR = 3_600_000
const T0 = Date.UTC(2026, 9, 12, 12, 0, 0)

function row(ping: number | null, task_id = 1): TaskQueryResult {
  return {
    task_id,
    timestamp: T0 - 60_000 - task_id * 1000,
    uuid: 'node-mo',
    success: ping !== null,
    error_message: ping === null ? 'timeout' : null,
    cron_source: 'ping-重庆移动',
    task_event_type: { ping: 'cq-cm.example' },
    task_event_result: ping === null ? null : { ping },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('buildLatencyTracks 地区判色', () => {
  test.each([
    { region: 'MO', ping: 199 },
    { region: 'MO', ping: 200 },
    { region: 'mo', ping: 200 },
    { region: ' MO ', ping: 200 },
  ])('澳门 $region 在 $ping ms、零丢包时显示黄色', ({ region, ping }) => {
    const block = buildLatencyTracks([row(ping)], region, 24, HOUR).cm?.blocks.at(-1)

    expect(block).toMatchObject({
      status: 'yellow',
      className: 'bg-amber-500',
      avg: ping,
      lossCount: 0,
      total: 1,
    })
  })

  test.each([
    { ping: 80, status: 'green' },
    { ping: 81, status: 'yellow' },
    { ping: 500, status: 'yellow' },
    { ping: 501, status: 'red' },
  ])('澳门 $ping ms 时为 $status，使用 80ms 基线并保留红色阈值', ({ ping, status }) => {
    const block = buildLatencyTracks([row(ping)], 'MO', 24, HOUR).cm?.blocks.at(-1)

    expect(block?.status).toBe(status)
  })

  test.each([
    { region: 'MY', ping: 120, status: 'green' },
    { region: 'MY', ping: 121, status: 'yellow' },
    { region: 'TH', ping: 120, status: 'green' },
    { region: 'TH', ping: 121, status: 'yellow' },
    { region: 'VN', ping: 120, status: 'green' },
    { region: 'VN', ping: 121, status: 'yellow' },
    { region: 'PH', ping: 120, status: 'green' },
    { region: 'PH', ping: 121, status: 'yellow' },
    { region: 'KH', ping: 120, status: 'green' },
    { region: 'KH', ping: 121, status: 'yellow' },
    { region: 'ID', ping: 150, status: 'green' },
    { region: 'ID', ping: 151, status: 'yellow' },
    { region: 'AU', ping: 200, status: 'green' },
    { region: 'AU', ping: 201, status: 'yellow' },
  ])('东南亚及澳大利亚 $region 在 $ping ms、零丢包时显示 $status', ({ region, ping, status }) => {
    const block = buildLatencyTracks([row(ping)], region, 24, HOUR).cm?.blocks.at(-1)

    expect(block?.status).toBe(status)
  })

  test.each([
    { region: 'HK', ping: 200, status: 'yellow' },
    { region: 'CN', ping: 200, status: 'yellow' },
    { region: 'TW', ping: 200, status: 'yellow' },
    { region: 'SG', ping: 110, status: 'green' },
    { region: 'SG', ping: 111, status: 'yellow' },
    { region: 'US', ping: 200, status: 'green' },
    { region: 'ZZ', ping: 250, status: 'green' },
    { region: 'ZZ', ping: 251, status: 'yellow' },
    { region: undefined, ping: 200, status: 'green' },
  ])('其他地区及默认规则不变：$region / $ping ms 为 $status', ({ region, ping, status }) => {
    const block = buildLatencyTracks([row(ping)], region, 24, HOUR).cm?.blocks.at(-1)

    expect(block?.status).toBe(status)
  })

  test.each([
    { lossCount: 1, status: 'green' },
    { lossCount: 2, status: 'yellow' },
    { lossCount: 9, status: 'yellow' },
    { lossCount: 10, status: 'red' },
    { lossCount: 100, status: 'red' },
  ])('澳门低延迟、丢包 $lossCount% 时保持 $status', ({ lossCount, status }) => {
    const rows = Array.from({ length: 100 }, (_, i) => row(i < lossCount ? null : 60, i + 1))
    const block = buildLatencyTracks(rows, 'MO', 24, HOUR).cm?.blocks.at(-1)

    expect(block).toMatchObject({ status, lossCount, total: 100 })
  })
})
