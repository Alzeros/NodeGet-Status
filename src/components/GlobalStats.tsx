import { ArrowDown, ArrowLeftRight, ArrowUp, Database, Globe, Server } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSmoothNumber } from '../hooks/useSmoothNumber'
import { bytesParts } from '../utils/format'
import { Sparkline } from './Sparkline'
import { cn, getStatusColor } from '../utils/cn'

/*
 * 实时数值每 2s 刷新，而 prettyBytes 会同时改变两件事：
 *   1. 单位在 B / KiB / MiB / GiB 之间切换（字符数 1↔3）
 *   2. 数字在整数与小数之间切换（"145" ↔ "1.14"，3 sig figs）
 * 若不锁定宽度，整行（含分隔符与后续内容）会被推着左右抖动、看起来发糊。
 * 因此：数字用 tabular-nums 等宽并右对齐固定宽度，单位左对齐固定宽度，
 * 两者合起来占据恒定横向空间，与具体数值无关。
 */
function Num({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn('inline-block text-right tabular-nums', className)}
      style={{ minWidth: '4ch' }}
    >
      {children}
    </span>
  )
}

function Unit({
  children,
  className,
  width = '3.5ch',
}: {
  children: ReactNode
  className?: string
  width?: string
}) {
  return (
    <span className={cn('inline-block text-left', className)} style={{ minWidth: width }}>
      {children}
    </span>
  )
}

interface Props {
  onlineCount: number
  totalCount: number
  totalNetIn: number
  totalNetOut: number
  totalTrafficIn: number
  totalTrafficOut: number
  regionCount: number
  bandwidthHistory?: number[]
  trafficHistory?: number[]
  netInHistory?: number[]
  layout?: 'horizontal' | 'vertical'
  excludeOverview?: boolean
  excludeRegionCount?: boolean
}

