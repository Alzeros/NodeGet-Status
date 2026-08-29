import { useMemo, type ReactNode } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, Info } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge } from './ui/badge'
import { Progress } from './ui/progress'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { DistroLogo } from './DistroLogo'
import { UptimeBar } from './UptimeBar'
import { bytes, pct, relativeAge, uptime } from '../utils/format'
import { cpuLabel, deriveUsage, displayName, osLabel, virtLabel } from '../utils/derive'
import { hasCost, remainingDays } from '../utils/cost'
import { cn, loadColor } from '../utils/cn'
import { getStatusReasons } from '../utils/stableStatus'
import type { AbnormalCounters, NodeStatusCategory } from '../utils/stableStatus'
import type { IspKey, LatencyTrack, LatencyTracks } from '../utils/latency'
import type { Node } from '../types'

export interface ConsolePaneProps {
  node: Node
  latencyTracks?: LatencyTracks
  status?: NodeStatusCategory
  counters?: AbnormalCounters
  showSource?: boolean
  /** 跳转整页详情：Ping/TCP 明细、系统信息、费用等长尾内容都在那边 */
  onOpenFull: () => void
}

const ISP_ORDER: IspKey[] = ['cm', 'cu', 'ct']
const ISP_FALLBACK: Record<IspKey, string> = { cm: '移动', cu: '联通', ct: '电信' }
const EMPTY_BLOCKS = Array.from({ length: 24 }, () => null)

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 6,
  fontSize: 11,
}

/** 数值配色与进度条同阈值：颜色永远和数字一起出现，色觉障碍下也能读 */
function valueColor(v?: number | null) {
  if (v == null || !Number.isFinite(v)) return 'text-muted-foreground'
  if (v >= 90) return 'text-rose-500'
  if (v >= 70) return 'text-amber-500'
  return ''
}

function trackAvg(track?: LatencyTrack) {
  if (!track) return null
  let sum = 0
  let n = 0
  for (const b of track.blocks) {
    if (b && b.status !== 'empty' && b.avg != null && b.avg > 0) {
      sum += b.avg
      n++
    }
  }
  return n ? sum / n : null
}

