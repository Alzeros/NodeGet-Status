import type { Node } from '../types'
import { CONTINENTS, REGION_CN, continentOf, findCity } from './cities'
import type { Continent } from './cities'
import { displayName } from './derive'

/*
 * 地图落点。三层降级，越靠前越可信：
 *   city    节点名前缀是表里的城市，且城市所在国家和地区代码一致 → 用表里的坐标
 *   coords  主控给的经纬度落在地区代码对应的多边形内 → 用经纬度（IP 库大多数时候是对的）
 *   region  都不行 → 地区默认位置（国家中心），悬停时标"位置按地区推定"
 * 经纬度来自 IP 库，过期时会把冰岛画到马来西亚，所以它只是备选，还要经过地区校验。
 */

export type PlaceSource = 'city' | 'coords' | 'region'

export interface PlacedNode {
  node: Node
  lng: number
  lat: number
  region: string | null
  /** 同城合并用的键：城市名，或地区代码（按地区推定时） */
  cityKey: string
  cityLabel: string
  source: PlaceSource
  /** 标准时区偏移（小时）；按城市表给，其它来源按经度粗算 */
  tz: number
}

export interface GeoLookup {
  /** 点是否落在地区多边形内；地区没有多边形时返回 null（此时经纬度只能信） */
  contains(region: string, lng: number, lat: number): boolean | null
  /** 地区默认落点（国家中心） */
  center(region: string): [number, number] | null
  /** 地区英文名（地图数据里的 cname），REGION_CN 没有时兜底 */
  cname?(region: string): string | undefined
}

export function regionOf(n: Node) {
  const a2 = n.meta?.region?.trim().toUpperCase()
  return a2 && /^[A-Z]{2}$/.test(a2) ? a2 : null
}

/** 节点名第一个连字符前面的部分，约定是城市名："洛杉矶-VMRack" → "洛杉矶" */
export function cityKeyOf(name: string) {
  return name.split(/[-－–—_/|]/)[0].trim()
}

export function regionLabel(region: string, geo?: Pick<GeoLookup, 'cname'>) {
  return REGION_CN[region] || geo?.cname?.(region) || region
}

export function placeNode(n: Node, geo: GeoLookup): PlacedNode | null {
  const region = regionOf(n)
  const prefix = cityKeyOf(displayName(n))
  const city = prefix ? findCity(prefix) : null
  if (city && (!region || city.region === region)) {
    return { node: n, lng: city.lng, lat: city.lat, region: region ?? city.region, cityKey: city.name, cityLabel: city.name, source: 'city', tz: city.tz }
  }

  const { lat, lng } = n.meta ?? {}
  if (typeof lat === 'number' && typeof lng === 'number' && (lat !== 0 || lng !== 0) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    const inside = region ? geo.contains(region, lng, lat) : null
    if (inside !== false) {
      // 城市没认出来：标签用名字里写的前缀（打错了也照样显示，一眼能看出来），
      // 合并键带上粗略坐标，同城的还是会并到一起
      const key = `${region ?? '??'}@${Math.round(lng / 2)},${Math.round(lat / 2)}`
      return { node: n, lng, lat, region, cityKey: prefix || key, cityLabel: prefix || (region ? regionLabel(region, geo) : '未知位置'), source: 'coords', tz: Math.round(lng / 15) }
    }
  }

  if (!region) return null
  const c = geo.center(region)
  if (!c) return null
  return { node: n, lng: c[0], lat: c[1], region, cityKey: region, cityLabel: regionLabel(region, geo), source: 'region', tz: Math.round(c[0] / 15) }
}

export interface Showcase {
  regions: number
  cities: number
  machines: number
  continents: { have: Continent[]; missing: Continent[] }
  north: { label: string; lat: number } | null
  south: { label: string; lat: number } | null
  /** 最东与最西所在时区之差（小时） */
  tzSpan: number
}

/** 打卡数字：点亮了几个地区、几座城市，跨了几个大洲、几个时区，最北最南到哪 */
export function computeShowcase(placed: PlacedNode[]): Showcase {
  const regions = new Set<string>()
  const cities = new Set<string>()
  const have = new Set<Continent>()
  let north: PlacedNode | null = null
  let south: PlacedNode | null = null
  let tzMin = Infinity
  let tzMax = -Infinity
  for (const p of placed) {
    if (p.region) regions.add(p.region)
    cities.add(p.cityKey)
    const c = continentOf(p.region)
    if (c) have.add(c)
    if (!north || p.lat > north.lat) north = p
    if (!south || p.lat < south.lat) south = p
    tzMin = Math.min(tzMin, p.tz)
    tzMax = Math.max(tzMax, p.tz)
  }
  return {
    regions: regions.size,
    cities: cities.size,
    machines: placed.length,
    continents: { have: CONTINENTS.filter(c => have.has(c)), missing: CONTINENTS.filter(c => !have.has(c)) },
    north: north ? { label: north.cityLabel, lat: north.lat } : null,
    south: south ? { label: south.cityLabel, lat: south.lat } : null,
    tzSpan: placed.length ? tzMax - tzMin : 0,
  }
}

/** 射线法：点是否在环内 */
export function inRing(x: number, y: number, ring: number[][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 点是否在 GeoJSON 几何内（Polygon / MultiPolygon，奇偶规则处理孔洞） */
export function inGeometry(x: number, y: number, geometry: { type: string; coordinates: any }) {
  const polys: number[][][][] =
    geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : []
  return polys.some(rings => {
    let inside = false
    for (const ring of rings) if (inRing(x, y, ring)) inside = !inside
    return inside
  })
}

export interface Placed2D {
  x: number
  y: number
  r: number
}

/**
 * 把挨得太近的簇推开：两两之间距离小于半径之和加间距就沿连线方向各退一半。
 * 洛杉矶和圣何塞在世界地图上只差十来像素，不推开就叠在一起。几轮迭代就够稳定。
 */
export function spreadClusters(items: Placed2D[], gap: number, rounds = 12): Placed2D[] {
  const out = items.map(p => ({ ...p }))
  for (let round = 0; round < rounds; round++) {
    let moved = false
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]
        const b = out[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy)
        const min = a.r + b.r + gap
        if (dist >= min) continue
        moved = true
        // 完全重合时没有方向，往右上分开
        const ux = dist > 0.01 ? dx / dist : 0.7
        const uy = dist > 0.01 ? dy / dist : -0.7
        const push = (min - dist) / 2
        a.x -= ux * push
        a.y -= uy * push
        b.x += ux * push
        b.y += uy * push
      }
    }
    if (!moved) break
  }
  return out
}
