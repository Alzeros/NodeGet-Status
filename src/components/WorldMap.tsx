import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { AlertTriangle } from 'lucide-react'
import { Card } from './ui/card'
import { displayName } from '../utils/derive'
import { useIsDark } from '../hooks/useIsDark'
import type { Node } from '../types'
import type { NodeStatusCategory } from '../utils/stableStatus'
import { computeShowcase, inGeometry, inRing, placeNode, regionLabel, spreadClusters } from '../utils/geoPlace'
import type { GeoLookup, PlaceSource, PlacedNode } from '../utils/geoPlace'
import { CONTINENTS } from '../utils/cities'

/*
 * 打卡地图：表达"我的机器遍布哪里"，是展示，不是排障入口。
 *   - 有机器的国家/地区整块点亮（多边形淡填色 + 点阵换成主题色）
 *   - 城市标记按台数分五档图标：点 → 环 → 双环 → 六边形 → 六边形加环，
 *     一眼分得出"一台"和"一堆"，又不会像一台一颗点那样撑出海岸线
 *   - 左上角打卡标题，右下角几个玩味数字（大洲 / 最北最南 / 时区跨度）
 * 交互只留两个：悬停城市看机器清单，点城市跳到卡片视图按地区筛选。
 * 落点按城市名优先，IP 经纬度只作备选且要过地区校验（见 utils/geoPlace）。
 */

const MAP_W = 900
const MAP_H = 520
const GEO_URL = `${import.meta.env.BASE_URL}world.geo.json`

// 簇与簇之间至少留的空隙（像素）
const CLUSTER_GAP = 6

/** 城市标记的五档：台数下限、图例文案、外接半径（像素，含最外圈环） */
const TIERS = [
  { min: 1, label: '1 台', r: 3 },
  { min: 2, label: '2–3 台', r: 6.5 },
  { min: 4, label: '4–6 台', r: 10 },
  { min: 7, label: '7–9 台', r: 11.5 },
  { min: 10, label: '10 台以上', r: 15.5 },
]

function tierOf(n: number) {
  let t = 0
  for (let i = 0; i < TIERS.length; i++) if (n >= TIERS[i].min) t = i
  return t
}

/** 尖角朝上的正六边形顶点 */
function hexPoints(cx: number, cy: number, r: number): [number, number][] {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (-Math.PI / 2) + (k * Math.PI) / 3
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
}

/** 一档一个图形族，画在簇中心；环和坑都不参与命中，命中区另有透明圆 */
function glyphShapes(x: number, y: number, tier: number, color: string, pit: string, glow: number): any[] {
  const core = (r: number) => ({
    type: 'circle',
    shape: { cx: x, cy: y, r },
    style: { fill: color, shadowBlur: glow, shadowColor: color },
  })
  const ring = (r: number, width = 1.2, opacity = 0.9) => ({
    type: 'circle',
    shape: { cx: x, cy: y, r },
    style: { fill: 'none', stroke: color, lineWidth: width, opacity },
    silent: true,
  })
  const hex = (r: number) => ({
    type: 'polygon',
    shape: { points: hexPoints(x, y, r) },
    style: { fill: color, opacity: 0.95, shadowBlur: glow, shadowColor: color },
  })
  const hole = (r: number) => ({ type: 'circle', shape: { cx: x, cy: y, r }, style: { fill: pit }, silent: true })
  switch (tier) {
    case 0:
      return [core(3)]
    case 1:
      return [core(3), ring(6.5)]
    case 2:
      return [core(3.5), ring(7), ring(10, 1, 0.6)]
    case 3:
      return [hex(8.5), hole(2.6), ring(11.5, 1, 0.7)]
    default:
      return [hex(10), hole(3), ring(13, 1.2, 0.8), ring(15.5, 1, 0.45)]
  }
}
// 悬停清单最多列几台，再多只报数
const TOOLTIP_ROWS = 14

