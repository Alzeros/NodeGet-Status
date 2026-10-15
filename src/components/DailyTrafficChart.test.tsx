import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MonthlyTraffic, Node } from '../types'
import { buildDailyBars } from '../utils/dailyTraffic'
import { bytes } from '../utils/format'
import { DailyTrafficChart } from './DailyTrafficChart'
import { StatsView } from './StatsView'

// SSR 不测浮层几何；只将布局 effect 换为同样不在服务端执行的 effect，避免 React 的预期警告。
vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>()
  return { ...react, useLayoutEffect: react.useEffect }
})

function window(cycleId: string, received: number): MonthlyTraffic {
  return { cycleId, received, transmitted: 0, total: received, startedAt: 0, updatedAt: 0 }
}

function node(uuid: string, dailyTraffic?: MonthlyTraffic): Node {
  return {
    uuid, source: 'main', online: false, static: {}, dynamic: null, history: [],
    meta: { name: uuid, region: '', price: 0, priceCycle: 30, expireTime: '' },
    dailyTraffic, dailyHistory: [{ id: '2026-09-25', received: 1024, transmitted: 1024 }],
  } as Node
}

beforeEach(() => {
  vi.useFakeTimers()
  // 北京时间 26 日、UTC 仍为 25 日，不能由浏览器本地日期或首个桶决定今日文案。
  vi.setSystemTime(new Date('2026-09-26T00:30:00+08:00'))
})
afterEach(() => vi.useRealTimers())

describe('UTC+8 日流量界面', () => {
  test('空图说明等待新窗口、更新 Worker 及回填取决于主控保留期', () => {
    const html = renderToStaticMarkup(<DailyTrafficChart data={null} showSource={false} />)
    expect(html).toContain('等待 UTC+8 日窗口更新')
    expect(html).toContain('新版')
    expect(html).toContain('Worker')
    expect(html).toContain('31 天')
    expect(html).toContain('主控保留期')
    expect(html).not.toContain('最近约三周')
  })

  test('有历史但没有今日桶时显示等待和破折号，而非虚假零用量', () => {
    const data = buildDailyBars([node('a')], 3)
    const html = renderToStaticMarkup(<DailyTrafficChart data={data} showSource={false} />)
    expect(data?.today).toBeNull()
    expect(html).toContain('等待 UTC+8 日窗口更新')
    expect(html).toContain('aria-label="2026-09-26（UTC+8） 等待 UTC+8 日窗口更新"')
    const todayStat = html.slice(html.indexOf('今天 · 实时'))
    expect(todayStat).toMatch(/今天 · 实时.*?font-bold">—</)
    expect(html).toContain('浅色柱 = 今天，实时累计 · 灰线 = 无记录 · 按 UTC+8 零点分日')
    expect(html).not.toContain('按主控时区分日')
  })

  test('有效零用量与缺数据分开，partial/reset 仍有非颜色说明', () => {
    const data = buildDailyBars([node('a', { ...window('2026-09-26', 0), partial: true, reset: true })], 3)
    const html = renderToStaticMarkup(<DailyTrafficChart data={data} showSource={false} />)
    expect(html).not.toContain('等待 UTC+8 日窗口更新')
    expect(html).toContain('合计 0 B')
    expect(html).toContain('1 台当天统计不完整')
    expect(html).toContain('计数器重置')
    expect(html).toContain('UTC+8')
  })

  test('今日榜单明确固定 UTC+8 窗口，混入旧桶也不计入榜单', () => {
    const old = node('old-only', window('2026-09-25', 10 * 1024 ** 3))
    const fresh = node('fresh-only', window('2026-09-26', 1024 ** 3))
    const html = renderToStaticMarkup(<StatsView nodes={[old, fresh]} statuses={new Map()} showSource={false} />)
    const ranking = html.slice(html.indexOf('流量排行'), html.indexOf('流量刷新倒计时'))
    expect(ranking).toContain('统计窗口 2026-09-26（UTC+8）')
    expect(ranking).toContain('fresh-only')
    expect(ranking).not.toContain('old-only')
    expect(ranking).toContain(bytes(1024 ** 3))
    expect(ranking).not.toContain('统计窗口 2026-09-25')
  })
})