function hhmm(t: number) {
  return new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function ConsolePane({
  node,
  latencyTracks,
  status,
  counters,
  showSource,
  onOpenFull,
}: ConsolePaneProps) {
  const u = deriveUsage(node)
  const d = node.dynamic
  const virt = virtLabel(node)
  const os = osLabel(node)
  const arch = node.static?.system?.arch || node.static?.system?.cpu_arch
  const tags = node.meta?.tags ?? []
  const reasonBadges =
    status === 'warning' || status === 'risk' ? getStatusReasons(node, counters) : []

  // 24h 折线直接由已在内存里的三网块条聚合而来 —— 切换节点零请求，右栏即时出图
  const { series, hasTracks } = useMemo(() => {
    const tracks = ISP_ORDER.map(k => latencyTracks?.[k]).filter(Boolean) as LatencyTrack[]
    const points: { t: number; avg: number | null }[] = []
    if (!tracks.length) return { series: points, hasTracks: false }

    const len = Math.max(...tracks.map(t => t.blocks.length))
    for (let i = 0; i < len; i++) {
      let sum = 0
      let n = 0
      let t = 0
      for (const track of tracks) {
        const b = track.blocks[i]
        if (!b) continue
        if (!t) t = b.t
        if (b.status !== 'empty' && b.avg != null && b.avg > 0) {
          sum += b.avg
          n++
        }
      }
      if (t) points.push({ t, avg: n ? sum / n : null })
    }
    return { series: points, hasTracks: true }
  }, [latencyTracks])

  const valued = series.filter(p => p.avg != null)
  const latestLatency = valued.at(-1)?.avg ?? null
  const meanLatency = valued.length
    ? valued.reduce((s, p) => s + (p.avg as number), 0) / valued.length
    : null

  // 稳定节点 24h 的波动只有零点几毫秒：给一个 2ms 的最小半径，
  // 既不把抖动放大成过山车，也不让线贴在坐标轴底上
  let yDomain: [number, number] | undefined
  if (valued.length > 1) {
    const vals = valued.map(p => p.avg as number)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const mid = (min + max) / 2
    const half = Math.max(((max - min) / 2) * 1.15, 2)
    yDomain = [Math.max(0, Math.floor(mid - half)), Math.ceil(mid + half)]
  }

  const mt = node.monthlyTraffic
  const trafficDetail = mt
    ? mt.limit
      ? `${bytes(mt.total)} / ${bytes(mt.limit)}`
      : `↓ ${bytes(mt.received)} · ↑ ${bytes(mt.transmitted)}`
    : '等待定时采样'

  const swap =
    d?.total_swap && d.used_swap != null ? `${bytes(d.used_swap)} / ${bytes(d.total_swap)}` : null
  const loadAvg =
    d?.load_one != null && d?.load_five != null && d?.load_fifteen != null
      ? `${d.load_one.toFixed(2)} / ${d.load_five.toFixed(2)} / ${d.load_fifteen.toFixed(2)}`
      : null
  const days = hasCost(node.meta) ? remainingDays(node.meta.expireTime) : null

  return (
    <div className="rounded-2xl bg-card text-card-foreground card-soft hover:translate-y-0 p-4 sm:p-5 flex flex-col gap-4">
      {/* 头部：身份 + 一行说明性 chip，避免整页详情那样的大块信息表 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot online={node.online} status={status} />
          <DistroLogo node={node} className="w-5 h-5 shrink-0 object-contain" />
          <h2 className="text-lg font-semibold truncate min-w-0" title={displayName(node)}>
            {displayName(node)}
          </h2>
          <Flag code={node.meta?.region} className="shrink-0" />
          {reasonBadges.length > 0 && (
            <div className="flex flex-wrap gap-1 shrink-0">
              {reasonBadges.map(r => (
                <Badge
                  key={r.key}
                  variant="outline"
                  className={cn(
                    'text-[10px] font-medium px-1.5 py-0',
                    status === 'risk'
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
                  )}
                >
                  {r.display}
                </Badge>
              ))}
            </div>
          )}
          {tags.length > 0 && (
            <div className="ml-auto hidden sm:flex flex-wrap gap-1 shrink-0">
              {tags.map(t => (
                <Badge key={t} variant="outline" className="text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {os && <Chip title={os}>{os}</Chip>}
          {virt && <Chip>{virt}</Chip>}
          {arch && <Chip>{arch}</Chip>}
          {node.online ? (
            <Chip>运行 {uptime(u.uptime)}</Chip>
          ) : (
            <Chip className="border-rose-500/30 text-rose-500">离线 · {relativeAge(u.ts)}</Chip>
          )}
          {days != null && (
            <Chip className={cn(days <= 7 ? 'border-rose-500/30 text-rose-500' : days <= 30 ? 'border-amber-500/30 text-amber-500' : undefined)}>
              {days < 0 ? `已过期 ${Math.abs(days)} 天` : `剩余 ${days} 天`}
            </Chip>
          )}
          {showSource && node.source && <Chip>{node.source}</Chip>}
        </div>
      </div>

      {/* 四个数值块：大字 + 细条，一眼定位问题在哪一项 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="CPU" value={pct(u.cpu)} percent={u.cpu} detail={cpuLabel(node)} />
        <Stat
          label="内存"
          value={pct(u.mem)}
          percent={u.mem}
          detail={u.memTotal ? `${bytes(u.memUsed)} / ${bytes(u.memTotal)}` : null}
        />
        <Stat
          label="磁盘"
          value={pct(u.disk)}
          percent={u.disk}
          detail={u.diskTotal ? `${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}` : null}
        />
        <Stat
          label="周期流量"
          value={mt?.percent != null ? pct(mt.percent) : mt ? bytes(mt.total) : '—'}
          percent={mt?.percent}
          detail={trafficDetail}
        />
      </div>

      {/* 延迟趋势与三网块条并排：一个看走势，一个看是哪家网络 */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-3">
        <Panel
          label="24h 平均延迟"
          extra={
            latestLatency != null ? (
              <span className="font-mono tabular-nums">
                当前 {latestLatency.toFixed(0)}ms
                {meanLatency != null && (
                  <span className="text-muted-foreground/70"> · 均值 {meanLatency.toFixed(0)}ms</span>
                )}
              </span>
            ) : null
          }
        >
          <div className="h-[168px] -ml-2">
            {valued.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="console-latency" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--muted-foreground) / 0.15)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="t"
                    interval={5}
                    tickFormatter={hhmm}
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    width={52}
                    // 稳定节点的 24h 均值几乎是条直线，放任自动刻度会切出 161.25ms 这种带小数的标签
                    allowDecimals={false}
                    tickFormatter={v => `${v}ms`}
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    stroke="hsl(var(--muted-foreground))"
                    domain={yDomain ?? ['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelFormatter={t => `${hhmm(Number(t))} 起 1 小时`}
                    formatter={(v: number) => [`${v.toFixed(1)} ms`, '三网平均']}
                  />
                  <Area
                    type="monotone"
                    dataKey="avg"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#console-latency)"
                    connectNulls
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Placeholder>{hasTracks ? '延迟数据不足' : '此服务器未开启 ICMP ping 监控'}</Placeholder>
            )}
          </div>
        </Panel>

        <Panel label="三网可用性 · 24h">
          {hasTracks ? (
            <div className="flex flex-col gap-2">
              {ISP_ORDER.map(key => {
                const track = latencyTracks?.[key]
                const avg = trackAvg(track)
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-[11px] text-muted-foreground">
                      {track?.label ?? ISP_FALLBACK[key]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <UptimeBar
                        blocks={track?.blocks ?? EMPTY_BLOCKS}
                        ispLabel={track?.label}
                        barHeight={12}
                        mode="latency"
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                      {avg != null ? `${avg.toFixed(0)}ms` : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="h-[60px]">
              <Placeholder>此服务器未开启 ICMP ping 监控</Placeholder>
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-dashed border-border/60">
            <div className="text-[11px] text-muted-foreground">实时带宽</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm tabular-nums">
              <span className="inline-flex items-center gap-1 text-blue-500">
                <ArrowDown className="h-3.5 w-3.5" />
                {bytes(u.netIn || 0)}/s
              </span>
              <span className="inline-flex items-center gap-1 text-emerald-500">
                <ArrowUp className="h-3.5 w-3.5" />
                {bytes(u.netOut || 0)}/s
              </span>
            </div>
          </div>
        </Panel>
      </div>

      {/* 长尾数值压成一条，不再是整页详情里的两列信息表 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-dashed border-border/60 pt-3">
        <Meta k="负载" v={loadAvg} />
        <Meta k="Swap" v={swap} />
        <Meta k="进程" v={d?.process_count} />
        <Meta
          k="TCP/UDP"
          v={
            d?.tcp_connections != null || d?.udp_connections != null
              ? `${d?.tcp_connections ?? '—'} / ${d?.udp_connections ?? '—'}`
              : null
          }
        />
        <Meta
          k="磁盘读写"
          v={
            d?.read_speed != null || d?.write_speed != null
              ? `${bytes(d?.read_speed)}/s · ${bytes(d?.write_speed)}/s`
              : null
          }
        />
        <Meta
          k="累计"
          v={
            d?.total_received != null
              ? `↓ ${bytes(d.total_received)} ↑ ${bytes(d.total_transmitted)}`
              : null
          }
        />
        <Meta k="更新" v={relativeAge(u.ts)} />
        <button
          type="button"
          onClick={onOpenFull}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-primary transition-colors hover:bg-accent"
        >
          查看完整详情
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

function Chip({
  children,
  className,
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'max-w-[220px] truncate rounded-md border border-border/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}

function Stat({
  label,
  value,
  percent,
  detail,
}: {
  label: string
  value: string
  percent?: number
  detail?: string | null
}) {
  return (
    <div className="rounded-xl border border-border/60 px-3 py-2.5 min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-0.5 font-mono text-xl font-semibold tabular-nums leading-tight truncate',
          valueColor(percent),
        )}
      >
        {value}
      </div>
      <Progress value={percent} indicatorClassName={loadColor(percent)} className="mt-2 h-1.5" />
      <div className="mt-1.5 font-mono text-[11px] text-muted-foreground truncate" title={detail || undefined}>
        {detail || ' '}
      </div>
    </div>
  )
}

function Panel({
  label,
  extra,
  children,
}: {
  label: string
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-border/60 px-3 py-2.5 min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        {extra && <span className="text-[11px] text-muted-foreground">{extra}</span>}
      </div>
      {children}
    </div>
  )
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center gap-1.5 text-muted-foreground/50">
      <Info className="h-3.5 w-3.5" />
      <span className="text-xs">{children}</span>
    </div>
  )
}

function Meta({ k, v }: { k: string; v: ReactNode }) {
  if (v == null || v === '') return null
  return (
    <span className="font-mono text-[11px] text-muted-foreground">
      {k} <span className="text-foreground/80 tabular-nums">{v}</span>
    </span>
  )
}
