import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as echarts from 'echarts'
import { AlertTriangle, ArrowLeft, ArrowRight, X } from 'lucide-react'
import { Card } from './ui/card'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { bytes, pct, uptime as fmtUptime } from '../utils/format'
import { deriveUsage, displayName } from '../utils/derive'
import { avgLatency, type LatencyTracks } from '../utils/latency'
import { cn, loadColor } from '../utils/cn'
import { useIsDark } from '../hooks/useIsDark'
import type { Node } from '../types'
import type { NodeStatusCategory } from '../utils/stableStatus'

const MAP_W = 900
const MAP_H = 520
const GEO_URL = `${import.meta.env.BASE_URL}world.geo.json`

// 同一格内的节点合并为一个聚合气泡：世界地图铺满 900px 时约 0.4°/px，
// 3° 对应约 8px，正好是"看上去叠在一起"的距离
const CLUSTER_GRID = 3

const STATUS_STYLE: Record<NodeStatusCategory, { color: string; period: number; label: string }> = {
  normal: { color: '#3ecc79', period: 4, label: '正常' },
  warning: { color: '#dba54a', period: 2, label: '注意' },
  risk: { color: '#e06b63', period: 1.2, label: '风险' },
  offline: { color: '#94a3b8', period: 0, label: '离线' },
}

// 状态色在两种底色上都够跳，只有离线的灰要压深一档才压得住浅色地图
const OFFLINE_LIGHT = '#64748b'

interface Palette {
  land: string
  landActive: string
  border: string
  glow: number
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
}

const PALETTE: Record<'light' | 'dark', Palette> = {
  light: {
    land: 'rgba(148,163,184,0.26)',
    landActive: 'rgba(100,116,139,0.40)',
    border: 'rgba(100,116,139,0.40)',
    glow: 6,
    tooltipBg: 'rgba(255,255,255,0.97)',
    tooltipBorder: 'rgba(100,116,139,0.28)',
    tooltipText: '#1e293b',
  },
  dark: {
    land: 'rgba(148,163,184,0.10)',
    landActive: 'rgba(148,163,184,0.22)',
    border: 'rgba(148,163,184,0.22)',
    glow: 10,
    tooltipBg: 'rgba(16,20,29,0.94)',
    tooltipBorder: 'rgba(148,163,184,0.3)',
    tooltipText: '#e5e7eb',
  },
}

// 聚合气泡取成员里最严重的状态着色：告警类优先于离线，
// 因为它们需要人去处理；具体构成由气泡上的数字与抽屉给出
const SEVERITY: Record<NodeStatusCategory, number> = { normal: 0, offline: 1, warning: 2, risk: 3 }

const ORDER: NodeStatusCategory[] = ['normal', 'warning', 'risk', 'offline']

const cnameMap = new Map<string, string>()
const centroid = new Map<string, [number, number]>()
let mapPromise: Promise<void> | null = null

interface Props {
  nodes: Node[]
  statuses: Map<string, NodeStatusCategory>
  latencyTracks: Map<string, LatencyTracks>
  onOpen?: (uuid: string) => void
}