const STATUS_STYLE: Record<NodeStatusCategory, { color: string; label: string }> = {
  normal: { color: '#3ecc79', label: '正常' },
  warning: { color: '#dba54a', label: '注意' },
  risk: { color: '#e06b63', label: '风险' },
  offline: { color: '#94a3b8', label: '离线' },
}
// 状态色在两种底色上都够跳，只有离线的灰要压深一档才压得住浅色地图
const OFFLINE_LIGHT = '#64748b'
// 簇内排序：需要人看的排中间，离线其次，正常的在外圈
const SEVERITY: Record<NodeStatusCategory, number> = { risk: 3, warning: 2, offline: 1, normal: 0 }
const ORDER: NodeStatusCategory[] = ['normal', 'warning', 'risk', 'offline']

interface Palette {
  /** 点阵大陆的点色 */
  dot: string
  glow: number
  labelMuted: string
  labelBorder: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  tooltipMuted: string
}

const PALETTE: Record<'light' | 'dark', Palette> = {
  light: {
    dot: 'rgba(100,116,139,0.34)',
    glow: 8,
    labelMuted: '#5f6b7d',
    labelBorder: 'rgba(255,255,255,0.94)',
    tooltipBg: 'rgba(255,255,255,0.97)',
    tooltipBorder: 'rgba(100,116,139,0.28)',
    tooltipText: '#1e293b',
    tooltipMuted: '#64748b',
  },
  dark: {
    dot: 'rgba(148,163,184,0.30)',
    glow: 14,
    labelMuted: '#aab4c8',
    labelBorder: 'rgba(11,14,20,0.92)',
    tooltipBg: 'rgba(16,20,29,0.94)',
    tooltipBorder: 'rgba(148,163,184,0.3)',
    tooltipText: '#e5e7eb',
    tooltipMuted: '#94a3b8',
  },
}

// ---- 地图数据（模块级，只加载一次）----
const cnameMap = new Map<string, string>()
const centroid = new Map<string, [number, number]>()
const geomsByCode = new Map<string, any[]>()
// 点阵大陆：由 geojson 现场采样生成，带所属地区代码，点亮国家时点也换色
let landDots: { lng: number; lat: number; code: string }[] = []
let mapPromise: Promise<void> | null = null

interface Props {
  nodes: Node[]
  statuses: Map<string, NodeStatusCategory>
  /** 点城市：跳到卡片视图按该地区筛选 */
  onPickRegion?: (region: string) => void
}

interface Member {
  placed: PlacedNode
  status: NodeStatusCategory
}

interface Cluster {
  key: string
  label: string
  lng: number
  lat: number
  region: string | null
  members: Member[]
  counts: Record<NodeStatusCategory, number>
  worst: NodeStatusCategory
  /** 簇里有没有按地区推定 / 按 IP 坐标落点的机器，悬停时说明 */
  sources: Set<PlaceSource>
}

function ringBbox(ring: number[][]) {
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return { minLng, maxLng, minLat, maxLat, w: maxLng - minLng, h: maxLat - minLat }
}

/** 用最大子多边形的包围盒中心近似国家中心，作为按地区推定时的落点 */
function polyCenter(geometry: any): { center: [number, number]; area: number } | null {
  if (!geometry?.coordinates) return null
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]
  let best: ReturnType<typeof ringBbox> | null = null
  let bestArea = -1
  for (const poly of polygons) {
    const outer = poly[0]
    if (!outer) continue
    const bb = ringBbox(outer)
    const area = bb.w * bb.h
    if (area > bestArea) {
      bestArea = area
      best = bb
    }
  }
  if (!best) return null
  return { center: [(best.minLng + best.maxLng) / 2, (best.minLat + best.maxLat) / 2], area: bestArea }
}

interface LandPoly {
  code: string
  rings: number[][][]
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
}

