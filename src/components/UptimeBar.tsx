import { useState, useRef, useCallback, memo } from 'react'
import type { TrackBlock } from '../utils/latency'

export interface UptimeBarProps {
  blocks: (TrackBlock | null)[]
  /** ISP 中文标签 — 用于 tooltip 展示 */
  ispLabel?: string
  /** 条形高度 (px), 默认 24 */
  barHeight?: number
  /** 'latency' 用延迟色块颜色, 'loss' 用丢包率独立着色 */
  mode?: 'latency' | 'loss'
}

/*
 * 精致色调 — 中等饱和度，清晰且优雅
 * Light:  green → 翠石绿    yellow → 琥珀金    red → 珊瑚红
 * Dark:   green → 玉石绿    yellow → 蜜糖金    red → 赤陶红
 */
const MORANDI = {
  green:  { light: '#5fa67a', dark: '#4ec97a' },
  yellow: { light: '#c9923e', dark: '#dba54a' },
  red:    { light: '#c25d56', dark: '#e06b63' },
  empty:  { light: 'rgba(0,0,0,0.06)', dark: 'rgba(255,255,255,0.08)' },
}

function isDarkMode() {
  return document.documentElement.classList.contains('dark')
}

function resolveColor(b: TrackBlock | null, mode: 'latency' | 'loss'): string {
  const dark = isDarkMode()
  if (!b || b.status === 'empty') return dark ? MORANDI.empty.dark : MORANDI.empty.light

  if (mode === 'loss') {
    if (b.total === 0) return dark ? MORANDI.empty.dark : MORANDI.empty.light
    const lr = b.lossCount / b.total
    if (lr > 0.1) return dark ? MORANDI.red.dark : MORANDI.red.light
    if (lr > 0.01) return dark ? MORANDI.yellow.dark : MORANDI.yellow.light
    return dark ? MORANDI.green.dark : MORANDI.green.light
  }

  // latency mode — map className
  if (b.className.includes('rose')) return dark ? MORANDI.red.dark : MORANDI.red.light
  if (b.className.includes('amber')) return dark ? MORANDI.yellow.dark : MORANDI.yellow.light
  return dark ? MORANDI.green.dark : MORANDI.green.light
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export const UptimeBar = memo(function UptimeBar({
  blocks,
  ispLabel,
  barHeight = 24,
  mode = 'latency',
}: UptimeBarProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; above: boolean } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseEnter = useCallback((e: React.MouseEvent, idx: number) => {
    setHoverIdx(idx)
    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect()
      const segRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      // 检测浮窗是否超出上方视口
      const above = containerRect.top > 100
      setTooltipPos({
        x: segRect.left + segRect.width / 2 - containerRect.left,
        above,
      })
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    setHoverIdx(null)
    setTooltipPos(null)
  }, [])

  const hoverBlock = hoverIdx !== null ? blocks[hoverIdx] : null
  const hasData = hoverBlock && hoverBlock.status !== 'empty'

  return (
    <div ref={containerRef} className="relative w-full">
      {/* 主色条 — 极细缝隙，黑曜石质感 */}
      <div
        className="flex w-full overflow-hidden rounded-[4px]"
        style={{
          height: `${barHeight}px`,
          gap: '1px',
          backgroundColor: isDarkMode() ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        }}
      >
        {blocks.map((b, i) => {
          const color = resolveColor(b, mode)
          const isHovered = hoverIdx === i
          const isEmpty = !b || b.status === 'empty'
          return (
            <div
              key={i}
              className="flex-1 relative transition-all duration-200 ease-out"
              style={{
                backgroundColor: color,
                opacity: isHovered ? 1 : (hoverIdx !== null ? 0.4 : 0.92),
                filter: isHovered ? 'brightness(1.3) saturate(1.2)' : 'none',
                boxShadow: isHovered && !isEmpty
                  ? `0 0 8px ${color}66`
                  : 'none',
              }}
              onMouseEnter={(e) => handleMouseEnter(e, i)}
              onMouseLeave={handleMouseLeave}
            />
          )
        })}
      </div>

      {/* 玻璃拟态浮窗 (Glassmorphism Tooltip) */}
      {hoverIdx !== null && tooltipPos && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: `${tooltipPos.x}px`,
            ...(tooltipPos.above
              ? { bottom: `${barHeight + 8}px`, transform: 'translateX(-50%)' }
              : { top: `${barHeight + 8}px`, transform: 'translateX(-50%)' }
            ),
          }}
        >
          <div
            className="relative rounded-xl px-3.5 py-2.5 whitespace-nowrap"
            style={{
              background: isDarkMode()
                ? 'rgba(20, 20, 22, 0.72)'
                : 'rgba(255, 255, 255, 0.72)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: isDarkMode()
                ? '1px solid rgba(255,255,255,0.08)'
                : '1px solid rgba(0,0,0,0.06)',
              boxShadow: isDarkMode()
                ? '0 8px 32px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.2)'
                : '0 8px 32px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
              animation: 'uptimeTooltipIn 150ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {hasData ? (
              <>
                {/* 时间范围 */}
                <div className="flex items-center gap-1.5 mb-1.5">
                  {ispLabel && (
                    <span
                      className="text-[10px] font-medium tracking-wide uppercase"
                      style={{ color: isDarkMode() ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)' }}
                    >
                      {ispLabel}
                    </span>
                  )}
                  <span
                    className="text-[11px] font-medium tabular-nums tracking-tight"
                    style={{ color: isDarkMode() ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)' }}
                  >
                    {formatTime(hoverBlock!.t)} – {formatTime(hoverBlock!.t + 3600000)}
                  </span>
                </div>
                {/* 数据指标 */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: resolveColor(hoverBlock, 'latency'), filter: 'brightness(1.3)' }}
                    />
                    <span
                      className="text-[10px]"
                      style={{ color: isDarkMode() ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }}
                    >
                      延迟
                    </span>
                    <span
                      className="text-[11px] font-mono font-medium tabular-nums"
                      style={{ color: isDarkMode() ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)' }}
                    >
                      {hoverBlock!.avg != null ? `${hoverBlock!.avg.toFixed(1)}ms` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: resolveColor(hoverBlock, 'loss'), filter: 'brightness(1.3)' }}
                    />
                    <span
                      className="text-[10px]"
                      style={{ color: isDarkMode() ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }}
                    >
                      丢包
                    </span>
                    <span
                      className="text-[11px] font-mono font-medium tabular-nums"
                      style={{
                        color: hoverBlock!.total > 0 && hoverBlock!.lossCount / hoverBlock!.total > 0.1
                          ? (isDarkMode() ? MORANDI.red.dark : MORANDI.red.light)
                          : (isDarkMode() ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)'),
                        filter: hoverBlock!.total > 0 && hoverBlock!.lossCount / hoverBlock!.total > 0.1
                          ? 'brightness(1.4)' : 'none',
                      }}
                    >
                      {hoverBlock!.total > 0
                        ? `${hoverBlock!.lossCount}/${hoverBlock!.total} (${((hoverBlock!.lossCount / hoverBlock!.total) * 100).toFixed(1)}%)`
                        : '—'}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <span
                className="text-[11px]"
                style={{ color: isDarkMode() ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)' }}
              >
                暂无数据
              </span>
            )}

            {/* 小三角指示器 */}
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                ...(tooltipPos.above
                  ? { bottom: '-5px' }
                  : { top: '-5px' }
                ),
                width: '10px',
                height: '10px',
                transform: `translateX(-50%) rotate(${tooltipPos.above ? '45deg' : '225deg'})`,
                background: isDarkMode()
                  ? 'rgba(20, 20, 22, 0.72)'
                  : 'rgba(255, 255, 255, 0.72)',
                border: isDarkMode()
                  ? '1px solid rgba(255,255,255,0.08)'
                  : '1px solid rgba(0,0,0,0.06)',
                borderTop: tooltipPos.above ? 'none' : undefined,
                borderLeft: tooltipPos.above ? 'none' : undefined,
                borderBottom: !tooltipPos.above ? 'none' : undefined,
                borderRight: !tooltipPos.above ? 'none' : undefined,
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
              }}
            />
          </div>
        </div>
      )}

      {/* 全局动画 keyframes — 仅注入一次 */}
      <style>{`
        @keyframes uptimeTooltipIn {
          from {
            opacity: 0;
            transform: translateX(-50%) scale(0.96) translateY(${tooltipPos?.above ? '4px' : '-4px'});
          }
          to {
            opacity: 1;
            transform: translateX(-50%) scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  )
})