interface Cluster {
  key: string
  lng: number
  lat: number
  nodes: Node[]
  status: NodeStatusCategory
  counts: Record<NodeStatusCategory, number>
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

/** 用最大子多边形的包围盒中心近似国家质心，作为缺少经纬度时的落点 */
function polyCenter(geometry: any): [number, number] | null {
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
  return [(best.minLng + best.maxLng) / 2, (best.minLat + best.maxLat) / 2]
}

function ensureMap() {
  if (!mapPromise) {
    mapPromise = fetch(GEO_URL)
      .then(r => r.json())
      .then(geo => {
        for (const f of geo.features ?? []) {
          const a2 = f.properties?.name
          if (!a2) continue
          if (f.properties?.cname) cnameMap.set(a2, f.properties.cname)
          const c = polyCenter(f.geometry)
          if (c) centroid.set(a2, c)
        }
        echarts.registerMap('world', geo)
      })
      .catch(err => {
        mapPromise = null
        throw err
      })
  }
  return mapPromise
}

function regionOf(n: Node) {
  const a2 = n.meta?.region?.trim().toUpperCase()
  return a2 && /^[A-Z]{2}$/.test(a2) ? a2 : null
}

/** 优先用节点自报的经纬度，缺失时退到国家质心 */
function positionOf(n: Node): [number, number] | null {
  const { lat, lng } = n.meta ?? {}
  if (typeof lat === 'number' && typeof lng === 'number' && (lat !== 0 || lng !== 0)) {
    return [lng, lat]
  }
  const a2 = regionOf(n)
  return a2 ? centroid.get(a2) ?? null : null
}

function clusterLabel(c: Cluster) {
  if (c.nodes.length === 1) return displayName(c.nodes[0])
  const regions = new Set(c.nodes.map(regionOf).filter(Boolean) as string[])
  if (regions.size === 1) {
    const a2 = [...regions][0]
    return cnameMap.get(a2) || a2
  }
  return `${c.nodes.length} 台节点`
}

export function WorldMap({ nodes, statuses, latencyTracks, onOpen }: Props) {
  const isDark = useIsDark()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [drillUuid, setDrillUuid] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

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

  const { clusters, unplaced, totals } = useMemo(() => {
    const groups = new Map<string, { sumLng: number; sumLat: number; nodes: Node[] }>()
    const totals: Record<NodeStatusCategory, number> = { normal: 0, warning: 0, risk: 0, offline: 0 }
    let unplaced = 0

    for (const n of nodes) {
      totals[statuses.get(n.uuid) ?? 'normal']++
      const pos = ready ? positionOf(n) : null
      if (!pos) {
        if (ready) unplaced++
        continue
      }
      const key = `${Math.round(pos[0] / CLUSTER_GRID)}:${Math.round(pos[1] / CLUSTER_GRID)}`
      const g = groups.get(key) ?? { sumLng: 0, sumLat: 0, nodes: [] }
      g.sumLng += pos[0]
      g.sumLat += pos[1]
      g.nodes.push(n)
      groups.set(key, g)
    }

    const clusters: Cluster[] = [...groups.entries()].map(([key, g]) => {
      const counts: Record<NodeStatusCategory, number> = { normal: 0, warning: 0, risk: 0, offline: 0 }
      let status: NodeStatusCategory = 'normal'
      for (const n of g.nodes) {
        const s = statuses.get(n.uuid) ?? 'normal'
        counts[s]++
        if (SEVERITY[s] > SEVERITY[status]) status = s
      }
      return {
        key,
        lng: g.sumLng / g.nodes.length,
        lat: g.sumLat / g.nodes.length,
        nodes: g.nodes,
        status,
        counts,
      }
    })

    return { clusters, unplaced, totals }
  }, [nodes, statuses, ready])

  const clusterMap = useMemo(() => new Map(clusters.map(c => [c.key, c])), [clusters])

  // 动态数据每 2 秒刷新一次，但气泡的位置/状态/成员通常不变；
  // 用签名把 setOption 限制在真正变化时，避免地图不停重绘
  const dataSig = useMemo(
    () =>
      clusters
        .map(c => `${c.key}|${c.status}|${c.nodes.length}`)
        .sort()
        .join(','),
    [clusters],
  )

  const liveRef = useRef({ clusterMap })
  useEffect(() => {
    liveRef.current = { clusterMap }
  })

  const option = useMemo(
    () => buildOption(clusters, liveRef, PALETTE[isDark ? 'dark' : 'light'], isDark),
    [dataSig, ready, isDark],
  )

  useEffect(() => {
    if (!ready || !wrapRef.current) return
    if (!chartRef.current) {
      const chart = echarts.init(wrapRef.current)
      chart.on('click', (p: any) => {
        if (p.componentType !== 'series') return
        const key = p.data?.key
        if (!key) return
        setSelectedKey(key)
        setDrillUuid(null)
      })
      // 点空白处收起抽屉
      chart.getZr().on('click', (ev: any) => {
        if (!ev.target) {
          setSelectedKey(null)
          setDrillUuid(null)
        }
      })
      chartRef.current = chart
    }
    chartRef.current.setOption(option, false)
  }, [ready, option])

  useEffect(() => {
    if (!ready || !chartRef.current) return
    const ro = new ResizeObserver(() => chartRef.current?.resize())
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [ready])

  useEffect(() => {
    return () => {
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  const selected = selectedKey ? clusterMap.get(selectedKey) ?? null : null
  const drillNode =
    selected && drillUuid ? selected.nodes.find(n => n.uuid === drillUuid) ?? null : null
  const paneNode = drillNode ?? (selected && selected.nodes.length === 1 ? selected.nodes[0] : null)
  const online = totals.normal + totals.warning + totals.risk
  const totalCount = online + totals.offline

  return (
    <Card className="p-3 sm:p-4">
      <div
        className="relative w-full overflow-hidden rounded-md border border-border/60 bg-[hsl(210_20%_97%)] dark:bg-[hsl(220_15%_8%)]"
        // 满幅后按固定比例会撑出一屏，限高让地图始终一眼看全；
        // geo 自己保持比例，多出来的横向空间留白即可
        style={{ aspectRatio: `${MAP_W} / ${MAP_H}`, maxHeight: 'calc(100vh - 200px)' }}
      >
        <div ref={wrapRef} className="absolute inset-0" />

        {/* 聚合条 */}
        <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5 pointer-events-none">
          <Chip label="在线">
            <span className="text-emerald-500">{online}</span>
            <span className="text-muted-foreground/70">/{totalCount}</span>
          </Chip>
          {totals.warning > 0 && (
            <Chip label="注意">
              <span className="text-amber-500">{totals.warning}</span>
            </Chip>
          )}
          {totals.risk > 0 && (
            <Chip label="风险">
              <span className="text-rose-500">{totals.risk}</span>
            </Chip>
          )}
          {totals.offline > 0 && (
            <Chip label="离线">
              <span className="text-foreground/80">{totals.offline}</span>
            </Chip>
          )}
          {unplaced > 0 && (
            <Chip label="无位置">
              <span className="text-foreground/80">{unplaced}</span>
            </Chip>
          )}
        </div>

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

        {selected && (
          <Drawer
            cluster={selected}
            node={paneNode}
            latencyTracks={latencyTracks}
            statuses={statuses}
            onBack={() => setDrillUuid(null)}
            onPick={setDrillUuid}
            onOpen={onOpen}
            onClose={() => {
              setSelectedKey(null)
              setDrillUuid(null)
            }}
          />
        )}
      </div>
    </Card>
  )
}

function Chip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-md border border-border/70 bg-card/85 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur-sm">
      {label}
      <b className="font-mono text-[12px] font-semibold tabular-nums">{children}</b>
    </span>
  )
}

function buildOption(
  clusters: Cluster[],
  liveRef: { current: { clusterMap: Map<string, Cluster> } },
  palette: Palette,
  isDark: boolean,
) {
  const activeRegions = new Set<string>()
  for (const c of clusters) {
    for (const n of c.nodes) {
      const a2 = regionOf(n)
      if (a2) activeRegions.add(a2)
    }
  }

  const series = ORDER.map(status => {
    const items = clusters
      .filter(c => c.status === status)
      .map(c => {
        const n = c.nodes.length
        return {
          name: clusterLabel(c),
          key: c.key,
          value: [c.lng, c.lat, n],
          symbolSize: n > 1 ? Math.min(28, 9 + Math.log2(n) * 4.5) : 9,
          label:
            n > 1
              ? {
                  show: true,
                  formatter: String(n),
                  position: 'inside' as const,
                  fontSize: 10,
                  fontWeight: 600 as const,
                  color: status === 'offline' ? 'rgba(255,255,255,0.9)' : '#0b0e14',
                }
              : { show: false },
        }
      })

    const style = STATUS_STYLE[status]
    const color = status === 'offline' && !isDark ? OFFLINE_LIGHT : style.color
    return {
      // 离线是"已经停了"，不该持续脉冲吸引注意力
      type: (status === 'offline' ? 'scatter' : 'effectScatter') as 'scatter' | 'effectScatter',
      coordinateSystem: 'geo' as const,
      zlevel: status === 'normal' ? 1 : 2,
      rippleEffect: { period: style.period, scale: 3, brushType: 'stroke' as const },
      itemStyle: {
        color,
        shadowBlur: palette.glow,
        shadowColor: color,
        opacity: status === 'offline' ? 0.8 : 1,
      },
      emphasis: { scale: 1.25 },
      data: items,
    }
  }).filter(s => s.data.length > 0)

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: palette.tooltipBg,
      borderColor: palette.tooltipBorder,
      borderWidth: 1,
      padding: [6, 10] as [number, number],
      textStyle: { color: palette.tooltipText, fontSize: 12 },
      formatter: (p: any) => {
        const c = liveRef.current.clusterMap.get(p.data?.key)
        if (!c) return ''
        const head = `<b>${clusterLabel(c)}</b>`
        if (c.nodes.length === 1) {
          return `${head}<br/><span style="color:#94a3b8">${STATUS_STYLE[c.status].label}</span>`
        }
        const parts = ORDER.filter(s => c.counts[s] > 0).map(s => {
          const tone = s === 'offline' && !isDark ? OFFLINE_LIGHT : STATUS_STYLE[s].color
          return `<span style="color:${tone}">${c.counts[s]} ${STATUS_STYLE[s].label}</span>`
        })
        return `${head}<br/>${c.nodes.length} 台 · ${parts.join(' · ')}`
      },
    },
    geo: {
      map: 'world',
      roam: false,
      silent: true,
      zoom: 1.15,
      layoutCenter: ['50%', '50%'] as [string, string],
      layoutSize: '100%',
      itemStyle: {
        areaColor: palette.land,
        borderColor: palette.border,
        borderWidth: 0.4,
      },
      // 有节点的国家底色略重，给亮点一点地理上下文
      regions: [...activeRegions].map(name => ({
        name,
        itemStyle: { areaColor: palette.landActive },
      })),
    },
    series,
  }
}

function Drawer({
  cluster,
  node,
  latencyTracks,
  statuses,
  onBack,
  onPick,
  onOpen,
  onClose,
}: {
  cluster: Cluster
  node: Node | null
  latencyTracks: Map<string, LatencyTracks>
  statuses: Map<string, NodeStatusCategory>
  onBack: () => void
  onPick: (uuid: string) => void
  onOpen?: (uuid: string) => void
  onClose: () => void
}) {
  const isList = !node
  const canBack = node != null && cluster.nodes.length > 1

  return (
    <div
      className="absolute right-3 top-3 bottom-3 z-20 flex w-60 flex-col rounded-xl border border-border bg-popover/95 text-muted-foreground shadow-xl backdrop-blur-sm animate-in fade-in-0 slide-in-from-right-2 duration-150"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        {canBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="返回列表"
            className="-ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        )}
        {node ? (
          <StatusDot online={node.online} status={statuses.get(node.uuid)} />
        ) : (
          <Flag code={regionOf(cluster.nodes[0]) ?? undefined} className="shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight text-foreground">
            {node ? displayName(node) : clusterLabel(cluster)}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {node
              ? STATUS_STYLE[statuses.get(node.uuid) ?? 'normal'].label
              : `${cluster.nodes.length} 台节点`}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {isList ? (
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {cluster.nodes.map(n => {
            const u = deriveUsage(n)
            return (
              <button
                key={n.uuid}
                type="button"
                onClick={() => onPick(n.uuid)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-accent"
              >
                <StatusDot online={n.online} status={statuses.get(n.uuid)} />
                <span className="min-w-0 flex-1 truncate text-foreground/90">{displayName(n)}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {n.online ? pct(u.cpu) : '离线'}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <NodePane node={node} tracks={latencyTracks.get(node.uuid)} onOpen={onOpen} />
      )}
    </div>
  )
}

function NodePane({
  node,
  tracks,
  onOpen,
}: {
  node: Node
  tracks?: LatencyTracks
  onOpen?: (uuid: string) => void
}) {
  const u = deriveUsage(node)
  const latency = avgLatency(tracks)
  const traffic = node.monthlyTraffic
  const trafficTotal = (traffic?.received ?? 0) + (traffic?.transmitted ?? 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-3 py-3">
      <Metric label="CPU" value={u.cpu} />
      <Metric label="内存" value={u.mem} detail={u.memTotal ? `${bytes(u.memUsed)} / ${bytes(u.memTotal)}` : undefined} />
      <Metric label="磁盘" value={u.disk} detail={u.diskTotal ? `${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}` : undefined} />
      <Metric
        label="周期流量"
        value={traffic?.percent}
        detail={traffic ? (traffic.limit ? `${bytes(trafficTotal)} / ${bytes(traffic.limit)}` : bytes(trafficTotal)) : '等待采样'}
      />

      <dl className="mt-1 space-y-1.5 border-t border-border pt-2.5 font-mono text-[11px]">
        <Row k="实时" v={`↓ ${bytes(u.netIn || 0)}/s  ↑ ${bytes(u.netOut || 0)}/s`} />
        <Row k="延迟" v={latency != null ? `${latency.toFixed(0)} ms` : '—'} />
        <Row k="运行" v={fmtUptime(u.uptime)} />
      </dl>

      {onOpen && (
        <button
          type="button"
          onClick={() => onOpen(node.uuid)}
          className="mt-auto inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] text-primary transition-colors hover:bg-accent"
        >
          查看完整详情
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

function Metric({ label, value, detail }: { label: string; value?: number; detail?: string }) {
  const v = Number.isFinite(value) ? (value as number) : null
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums text-foreground">{pct(value)}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', loadColor(value))}
          style={{ width: `${Math.min(100, Math.max(0, v ?? 0))}%` }}
        />
      </div>
      {detail && (
        <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/80">{detail}</div>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate text-foreground/90">{v}</dd>
    </div>
  )
}