/** 提取所有陆地多边形（含孔洞环），带外环包围盒做快速预筛 */
function prepPolys(geo: any): LandPoly[] {
  const polys: LandPoly[] = []
  for (const f of geo.features ?? []) {
    // 南极洲不进点阵：底部一整条冰盖会把视觉重心拽下去，节点也不会在那
    const code = f.properties?.name
    if (!code || code === 'AQ') continue
    const g = f.geometry
    if (!g?.coordinates) continue
    const list = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []
    for (const rings of list) {
      const outer = rings[0]
      if (!outer?.length) continue
      const bb = ringBbox(outer)
      polys.push({ code, rings, minLng: bb.minLng, maxLng: bb.maxLng, minLat: bb.minLat, maxLat: bb.maxLat })
    }
  }
  return polys
}

/** 经纬网格采样陆地内部的点；奇偶规则天然处理孔洞（里海等） */
function computeLandDots(polys: LandPoly[]) {
  const dots: { lng: number; lat: number; code: string }[] = []
  const STEP = 1.35
  let row = 0
  for (let lat = -55.5; lat <= 83.5; lat += STEP, row++) {
    // 隔行错位半格，比正交网格更接近点阵质感
    const off = row % 2 ? STEP / 2 : 0
    for (let lng = -180 + off; lng <= 180; lng += STEP) {
      for (const p of polys) {
        if (lng < p.minLng || lng > p.maxLng || lat < p.minLat || lat > p.maxLat) continue
        let inside = false
        for (const ring of p.rings) if (inRing(lng, lat, ring)) inside = !inside
        if (inside) {
          dots.push({ lng, lat, code: p.code })
          break
        }
      }
    }
  }
  return dots
}

function ensureMap() {
  if (!mapPromise) {
    mapPromise = fetch(GEO_URL)
      .then(r => r.json())
      .then(geo => {
        // 同一代码可能对应多块（AU = 澳大利亚本土 + 两个海外领地）：多边形全收，中心取最大那块
        const bestArea = new Map<string, number>()
        for (const f of geo.features ?? []) {
          const a2 = f.properties?.name
          if (!a2) continue
          if (f.properties?.cname && !cnameMap.has(a2)) cnameMap.set(a2, f.properties.cname)
          if (f.geometry) (geomsByCode.get(a2) ?? geomsByCode.set(a2, []).get(a2)!).push(f.geometry)
          const c = polyCenter(f.geometry)
          if (c && c.area > (bestArea.get(a2) ?? -1)) {
            bestArea.set(a2, c.area)
            centroid.set(a2, c.center)
          }
        }
        echarts.registerMap('world', geo)
        landDots = computeLandDots(prepPolys(geo))
      })
      .catch(err => {
        mapPromise = null
        throw err
      })
  }
  return mapPromise
}

const geoLookup: GeoLookup = {
  contains(region, lng, lat) {
    const gs = geomsByCode.get(region)
    if (!gs?.length) return null
    return gs.some(g => inGeometry(lng, lat, g))
  },
  center: region => centroid.get(region) ?? null,
  cname: region => cnameMap.get(region),
}

// ---- 主题主色：canvas 读不到 CSS 变量，自己解析 --primary（"211 78% 46%"）----
type Hsl = [number, number, number]

function readPrimary(): Hsl {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
  const m = v.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [211, 78, 50]
}

function hslToRgb([h, s, l]: Hsl): [number, number, number] {
  const sn = s / 100
  const ln = l / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = ln - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function accentColor(hsl: Hsl, alpha: number) {
  const [r, g, b] = hslToRgb(hsl)
  return `rgba(${r},${g},${b},${alpha})`
}

/** 跟着明暗和风格主题一起变：两者都改 <html> 的属性 */
function useAccent(): Hsl {
  const [hsl, setHsl] = useState<Hsl>(readPrimary)
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setHsl(readPrimary()))
    obs.observe(el, { attributes: true, attributeFilter: ['class', 'data-style'] })
    return () => obs.disconnect()
  }, [])
  return hsl
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)
}

function statusColor(s: NodeStatusCategory, isDark: boolean) {
  return s === 'offline' && !isDark ? OFFLINE_LIGHT : STATUS_STYLE[s].color
}

