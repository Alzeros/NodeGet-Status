import { describe, test, expect } from 'vitest'
import { CITIES, continentOf, findCity } from './cities'
import { cityKeyOf, computeShowcase, inGeometry, placeNode, spreadClusters } from './geoPlace'
import type { GeoLookup, PlacedNode } from './geoPlace'
import type { Node } from '../types'

function node(name: string, region: string | null, lat: number | null, lng: number | null): Node {
  return { uuid: name, source: 'main', meta: { name, region: region ?? '', lat, lng }, static: {} } as unknown as Node
}

// 假地图：每个地区一个以中心为准的 10° 方框
const CENTERS: Record<string, [number, number]> = { US: [-100, 40], IS: [-19, 65], HK: [114.2, 22.3], JP: [138, 36] }
const geo: GeoLookup = {
  contains: (r, lng, lat) => (CENTERS[r] ? Math.abs(lng - CENTERS[r][0]) <= 5 && Math.abs(lat - CENTERS[r][1]) <= 5 : null),
  center: r => CENTERS[r] ?? null,
}

describe('cities 表', () => {
  test('每条都有合法的地区代码和坐标，别名不重复', () => {
    const seen = new Set<string>()
    for (const c of CITIES) {
      expect(c.region).toMatch(/^[A-Z]{2}$/)
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(c.lng)).toBeLessThanOrEqual(180)
      for (const k of [c.name, ...(c.aliases ?? [])]) {
        expect(seen.has(k.toLowerCase())).toBe(false)
        seen.add(k.toLowerCase())
      }
    }
  })

  test('按名字、别名、英文查都能命中，大小写不敏感', () => {
    expect(findCity('洛杉矶')?.region).toBe('US')
    expect(findCity('洛杉磯')?.name).toBe('洛杉矶')
    expect(findCity(' Los Angeles ')?.name).toBe('洛杉矶')
    expect(findCity('雷克雅未克')?.region).toBe('IS')
    expect(findCity('不存在的城市')).toBeNull()
  })

  test('大洲归属', () => {
    expect(continentOf('JP')).toBe('亚洲')
    expect(continentOf('is')).toBe('欧洲')
    expect(continentOf('AU')).toBe('大洋洲')
    expect(continentOf('XX')).toBeNull()
  })
})

describe('cityKeyOf', () => {
  test('取第一个连字符前的部分，全角和长横线也算', () => {
    expect(cityKeyOf('洛杉矶-VMRack')).toBe('洛杉矶')
    expect(cityKeyOf('东京－NoBrand-COG')).toBe('东京')
    expect(cityKeyOf('香港 Corenet')).toBe('香港 Corenet')
    expect(cityKeyOf('summerday')).toBe('summerday')
  })
})

describe('placeNode 三层降级', () => {
  test('城市名认得出且地区一致：用城市表坐标，IP 库过期也不影响', () => {
    const p = placeNode(node('雷克雅未克-Lazycat', 'IS', 3.14, 101.69), geo)!
    expect(p.source).toBe('city')
    expect([p.lng, p.lat]).toEqual([-21.94, 64.15])
    expect(p.cityKey).toBe('雷克雅未克')
    expect(p.tz).toBe(0)
  })

  test('城市名和地区矛盾：不信名字，退到经纬度', () => {
    const p = placeNode(node('东京-typo', 'US', 40, -100), geo)!
    expect(p.source).toBe('coords')
    expect(p.cityLabel).toBe('东京')
    expect(p.region).toBe('US')
  })

  test('名字打错：经纬度在地区内就按经纬度落点，标签保留打错的名字', () => {
    const p = placeNode(node('西亚图-Foo', 'US', 42, -102), geo)!
    expect(p.source).toBe('coords')
    expect(p.cityLabel).toBe('西亚图')
    expect(p.cityKey).toBe('西亚图')
  })

  test('名字打错且经纬度落在地区外：退到地区中心并标明', () => {
    const p = placeNode(node('香港-Geelinx-INTL'.replace('香港', '香巷'), 'HK', 31.77, 35.22), geo)!
    expect(p.source).toBe('region')
    expect([p.lng, p.lat]).toEqual(CENTERS.HK)
    expect(p.cityLabel).toBe('香港')
    expect(p.cityKey).toBe('HK')
  })

  test('没有地区代码：认得出城市就用城市，否则只能信经纬度', () => {
    expect(placeNode(node('东京-x', null, null, null), geo)?.source).toBe('city')
    const p = placeNode(node('abc', null, 10, 20), geo)!
    expect(p.source).toBe('coords')
    expect(p.cityLabel).toBe('abc')
    expect(placeNode(node('abc', null, null, null), geo)).toBeNull()
  })
})

describe('computeShowcase', () => {
  test('地区、城市、大洲、南北极点、时区跨度', () => {
    const placed = [
      placeNode(node('洛杉矶-a', 'US', null, null), geo)!,
      placeNode(node('洛杉矶-b', 'US', null, null), geo)!,
      placeNode(node('东京-a', 'JP', null, null), geo)!,
      placeNode(node('雷克雅未克-a', 'IS', null, null), geo)!,
      placeNode(node('悉尼-a', 'AU', null, null), geo)!,
    ] as PlacedNode[]
    const s = computeShowcase(placed)
    expect(s).toMatchObject({ regions: 4, cities: 4, machines: 5, tzSpan: 18 })
    expect(s.continents.have).toEqual(['亚洲', '欧洲', '北美洲', '大洋洲'])
    expect(s.continents.missing).toEqual(['南美洲', '非洲'])
    expect(s.north).toEqual({ label: '雷克雅未克', lat: 64.15 })
    expect(s.south).toEqual({ label: '悉尼', lat: -33.87 })
  })
})

describe('几何工具', () => {
  test('inGeometry 支持孔洞和多多边形', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
    expect(inGeometry(2, 2, { type: 'Polygon', coordinates: [square, hole] })).toBe(true)
    expect(inGeometry(5, 5, { type: 'Polygon', coordinates: [square, hole] })).toBe(false)
    expect(inGeometry(20, 20, { type: 'MultiPolygon', coordinates: [[square], [[[19, 19], [21, 19], [21, 21], [19, 21], [19, 19]]]] })).toBe(true)
  })

  test('spreadClusters 把重叠的簇推开，不重叠的不动', () => {
    const out = spreadClusters([{ x: 0, y: 0, r: 10 }, { x: 5, y: 0, r: 10 }, { x: 200, y: 0, r: 5 }], 4)
    expect(out[2]).toEqual({ x: 200, y: 0, r: 5 })
    expect(Math.hypot(out[1].x - out[0].x, out[1].y - out[0].y)).toBeGreaterThanOrEqual(24 - 1e-6)
  })
})