export function CircularProgress({
  value,
  size = 32,
  strokeWidth = 3,
  colorClass = 'text-emerald-500',
}: {
  value: number
  size?: number
  strokeWidth?: number
  colorClass?: string
}) {
  const r = (size - strokeWidth) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.min(Math.max(value, 0), 1))

  return (
    <svg width={size} height={size} className={`shrink-0 -rotate-90 ${colorClass}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="opacity-[0.08]"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  )
}

export function GlobalStats({
  onlineCount,
  totalCount,
  totalNetIn,
  totalNetOut,
  totalTrafficIn,
  totalTrafficOut,
  regionCount,
  bandwidthHistory = [],
  trafficHistory = [],
  netInHistory = [],
  layout = 'horizontal',
  excludeOverview = false,
  excludeRegionCount = false,
}: Props) {
  const smoothNetIn = useSmoothNumber(totalNetIn, [totalNetIn])
  const smoothNetOut = useSmoothNumber(totalNetOut, [totalNetOut])

  const allOnline = onlineCount === totalCount && totalCount > 0
  const onlineRatio = totalCount > 0 ? onlineCount / totalCount : 0
  const statusColor = getStatusColor(onlineCount, totalCount)

  const trafficTotal = totalTrafficIn + totalTrafficOut
  const trafficParts = bytesParts(trafficTotal)
  const upParts = bytesParts(totalTrafficOut)
  const downParts = bytesParts(totalTrafficIn)
  const netOutParts = bytesParts(smoothNetOut)
  const netInParts = bytesParts(smoothNetIn)

  if (layout === 'vertical') {
    return (
      <div className="flex flex-col gap-3">
        {/* 节点概览 */}
        {!excludeOverview && (
          <div className="rounded-2xl p-4 overflow-hidden bg-card card-soft hover:translate-y-0">
            <div className="flex items-center gap-2 mb-2">
              <Server className="shrink-0 h-4 w-4 text-emerald-500" strokeWidth={1.5} />
              <span className="text-[11px] text-muted-foreground">节点概览</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <span className={`text-2xl font-bold tabular-nums ${statusColor.text}`}>
                  {onlineCount}
                </span>
                <span className="text-lg text-gray-400 dark:text-gray-500 font-normal tabular-nums">/ {totalCount}</span>
              </div>
              <CircularProgress value={onlineRatio} colorClass={statusColor.ring} size={36} />
            </div>
            <span className="text-[10px] text-muted-foreground/60">Online</span>
          </div>
        )}

        {/* 实时带宽 */}
        <div className="rounded-2xl p-4 overflow-hidden bg-card card-soft hover:translate-y-0">
          <div className="flex items-center gap-2 mb-2">
            <ArrowLeftRight className="shrink-0 h-4 w-4 text-blue-500" strokeWidth={1.5} />
            <span className="text-[11px] text-muted-foreground">实时带宽</span>
          </div>
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <ArrowUp className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <Num className="text-lg font-bold">{netOutParts.num}</Num>
              <Unit className="text-xs opacity-85" width="4.5ch">{netOutParts.unit}/s</Unit>
            </div>
            <span className="text-muted-foreground/20">|</span>
            <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
              <ArrowDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <Num className="text-lg font-bold">{netInParts.num}</Num>
              <Unit className="text-xs opacity-85" width="4.5ch">{netInParts.unit}/s</Unit>
            </div>
          </div>
          {netInHistory.length > 1 && (
            <div className="mt-2 w-full">
              <Sparkline data={netInHistory} width={200} height={32} color="hsl(var(--primary))" className="w-full" />
            </div>
          )}
        </div>

        {/* 周期流量 */}
        <div className="rounded-2xl p-4 overflow-hidden bg-card card-soft hover:translate-y-0">
          <div className="flex items-center gap-2 mb-2">
            <Database className="shrink-0 h-4 w-4 text-amber-500" strokeWidth={1.5} />
            <span className="text-[11px] text-muted-foreground">周期流量</span>
          </div>
          <div className="flex items-center justify-between px-4">
            <div className="flex items-baseline gap-0.5">
              <Num className="text-2xl font-bold text-foreground">{trafficParts.num}</Num>
              <Unit className="text-xs text-muted-foreground">{trafficParts.unit}</Unit>
            </div>
            <div className="flex flex-col items-end gap-0.5 text-[10px] leading-tight text-muted-foreground/80">
              <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
                <ArrowUp className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                <Num>{upParts.num}</Num>
                <Unit className="text-[9px] opacity-80 ml-0.5" width="3ch">{upParts.unit}</Unit>
              </span>
              <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400 font-medium">
                <ArrowDown className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                <Num>{downParts.num}</Num>
                <Unit className="text-[9px] opacity-80 ml-0.5" width="3ch">{downParts.unit}</Unit>
              </span>
            </div>
          </div>
        </div>

        {/* 区域分布 */}
        {!excludeRegionCount && (
          <div className="rounded-2xl p-4 overflow-hidden bg-card card-soft hover:translate-y-0">
            <div className="flex items-center gap-2 mb-2">
              <Globe className="shrink-0 h-4 w-4 text-violet-500" strokeWidth={1.5} />
              <span className="text-[11px] text-muted-foreground">区域分布</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-2xl font-bold text-foreground">{regionCount}</span>
              <span className="text-xs text-muted-foreground">国家/地区</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col md:grid md:grid-cols-4 md:gap-3 rounded-2xl bg-card card-soft hover:translate-y-0 md:bg-transparent md:border-none md:shadow-none overflow-hidden">
      {/* 节点概览 */}
      <div className="flex items-center gap-3 md:gap-4 px-4 md:p-5 py-3 min-h-[48px] md:min-h-0 border-b border-border/10 md:border-b-0 last:border-b-0 md:rounded-2xl md:bg-card md:card-soft hover:translate-y-0 overflow-hidden">
        <Server className="shrink-0 h-4 w-4 text-emerald-500" strokeWidth={1.5} />
        <div className="flex-1 min-w-0 flex flex-row md:flex-col justify-between md:justify-center items-center md:items-start gap-0 md:gap-1">
          <div className="text-sm md:text-[11px] text-muted-foreground md:leading-none md:h-[14px] md:flex md:items-center md:overflow-hidden">
            节点概览
          </div>
          <div className="shrink-0 h-auto md:h-6 flex items-center gap-1 leading-none md:whitespace-nowrap md:overflow-hidden">
            <span className={`text-base md:text-xl font-bold tabular-nums ${statusColor.text}`}>
              {onlineCount}
            </span>
            <span className="text-sm md:text-xl text-gray-400 dark:text-gray-500 font-normal tabular-nums">/ {totalCount}</span>
          </div>
          <div className="hidden md:flex shrink-0 h-6 items-center leading-none overflow-hidden">
            <span className="text-[10px] text-muted-foreground/60">Online</span>
          </div>
        </div>
        <div className="hidden md:flex shrink-0 w-10 h-10 items-center justify-center">
          <CircularProgress value={onlineRatio} colorClass={statusColor.ring} />
        </div>
      </div>

      {/* 实时带宽 */}
      <div className="flex items-center gap-3 md:gap-4 px-4 md:p-5 py-3 min-h-[48px] md:min-h-0 border-b border-border/10 md:border-b-0 last:border-b-0 md:rounded-2xl md:bg-card md:card-soft hover:translate-y-0 overflow-hidden">
        <ArrowLeftRight className="shrink-0 h-4 w-4 text-blue-500" strokeWidth={1.5} />
        <div className="flex-1 min-w-0 flex flex-row md:flex-col justify-between md:justify-center items-center md:items-start gap-0 md:gap-1">
          <div className="text-sm md:text-[11px] text-muted-foreground md:leading-none md:h-[14px] md:flex md:items-center md:overflow-hidden">
            实时带宽
          </div>
          <div className="shrink-0 md:hidden flex flex-col items-end leading-none gap-0.5">
            <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
              <ArrowUp className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <Num className="text-sm font-semibold">{netOutParts.num}</Num>
              <Unit className="text-[10px] font-normal" width="4.5ch">{netOutParts.unit}/s</Unit>
            </span>
            <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
              <ArrowDown className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <Num className="text-sm font-semibold">{netInParts.num}</Num>
              <Unit className="text-[10px] font-normal" width="4.5ch">{netInParts.unit}/s</Unit>
            </span>
          </div>
          <div className="hidden md:flex shrink-0 h-6 items-center gap-1.5 leading-none whitespace-nowrap overflow-hidden">
            <ArrowUp className="h-4 w-4 text-emerald-500 shrink-0" strokeWidth={1.5} />
            <Num className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{netOutParts.num}</Num>
            <Unit className="text-xs text-emerald-600/70 dark:text-emerald-400/70 font-normal" width="4.5ch">{netOutParts.unit}/s</Unit>
          </div>
          <div className="hidden md:flex shrink-0 h-6 items-center gap-1.5 leading-none whitespace-nowrap overflow-hidden">
            <ArrowDown className="h-4 w-4 text-blue-500 shrink-0" strokeWidth={1.5} />
            <Num className="text-xl font-bold text-blue-600 dark:text-blue-400">{netInParts.num}</Num>
            <Unit className="text-xs text-blue-600/70 dark:text-blue-400/70 font-normal" width="4.5ch">{netInParts.unit}/s</Unit>
          </div>
        </div>
        <div className="hidden md:flex shrink-0 w-20 h-10 items-center justify-center">
          {netInHistory.length > 1 && (
            <Sparkline data={netInHistory} width={80} height={40} color="hsl(var(--primary))" />
          )}
        </div>
      </div>

      {/* 周期流量 */}
      <div className="flex items-center gap-3 md:gap-4 px-4 md:p-5 py-3 min-h-[48px] md:min-h-0 border-b border-border/10 md:border-b-0 last:border-b-0 md:rounded-2xl md:bg-card md:card-soft hover:translate-y-0 overflow-hidden">
        <Database className="shrink-0 h-4 w-4 text-amber-500" strokeWidth={1.5} />
        <div className="flex-1 min-w-0 flex flex-row md:flex-col justify-between md:justify-center items-center md:items-start gap-0 md:gap-1">
          <div className="text-sm md:text-[11px] text-muted-foreground md:leading-none md:h-[14px] md:flex md:items-center md:overflow-hidden">
            周期流量
          </div>
          <div className="shrink-0 h-auto md:h-6 flex items-center gap-1.5 leading-none md:whitespace-nowrap md:overflow-hidden">
            <Num className="text-base md:text-xl font-bold text-foreground">{trafficParts.num}</Num>
            <Unit className="text-sm md:text-xs text-muted-foreground font-normal">{trafficParts.unit}</Unit>
          </div>
          <div className="hidden md:flex shrink-0 h-6 items-center gap-2 leading-none whitespace-nowrap overflow-hidden">
            <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
              <ArrowUp className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <Num className="text-sm font-medium">{upParts.num}</Num>
              <Unit className="text-[10px] font-normal" width="3ch">{upParts.unit}</Unit>
            </span>
            <span className="text-muted-foreground/40 text-xs">|</span>
            <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
              <ArrowDown className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <Num className="text-sm font-medium">{downParts.num}</Num>
              <Unit className="text-[10px] font-normal" width="3ch">{downParts.unit}</Unit>
            </span>
          </div>
        </div>
      </div>

      {/* 区域分布 */}
      <div className="flex items-center gap-3 md:gap-4 px-4 md:p-5 py-3 min-h-[48px] md:min-h-0 border-b border-border/10 md:border-b-0 last:border-b-0 md:rounded-2xl md:bg-card md:card-soft hover:translate-y-0 overflow-hidden">
        <Globe className="shrink-0 h-4 w-4 text-violet-500" strokeWidth={1.5} />
        <div className="flex-1 min-w-0 flex flex-row md:flex-col justify-between md:justify-center items-center md:items-start gap-0 md:gap-1">
          <div className="text-sm md:text-[11px] text-muted-foreground md:leading-none md:h-[14px] md:flex md:items-center md:overflow-hidden">
            区域分布
          </div>
          <div className="shrink-0 h-auto md:h-6 flex items-center leading-none md:whitespace-nowrap md:overflow-hidden">
            <span className="text-base md:text-xl font-bold text-foreground">{regionCount}</span>
          </div>
          <div className="hidden md:flex shrink-0 h-6 items-center leading-none overflow-hidden">
            <span className="text-[10px] text-muted-foreground/60">国家/地区</span>
          </div>
        </div>
        <div className="hidden md:flex shrink-0 w-10 h-10 items-center justify-center">
          <Globe className="h-10 w-10 text-primary/[0.04]" strokeWidth={1} />
        </div>
      </div>
    </div>
  )
}