/** 簇的颜色取"需要看一眼"的状态：有风险红、有注意黄、全离线灰，否则绿。个别离线不该把整城涂灰 */
function clusterColor(c: Cluster, isDark: boolean) {
  if (c.counts.risk) return statusColor('risk', isDark)
  if (c.counts.warning) return statusColor('warning', isDark)
  if (c.counts.offline === c.members.length) return statusColor('offline', isDark)
  return statusColor('normal', isDark)
}

/** 图例里的五档图标，和地图上的图形族同构，缩到 18px 盒子里 */
function Glyph({ tier, color, pit }: { tier: number; color: string; pit: string }) {
  const c = 9
  const ring = (r: number, opacity = 0.9, width = 1) => (
    <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={width} opacity={opacity} />
  )
  const hex = (r: number) => (
    <polygon points={hexPoints(c, c, r).map(p => p.join(',')).join(' ')} fill={color} opacity={0.95} />
  )
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden className="shrink-0">
      {tier === 0 && <circle cx={c} cy={c} r={2} fill={color} />}
      {tier === 1 && (
        <>
          <circle cx={c} cy={c} r={1.8} fill={color} />
          {ring(4)}
        </>
      )}
      {tier === 2 && (
        <>
          <circle cx={c} cy={c} r={1.8} fill={color} />
          {ring(3.8)}
          {ring(6, 0.6)}
        </>
      )}
      {tier === 3 && (
        <>
          {hex(5)}
          <circle cx={c} cy={c} r={1.5} fill={pit} />
          {ring(6.8, 0.7)}
        </>
      )}
      {tier === 4 && (
        <>
          {hex(5)}
          <circle cx={c} cy={c} r={1.5} fill={pit} />
          {ring(6.6, 0.8)}
          {ring(8.2, 0.45)}
        </>
      )}
    </svg>
  )
}

