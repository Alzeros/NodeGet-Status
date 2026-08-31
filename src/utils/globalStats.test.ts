import { describe, test, expect } from 'vitest'
import { computeGlobalStats } from './globalStats'
import type { DynamicSummary, Node } from '../types'
import type { NodeStatusCategory } from './stableStatus'

// 构造一个最小可用的节点：online 直接给定（computeGlobalStats 信任调用方已算好），
// dynamic 可塞一个掉线前残留的速率快照——这正是 bug 的触发条件。
function makeNode(
  uuid: string,
  online: boolean,
  speed: { receive?: number; transmit?: number } = {},
): Node {
  const hasSpeed = speed.receive != null || speed.transmit != null
  const dyn: DynamicSummary | null = hasSpeed
    ? ({
        uuid,
        // 在线给个有效时间戳、离线给 0（仅作占位，函数不依赖此值判在线）
        timestamp: online ? 1 : 0,
        receive_speed: speed.receive ?? 0,
        transmit_speed: speed.transmit ?? 0,
      } as DynamicSummary)
    : null
  return {
    uuid,
    source: 'test',
    online,
    meta: {
      name: '',
      region: '',
      tags: [],
      hidden: false,
      virtualization: '',
      lat: null,
      lng: null,
      order: 0,
      price: 0,
      priceUnit: '$',
      priceCycle: 30,
      expireTime: '',
      trafficResetDay: 1,
    },
    static: {},
    dynamic: dyn,
    history: [],
  } as Node
}

describe('computeGlobalStats 实时带宽', () => {
  test('离线节点的残留速率快照不计入实时带宽总量', () => {
    // 在线：5M↓ / 1M↑
    // 离线：掉线前残留 10M↓ / 10M↑ 快照，掉线后 live Map 不再刷新——bug 触发条件
    const nodes = new Map<string, Node>([
      ['a', makeNode('a', true, { receive: 5_000_000, transmit: 1_000_000 })],
      ['b', makeNode('b', false, { receive: 10_000_000, transmit: 10_000_000 })],
    ])
    const stable = new Map<string, NodeStatusCategory>()

    const r = computeGlobalStats(nodes, stable)

    expect(r.totalNetIn).toBe(5_000_000)
    expect(r.totalNetOut).toBe(1_000_000)
    expect(r.totalBandwidth).toBe(6_000_000)
  })

  test('在线节点的实时速率正常计入', () => {
    const nodes = new Map<string, Node>([
      ['a', makeNode('a', true, { receive: 5_000_000, transmit: 1_000_000 })],
      ['c', makeNode('c', true, { receive: 3_000_000, transmit: 2_000_000 })],
    ])
    const stable = new Map<string, NodeStatusCategory>()

    const r = computeGlobalStats(nodes, stable)

    expect(r.totalNetIn).toBe(8_000_000)
    expect(r.totalNetOut).toBe(3_000_000)
  })
})
