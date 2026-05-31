import { ArrowDown, ArrowLeftRight, ArrowUp, Database, Globe, Server } from 'lucide-react'
import { useSmoothNumber } from '../hooks/useSmoothNumber'
import { bytesParts } from '../utils/format'
import { Sparkline } from './Sparkline'

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
          <div className="rounded-xl border border-[#f0f0f0] dark:border-border/20 shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 overflow-hidden">
            <div className="flex items-center gap-2 mb-2">
              <Server className="shrink-0 h-4 w-4 text-emerald-500" strokeWidth={1.5} />
              <span className="text-[11px] text-muted-foreground">节点概览</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <span className={`text-2xl font-bold ${allOnline ? 'text-green-500' : 'text-rose-500'}`}>
                  {onlineCount}
                </span>
                <span className="text-lg text-gray-400 dark:text-gray-500 font-normal">/ {totalCount}</span>
              </div>
              <CircularProgress value={onlineRatio} colorClass={allOnline ? 'text-emerald-500' : 'text-rose-500'} size={36} />
            </div>
            <span className="text-[10px] text-muted-foreground/60">Online</span>
          </div>
        )}

        {/* 实时带宽 */}
        <div className="rounded-xl border border-[#f0f0f0] dark:border-border/20 shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 overflow-hidden">
          <div className="flex items-center gap-2 mb-2">
            <ArrowLeftRight className="shrink-0 h-4 w-4 text-blue-500" strokeWidth={1.5} />
            <span className="text-[11px] text-muted-foreground">实时带宽</span>
          </div>
          <div className="flex items-center gap-3 mb-2.5">
            <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <ArrowUp className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="text-lg font-bold">{netOutParts.num}</span>
              <span className="text-xs opacity-85">{netOutParts.unit}/s</span>
            </div>
            <span className="text-muted-foreground/20">|</span>
            <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
              <ArrowDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="text-lg font-bold">{netInParts.num}</span>
              <span className="text-xs opacity-85">{netInParts.unit}/s</span>
            </div>
          </div>
          {netInHistory.length > 1 && (
            <div className="mt-2">
              <Sparkline data={netInHistory} width={200} height={32} color="hsl(var(--primary))" />
            </div>
          )}
        </div>

        {/* 本月流量 */}
        <div className="rounded-xl border border-[#f0f0f0] dark:border-border/20 shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 overflow-hidden">
          <div className="flex items-center gap-2 mb-2">
            <Database className="shrink-0 h-4 w-4 text-amber-500" strokeWidth={1.5} />
            <span className="text-[11px] text-muted-foreground">本月流量</span>
          </div>
          <div className="flex items-center justify-between px-4">
            <div className="flex items-baseline gap-0.5">
              <span className="text-2xl font-bold text-foreground">{trafficParts.num}</span>
              <span className="text-xs text-muted-foreground">{trafficParts.unit}</span>
            </div>
            <div className="flex flex-col items-end gap-0.5 text-[10px] leading-tight text-muted-foreground/80">
              <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
                <ArrowUp className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                <span>{upParts.num}</span>
                <span className="text-[9px] opacity-80 ml-0.5">{upParts.unit}</span>
              </span>
              <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400 font-medium">
                <ArrowDown className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                <span>{downParts.num}</span>
                <span className="text-[9px] opacity-80 ml-0.5">{downParts.unit}</span>
              </span>
            </div>
          </div>
        </div>

        {/* 区域分布 */}
        {!excludeRegionCount && (
          <div className="rounded-xl border border-[#f0f0f0] dark:border-border/20 shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 overflow-hidden">
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
    <div className="flex flex-col md:grid md:grid-cols-4 md:gap-3 rounded-xl border border-[#f0f0f0] dark:border-border/20 shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:rounded-none md:border-none md:shadow-none overflow-hidden">
      {/* 节点概览 */}
      <div className="flex items-center gap-3 md:gap-4 px-4 md:p-5 py-3 min-h-[48px] md:min-h-0 border-b border-border/10 md:border-b-0 last:border-b-0 md:rounded-xl md:border md:border-[#f0f0f0] md:dark:border-border/20 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
        <Server className="shrink-0 h-4 w-4 text-emerald-500" strokeWidth={1.5} />
        <div className="flex-1 min-w-0 flex flex-row md:flex-col justify-between md:justify-center items-center md:items-start gap-0 md:gap-1">
          <div className="text-sm md:text-[11px] text-muted-foreground md:leading-none md:h-[14px] md:flex md:items-center md:overflow-hidden">
            节点概览
          </div>
          <div className="shrink-0 h-auto md:h-6 flex items-center gap-1 leading-none md:whitespace-nowrap md:overflow-hidden">
            <span className={`text-base md:text-xl font-bold ${allOnline ? 'text-green-500' : 'text-rose-500'}`}>
              {onlineCount}
            </span>
            <span className="text-sm md:text-xl text-gray-400 dark:text-gray-500 font-normal">/ {totalCount}</span>
          </div>
          <div className="hidden md:flex shrink-0 h-6 items-center leading-none overflow-hidden">
            <span className="text-[10px] text-muted-foreground/60">Online</span>
          </div>
        </div>
        <div className="hidden md:flex shrink-0 w-10 h-10 items-center justify-center">
          <CircularProgress value={onlineRatio} colorClass={allOnline ? 'text-emerald-500' : 'text-rose-500'} />
        </div>
      </div>

      {/* 实时带宽 */}
      <div className="flex items-center gap-3 md:gap-4 px-4 md:p-5 py-3 min-h-[48px] md:min-h-0 border-b border-border/10 md:border-b-0 last:border-b-0 md:rounded-xl md:border md:border-[#f0f0f0] md:dark:border-border/20 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
        <ArrowLeftRight className="shrink-0 h-4 w-4 text-blue-500" strokeWidth={1.5} />
        <div className="flex-1 min-w-0 flex flex-row md:flex-col justify-between md:justify-center items-center md:items-start gap-0 md:gap-1">
          <div className="text-sm md:text-[11px] text-muted-foreground md:leading-none md:h-[14px] md:flex md:items-center md:overflow-hidden">
            实时带宽
          </div>
          <div className="shrink-0 md:hidden flex flex-col items-end leading-none gap-0.5">
            <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
              <ArrowUp className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <span className="text-sm font-semibold">{netOutParts.num}</span>
              <span className="text-[10px] font-normal">{netOutParts.unit}/s</span>
            </span>
            <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
              <ArrowDown className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <span className="text-sm font-semibold">{netInParts.num}</span>
              <span className="text-[10px] font-normal">{netInParts.unit}/s</span>
            </span>
          </div>
          <div className="hidden md:flex shrink-0 h-6 items-center gap-1.5 leading-none whitespace-nowrap overflow-hidden">
            <ArrowUp className="h-4 w-4 text-emerald-500 shrink-0" strokeWidth={1.5} />
            <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{netOutParts.num}</span>
            <span className="text-xs text-emerald-600/70 dark:text-emerald-400/70 font-normal">{netOutParts.unit}/s</span>
          </div>
          <div className="hidden md:flex shrink-0 h-6 items-center gap-1.5 leading-none whitespace-nowrap overflow-hidden">
            <ArrowDown className="h-4 w-4 text-blue-500 shrink-0" strokeWidth={1.5} />
            <span className="text-xl font-bold text-blue-600 dark:text-blue-400">{netInParts.num}</span>
            <span className="text-xs text-blue-600/70 dark:text-blue-400/70 font-normal">{netInParts.unit}/s</span>
          </div>
        </div>
        <div className="hidden md:flex shrink-0 w-20 h-10 items-center justify-center">
          {netInHistory.length > 1 && (
            <Sparkline data={netInHistory} width={80} height={40} color="hsl(var(--primary))" />
          )}
        </div>
      </div>

      {/* 本月流量 */}
      <div className="flex items-center gap-3 md:gap-4 px-4 md:p-5 py-3 min-h-[48px] md:min-h-0 border-b border-border/10 md:border-b-0 last:border-b-0 md:rounded-xl md:border md:border-[#f0f0f0] md:dark:border-border/20 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
        <Database className="shrink-0 h-4 w-4 text-amber-500" strokeWidth={1.5} />
        <div className="flex-1 min-w-0 flex flex-row md:flex-col justify-between md:justify-center items-center md:items-start gap-0 md:gap-1">
          <div className="text-sm md:text-[11px] text-muted-foreground md:leading-none md:h-[14px] md:flex md:items-center md:overflow-hidden">
            本月流量
          </div>
          <div className="shrink-0 h-auto md:h-6 flex items-center gap-1.5 leading-none md:whitespace-nowrap md:overflow-hidden">
            <span className="text-base md:text-xl font-bold text-foreground">{trafficParts.num}</span>
            <span className="text-sm md:text-xs text-muted-foreground font-normal">{trafficParts.unit}</span>
          </div>
          <div className="hidden md:flex shrink-0 h-6 items-center gap-2 leading-none whitespace-nowrap overflow-hidden">
            <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
              <ArrowUp className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <span className="text-sm font-medium">{upParts.num}</span>
              <span className="text-[10px] font-normal">{upParts.unit}</span>
            </span>
            <span className="text-muted-foreground/40 text-xs">|</span>
            <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
              <ArrowDown className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <span className="text-sm font-medium">{downParts.num}</span>
              <span className="text-[10px] font-normal">{downParts.unit}</span>
            </span>
          </div>
        </div>
      </div>

      {/* 区域分布 */}
      <div className="flex items-center gap-3 md:gap-4 px-4 md:p-5 py-3 min-h-[48px] md:min-h-0 border-b border-border/10 md:border-b-0 last:border-b-0 md:rounded-xl md:border md:border-[#f0f0f0] md:dark:border-border/20 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
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