export function WorldMap({ nodes, statuses, onPickRegion }: Props) {
  const isDark = useIsDark()
  const accent = useAccent()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  // 窄屏（手机）上名字牌互相压、浮层也没法悬停：只画点，名字和数字挪到地图下面
  const [wrapW, setWrapW] = useState(0)
  const compact = wrapW > 0 && wrapW < 640
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const onPickRef = useRef(onPickRegion)
  useEffect(() => {
    onPickRef.current = onPickRegion
  })

  useEffect(() => {
    let cancelled = false
    ensureMap()
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const { clusters, lit, showcase, unplaced } = useMemo(() => {
    const placed: PlacedNode[] = []
    let unplaced = 0
    if (ready) {
      for (const n of nodes) {
        const p = placeNode(n, geoLookup)
        if (p) placed.push(p)
        else unplaced++
      }
    }
    const groups = new Map<string, Cluster>()
    for (const p of placed) {
      const status = statuses.get(p.node.uuid) ?? 'normal'
      let c = groups.get(p.cityKey)
      if (!c) {
        c = {
          key: p.cityKey,
          label: p.cityLabel,
          lng: p.lng,
          lat: p.lat,
          region: p.region,
          members: [],
          counts: { normal: 0, warning: 0, risk: 0, offline: 0 },
          worst: 'normal',
          sources: new Set(),
        }
        groups.set(p.cityKey, c)
      }
      c.members.push({ placed: p, status })
      c.counts[status]++
      c.sources.add(p.source)
      if (SEVERITY[status] > SEVERITY[c.worst]) c.worst = status
    }
    const clusters = [...groups.values()]
    for (const c of clusters) {
      c.members.sort(
        (a, b) => SEVERITY[b.status] - SEVERITY[a.status] || displayName(a.placed.node).localeCompare(displayName(b.placed.node)),
      )
    }
    const lit = new Set<string>()
    for (const p of placed) if (p.region) lit.add(p.region)
    return { clusters, lit, showcase: computeShowcase(placed), unplaced }
  }, [nodes, statuses, ready])

  // 动态数据每 2 秒刷新一次，但簇的位置/成员/状态通常不变；
  // 用签名把 setOption 限制在真正变化时，避免地图不停重绘
  const dataSig = useMemo(
    () =>
      clusters
        .map(c => `${c.key}|${c.lng.toFixed(2)},${c.lat.toFixed(2)}|${c.members.map(m => m.status[0]).join('')}`)
        .sort()
        .join(';') + `#${[...lit].sort().join(',')}`,
    [clusters, lit],
  )

  const liveRef = useRef<{ clusters: Cluster[]; layout: { key: string; pos: { x: number; y: number; r: number }[] } | null }>({
    clusters,
    layout: null,
  })
  useEffect(() => {
    liveRef.current.clusters = clusters
  })

  const palette = PALETTE[isDark ? 'dark' : 'light']
  const option = useMemo(
    () => buildOption(clusters, lit, liveRef, palette, isDark, accent, `${dataSig}|${compact ? 'c' : 'w'}`, !compact),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataSig, ready, isDark, accent, compact],
  )

  useEffect(() => {
    if (!ready || !wrapRef.current) return
    if (!chartRef.current) {
      const chart = echarts.init(wrapRef.current)
      chart.on('click', (p: any) => {
        if (p.componentType !== 'series') return
        const region = p.data?.region
        if (region) onPickRef.current?.(region)
      })
      chartRef.current = chart
    }
    chartRef.current.setOption(option, false)
  }, [ready, option])

  useEffect(() => {
    if (!ready || !chartRef.current) return
    const ro = new ResizeObserver(entries => {
      chartRef.current?.resize()
      setWrapW(entries[0]?.contentRect.width ?? 0)
    })
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [ready])

  useEffect(() => {
    return () => {
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  const facts = ready ? showcaseFacts(showcase) : []
  const headline = (
    <>
      已点亮 <Num>{showcase.regions}</Num> 个国家/地区 · <Num>{showcase.cities}</Num> 座城市 · <Num>{showcase.machines}</Num> 台
      {unplaced > 0 && <span className="ml-1.5 text-foreground/60">· {unplaced} 台无位置</span>}
    </>
  )
  const legend = (
    <>
      <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span
          className="inline-block h-2.5 w-2.5 rounded-sm border"
          style={{ backgroundColor: accentColor(accent, 0.25), borderColor: accentColor(accent, 0.6) }}
        />
        点亮 = 有机器
      </span>
      {TIERS.map((t, i) => (
        <span key={t.min} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Glyph tier={i} color={statusColor('normal', isDark)} pit={isDark ? '#0b0e14' : '#f4f6f8'} />
          {t.label}
        </span>
      ))}
      <span className="h-3 w-px bg-border/70" aria-hidden />
      {ORDER.map(s => (
        <span key={s} className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor(s, isDark) }} />
          {STATUS_STYLE[s].label}
        </span>
      ))}
    </>
  )

  return (
    <Card className="p-3 sm:p-4">
      <div
        className="relative w-full overflow-hidden rounded-md border border-border/60 bg-[hsl(210_20%_97%)] dark:bg-[#0b0e14]"
        // 满幅后按固定比例会撑出一屏，限高让地图始终一眼看全；
        // geo 自己保持比例，多出来的横向空间留白即可
        style={{ aspectRatio: `${MAP_W} / ${MAP_H}`, maxHeight: 'calc(100vh - 200px)' }}
      >
        {/* 网格 + 晕影底层，纯装饰：撑起"指挥室"的纵深感 */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(${
              isDark ? 'rgba(148,163,184,0.05)' : 'rgba(100,116,139,0.06)'
            } 1px, transparent 1px), linear-gradient(90deg, ${
              isDark ? 'rgba(148,163,184,0.05)' : 'rgba(100,116,139,0.06)'
            } 1px, transparent 1px)`,
            backgroundSize: '44px 44px',
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: isDark
              ? 'radial-gradient(75% 65% at 50% 42%, rgba(59,97,153,0.09), transparent 65%), radial-gradient(120% 100% at 50% 45%, transparent 58%, rgba(0,2,6,0.45) 100%)'
              : 'radial-gradient(120% 100% at 50% 45%, transparent 60%, rgba(15,23,42,0.07) 100%)',
          }}
        />
        <div ref={wrapRef} className="absolute inset-0" />

        {/* 打卡标题（窄屏挪到地图下面） */}
        {ready && !error && !compact && (
          <div className="absolute left-3 top-3 z-10 pointer-events-none rounded-md border border-border/70 bg-card/85 px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm">
            {headline}
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-sm text-foreground/80">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div>地图加载失败</div>
            <div className="text-xs text-muted-foreground break-all">{error.message}</div>
          </div>
        )}

        {!error && ready && clusters.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none">
            没有节点设置过位置或国家代码
          </div>
        )}

        {/* 图例：一颗点 = 一台机器，颜色是状态；点亮的国家用主题色 */}
        {!error && ready && !compact && (
          <div className="absolute bottom-3 left-3 z-10 pointer-events-none flex flex-wrap items-center gap-3 rounded-md border border-border/70 bg-card/85 px-2.5 py-1.5 backdrop-blur-sm">
            {legend}
          </div>
        )}

        {/* 玩味数字：右下角，小字，不抢主体 */}
        {!compact && facts.length > 0 && (
          <div className="absolute bottom-3 right-3 z-10 pointer-events-none flex flex-wrap justify-end gap-1.5">
            {facts.map(f => (
              <Fact key={f.text} {...f} />
            ))}
          </div>
        )}
      </div>

      {/* 窄屏：地图上只有点，名字和数字都在这里 */}
      {ready && !error && compact && (
        <div className="mt-2.5 flex flex-col gap-2">
          <div className="text-[11px] text-muted-foreground">{headline}</div>
          <div className="flex flex-wrap gap-1.5">
            {[...clusters]
              .sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label))
              .map(c => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => c.region && onPickRegion?.(c.region)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-card/85 px-2 py-1 text-[11px] text-foreground/85"
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: clusterColor(c, isDark) }} />
                  {c.label}
                  {c.members.length > 1 && <span className="font-mono tabular-nums text-muted-foreground">×{c.members.length}</span>}
                </button>
              ))}
          </div>
          {facts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {facts.map(f => (
                <Fact key={f.text} {...f} />
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">{legend}</div>
        </div>
      )}
    </Card>
  )
}

function Num({ children }: { children: number }) {
  return <b className="font-mono text-[12px] font-semibold tabular-nums text-foreground">{children}</b>
}

interface FactItem {
  text: string
  title?: string
}

function Fact({ text, title }: FactItem) {
  return (
    <span
      title={title}
      className="inline-flex items-baseline rounded-md border border-border/70 bg-card/85 px-2 py-1 font-mono text-[10px] tabular-nums text-muted-foreground backdrop-blur-sm"
    >
      {text}
    </span>
  )
}

function showcaseFacts(s: ReturnType<typeof computeShowcase>): FactItem[] {
  if (!s.machines) return []
  const facts: FactItem[] = [
    {
      text: `${s.continents.have.length}/${CONTINENTS.length} 大洲`,
      title: s.continents.missing.length ? `还差：${s.continents.missing.join('、')}` : '七大洲里有人住的都到齐了',
    },
  ]
  if (s.north && s.south && s.north.label !== s.south.label) {
    facts.push({ text: `最北 ${s.north.label} ${Math.abs(s.north.lat).toFixed(0)}°${s.north.lat >= 0 ? 'N' : 'S'}` })
    facts.push({ text: `最南 ${s.south.label} ${Math.abs(s.south.lat).toFixed(0)}°${s.south.lat >= 0 ? 'N' : 'S'}` })
  }
  if (s.tzSpan > 0) facts.push({ text: `横跨 ${s.tzSpan} 个时区` })
  return facts
}

function buildOption(
  clusters: Cluster[],
  lit: Set<string>,
  liveRef: { current: { clusters: Cluster[]; layout: { key: string; pos: { x: number; y: number; r: number }[] } | null } },
  palette: Palette,
  isDark: boolean,
  accent: Hsl,
  sig: string,
  showLabels: boolean,
) {
  const litDots: [number, number][] = []
  const dimDots: [number, number][] = []
  for (const d of landDots) (lit.has(d.code) ? litDots : dimDots).push([d.lng, d.lat])

  const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

  // 所有簇一起排版：先把经纬度转成像素，再把挨太近的推开。
  // renderItem 是逐项调用的，排版结果按"尺寸 + 数据签名"缓存，一轮渲染只算一次
  const layout = (api: any) => {
    const key = `${api.getWidth()}x${api.getHeight()}|${sig}`
    const cached = liveRef.current.layout
    if (cached && cached.key === key) return cached.pos
    const items = liveRef.current.clusters.map(c => {
      const [x, y] = api.coord([c.lng, c.lat]) as [number, number]
      return { x, y, r: TIERS[tierOf(c.members.length)].r + 2 }
    })
    const pos = spreadClusters(items, CLUSTER_GAP)
    liveRef.current.layout = { key, pos }
    return pos
  }

  const clusterSeries = {
    type: 'custom' as const,
    coordinateSystem: 'geo' as const,
    zlevel: 3,
    data: clusters.map(c => ({ key: c.key, region: c.region, value: [c.lng, c.lat] })),
    renderItem: (params: any, api: any) => {
      const c = liveRef.current.clusters[params.dataIndex]
      if (!c) return null
      const pos = layout(api)
      const p = pos[params.dataIndex]
      const [ax, ay] = api.coord([c.lng, c.lat]) as [number, number]
      const children: any[] = []

      // 整簇一个命中区（近乎透明的圆），鼠标落在点与点的缝里浮层也不闪；画在最底下
      children.push({
        type: 'circle',
        shape: { cx: p.x, cy: p.y, r: p.r + 5 },
        style: { fill: 'rgba(0,0,0,0.01)' },
      })

      // 被推开的簇：留一根细线指回真实位置
      if (Math.hypot(p.x - ax, p.y - ay) > 3) {
        children.push({
          type: 'line',
          shape: { x1: ax, y1: ay, x2: p.x, y2: p.y },
          style: { stroke: accentColor(accent, 0.55), lineWidth: 1 },
          silent: true,
        })
        children.push({
          type: 'circle',
          shape: { cx: ax, cy: ay, r: 1.6 },
          style: { fill: accentColor(accent, 0.8) },
          silent: true,
        })
      }
      // 有异常机器的簇外面套一圈状态色光环
      if (c.worst === 'warning' || c.worst === 'risk') {
        const color = statusColor(c.worst, isDark)
        children.push({
          type: 'circle',
          shape: { cx: p.x, cy: p.y, r: p.r + 4 },
          style: { fill: 'transparent', stroke: color, lineWidth: 1, shadowBlur: palette.glow, shadowColor: color },
          silent: true,
        })
      }
      const color = clusterColor(c, isDark)
      const allOffline = c.counts.offline === c.members.length
      children.push(
        ...glyphShapes(p.x, p.y, tierOf(c.members.length), color, isDark ? '#0b0e14' : '#f4f6f8', allOffline ? 0 : palette.glow * 0.7),
      )
      // 名字牌：正常压灰，有异常用状态色；描边压住底下的点阵
      const abnormal = c.worst === 'warning' || c.worst === 'risk'
      const n = c.members.length
      if (showLabels) children.push({
        type: 'text',
        style: {
          x: p.x + p.r + 6,
          y: p.y,
          text: n > 1 ? `${c.label} ×${n}` : c.label,
          font: `${abnormal ? 600 : 500} 10px ${mono}`,
          textAlign: 'left',
          textVerticalAlign: 'middle',
          fill: abnormal ? statusColor(c.worst, isDark) : palette.labelMuted,
          stroke: palette.labelBorder,
          lineWidth: 2,
        },
        silent: true,
      })
      return { type: 'group', children }
    },
  }

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: palette.tooltipBg,
      borderColor: palette.tooltipBorder,
      borderWidth: 1,
      padding: [8, 10] as [number, number],
      textStyle: { color: palette.tooltipText, fontSize: 12 },
      formatter: (p: any) => {
        const c = liveRef.current.clusters.find(x => x.key === p.data?.key)
        if (!c) return ''
        const muted = `color:${palette.tooltipMuted}`
        const where = c.region ? regionLabel(c.region, geoLookup) : ''
        const head = `<b>${escapeHtml(c.label)}</b> <span style="${muted}">${where && where !== c.label ? `${escapeHtml(where)} · ` : ''}${c.members.length} 台${c.counts.offline ? ` · ${c.counts.offline} 离线` : ''}</span>`
        const rows = c.members.slice(0, TOOLTIP_ROWS).map(m => {
          const color = statusColor(m.status, isDark)
          // 名字里和簇同名的城市前缀（"东京-Gomami" 在东京的清单里）是废话，去掉
          const full = displayName(m.placed.node)
          const name = full.startsWith(`${c.label}-`) ? full.slice(c.label.length + 1) : full
          return `<div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="display:inline-block;width:6px;height:6px;border-radius:9999px;background:${color};box-shadow:0 0 6px ${color}"></span><span>${escapeHtml(name)}</span><span style="${muted};margin-left:auto;padding-left:12px;font-size:11px">${STATUS_STYLE[m.status].label}</span></div>`
        })
        const more = c.members.length > TOOLTIP_ROWS ? `<div style="${muted};margin-top:3px;font-size:11px">…还有 ${c.members.length - TOOLTIP_ROWS} 台</div>` : ''
        const notes: string[] = []
        if (c.sources.has('region')) notes.push('部分机器位置按地区推定')
        else if (c.sources.has('coords')) notes.push('位置按 IP 坐标')
        const foot = `<div style="${muted};margin-top:6px;font-size:10px">${notes.length ? `${notes.join(' · ')} · ` : ''}点击只看这个地区</div>`
        return `${head}<div style="margin-top:4px">${rows.join('')}</div>${more}${foot}`
      },
    },
    geo: {
      map: 'world',
      roam: false,
      silent: true,
      zoom: 1,
      // 裁掉南极洲（点阵也没生成它），大陆能占满更多画面
      boundingCoords: [
        [-180, 86],
        [180, -57],
      ] as [number, number][],
      left: 8,
      right: 8,
      top: 16,
      bottom: 16,
      // 大陆交给点阵画，多边形平时透明；点亮的国家淡填一层主题色，边线稍亮
      itemStyle: { areaColor: 'transparent', borderColor: 'transparent' },
      emphasis: { disabled: true },
      regions: [...lit].map(code => ({
        name: code,
        itemStyle: {
          areaColor: accentColor(accent, isDark ? 0.14 : 0.1),
          borderColor: accentColor(accent, isDark ? 0.5 : 0.4),
          borderWidth: 0.8,
        },
      })),
    },
    series: [
      {
        type: 'scatter' as const,
        coordinateSystem: 'geo' as const,
        zlevel: 1,
        silent: true,
        large: true,
        largeThreshold: 500,
        symbolSize: 2.1,
        itemStyle: { color: palette.dot },
        data: dimDots,
      },
      {
        type: 'scatter' as const,
        coordinateSystem: 'geo' as const,
        zlevel: 2,
        silent: true,
        large: true,
        largeThreshold: 500,
        symbolSize: 2.4,
        itemStyle: { color: accentColor(accent, isDark ? 0.85 : 0.75) },
        data: litDots,
      },
      clusterSeries,
    ],
  }
}
