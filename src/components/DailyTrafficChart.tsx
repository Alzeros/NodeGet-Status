import { useState } from 'react'
import { bytes } from '../utils/format'
import { cn } from '../utils/cn'
import { DAILY_CHART_DAYS, foldBreakdown, niceBytes } from '../utils/dailyTraffic'
import type { DailyBar, DailyChart } from '../utils/dailyTraffic'
import { Flag } from './Flag'

/*
 * 每日流量柱状图。纯 div 画：一个系列、30 根柱子，不值得为它把图表库拉进分析页。
 * 规格：柱宽封顶 24px、相邻柱之间留 2px 底色缝、顶端 4px 圆角、底边贴基线；网格两条实线细线，刻度取整；
 * 悬停/聚焦出浮层；只有峰值和今天直接标数，其余靠浮层和数据表。
 * 颜色只用主题色一个色相：今天用浅一档（还在累计），无记录的日子只留基线上一道灰。
 */

function mmdd(id: string) {
  return id.slice(5)
}

function describeBar(b: DailyBar) {
  if (b.empty) return `${b.id} 无记录`
  const parts = [
    `${b.id}${b.today ? '（今天，实时累计）' : ''}`,
    `合计 ${bytes(b.total)}`,
    `下行 ${bytes(b.received)}`,
    `上行 ${bytes(b.transmitted)}`,
    `${b.machines} 台`,
  ]
  if (b.partial) parts.push(`${b.partial} 台当天统计不完整`)
  if (b.reset) parts.push(`${b.reset} 台当天重启过，数字偏小`)
  return parts.join(' · ')
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">
        <span className="text-sm font-bold">{value}</span>
        {sub && <span className="block text-[10px] text-muted-foreground tabular-nums">{sub}</span>}
      </span>
    </div>
  )
}

export function DailyTrafficChart({ data, showSource }: { data: DailyChart | null; showSource: boolean }) {
  const [active, setActive] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center text-center text-sm text-muted-foreground py-12 px-4">
        需要主控的流量采样 Worker 写入每日历史（scripts/monthly-traffic-worker.js）。更新 Worker
        后会自动回填最近约三周，之后每天累积
      </div>
    )
  }

  const n = data.bars.length
  const top = niceBytes(data.max)
  const heightPct = (b: DailyBar) => (b.empty ? 0 : Math.max((b.total / top) * 100, 1))
  const hovered = active != null ? data.bars[active] : null
  const breakdown = hovered && !hovered.empty ? foldBreakdown(hovered.nodes) : null
  const share = (v: number) => (hovered && hovered.total > 0 ? `${Math.round((v / hovered.total) * 100)}%` : '')
  // 直接标数只标峰值和今天；两者挨得太近会撞，只留峰值
  const peakIdx = data.peak ? data.bars.indexOf(data.peak) : -1
  const todayIdx = data.today ? data.bars.indexOf(data.today) : -1
  const labelToday = todayIdx >= 0 && (peakIdx < 0 || todayIdx - peakIdx > 2)

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-x-8 gap-y-6">
        <div className="xl:col-span-9 min-w-0">
          <div className="flex gap-2 pt-3">
            {/* y 轴：只标上限、一半、0，值已取整 */}
            <div className="relative w-14 shrink-0 h-40 text-[10px] text-muted-foreground tabular-nums">
              <span className="absolute right-0 top-0 -translate-y-1/2">{bytes(top)}</span>
              <span className="absolute right-0 top-1/2 -translate-y-1/2">{bytes(top / 2)}</span>
              <span className="absolute right-0 bottom-0 translate-y-1/2">0</span>
            </div>
            <div className="relative flex-1 min-w-0 h-40">
              {/* 网格线：实线、一步灰，退到背景里 */}
              <div className="absolute inset-x-0 top-0 border-t border-border/60" />
              <div className="absolute inset-x-0 top-1/2 border-t border-border/60" />
              <div className="absolute inset-x-0 bottom-0 border-t border-border" />
              <div className="absolute inset-0 flex items-end" onPointerLeave={() => setActive(null)}>
                {data.bars.map((b, i) => {
                  const h = heightPct(b)
                  const labeled = !b.empty && (i === peakIdx || (b.today && labelToday))
                  return (
                    // 整个槽位都是命中区：柱子再细也不用瞄准
                    <button
                      key={b.id}
                      type="button"
                      aria-label={describeBar(b)}
                      className="relative flex-1 min-w-0 h-full flex items-end justify-center outline-none px-px"
                      onPointerEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                    >
                      {labeled && (
                        <span
                          className={cn(
                            'absolute text-[10px] tabular-nums text-muted-foreground whitespace-nowrap hidden xl:block',
                            // 贴边的槽位把标签往里靠，别伸出绘图区
                            i <= 1 ? 'left-0' : i >= n - 2 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                          )}
                          style={{ bottom: `calc(${h}% + 3px)` }}
                        >
                          {bytes(b.total)}
                        </span>
                      )}
                      <div
                        className={cn(
                          'w-full max-w-[24px] rounded-t-[4px] transition-[height,filter] duration-300',
                          b.empty ? 'bg-muted-foreground/20' : b.today ? 'bg-primary/45' : 'bg-primary',
                          i === active && !b.empty && 'brightness-125',
                        )}
                        style={{ height: b.empty ? '2px' : `${h}%` }}
                      />
                    </button>
                  )
                })}
              </div>
              {hovered && active != null && (
                <div
                  // w-max：绝对定位默认按"离右边还剩多少"收缩宽度，柱子越靠右浮层越窄，两列会叠起来
                  className="absolute top-0 z-10 pointer-events-none w-max max-w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-border/60 bg-card text-card-foreground shadow-lg px-3 py-2 text-xs whitespace-nowrap"
                  style={{
                    left: `${((active + 0.5) / n) * 100}%`,
                    // 两端的浮层往里靠，别伸出卡片
                    transform: active < 4 ? 'translateX(-8%)' : active > n - 5 ? 'translateX(-92%)' : 'translateX(-50%)',
                  }}
                >
                  {hovered.empty ? (
                    <div className="text-muted-foreground">{hovered.id} · 无记录</div>
                  ) : (
                    <>
                      <div className="text-sm font-semibold">{bytes(hovered.total)}</div>
                      <div className="text-muted-foreground mt-0.5">
                        {hovered.id}
                        {hovered.today && ' · 今天，实时累计'}
                      </div>
                      <div className="text-muted-foreground tabular-nums">
                        ↓ {bytes(hovered.received)} · ↑ {bytes(hovered.transmitted)} · {hovered.machines} 台
                      </div>
                      {hovered.partial > 0 && (
                        <div className="text-amber-600">{hovered.partial} 台当天统计不完整</div>
                      )}
                      {hovered.reset > 0 && (
                        <div className="text-amber-600">{hovered.reset} 台当天重启过，数字偏小</div>
                      )}
                      {/* 分机器明细：降序；不足 1 GiB 的和超出行数的并成"其他"。
                          两列排：十来行竖着排会伸出卡片压到下一张，两列正好落在绘图区里 */}
                      {breakdown && (
                        <div className="mt-2 pt-2 border-t border-border/50 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1">
                          {breakdown.rows.map(r => (
                            <div key={`${r.source}:${r.uuid}`} className="flex items-center gap-2 min-w-[14rem]">
                              {r.region && <Flag code={r.region} className="shrink-0" />}
                              <span className="flex-1 min-w-0 truncate">{showSource ? `${r.source}·${r.name}` : r.name}</span>
                              <span className="tabular-nums font-medium">{bytes(r.total)}</span>
                              <span className="w-8 text-right tabular-nums text-muted-foreground">{share(r.total)}</span>
                            </div>
                          ))}
                          {breakdown.other && (
                            <div className="flex items-center gap-2 min-w-[14rem] text-muted-foreground">
                              <span className="flex-1 min-w-0 truncate">其他 · {breakdown.other.count} 台</span>
                              <span className="tabular-nums">{bytes(breakdown.other.total)}</span>
                              <span className="w-8 text-right tabular-nums">{share(breakdown.other.total)}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* x 轴：从右往左每 7 天一个刻度，今天在最右 */}
          <div className="flex gap-2 mt-1.5">
            <div className="w-14 shrink-0" />
            <div className="flex-1 flex min-w-0">
              {data.bars.map((b, i) => (
                <div key={b.id} className="flex-1 min-w-0 text-center text-[10px] text-muted-foreground tabular-nums">
                  {(n - 1 - i) % 7 === 0 && (
                    <span className="inline-block whitespace-nowrap">{b.today ? '今天' : mmdd(b.id)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 汇总：只算已结束的日子，今天还在涨，单独列 */}
        <div className="xl:col-span-3 border-t border-border/40 pt-5 xl:border-t-0 xl:pt-0 xl:border-l xl:pl-8">
          <div className="text-[11px] text-muted-foreground font-medium mb-2">近 {DAILY_CHART_DAYS} 天</div>
          <div className="flex flex-col gap-2.5">
            <Stat label={`合计 · ${data.days} 天有记录`} value={data.days ? bytes(data.sum) : '—'} />
            <Stat label="日均" value={data.days ? bytes(data.avg) : '—'} />
            <Stat label={data.peak ? `最高 · ${mmdd(data.peak.id)}` : '最高'} value={data.peak ? bytes(data.peak.total) : '—'} />
            <Stat
              label="今天 · 实时"
              value={data.today ? bytes(data.today.total) : '—'}
              sub={data.today ? `↓${bytes(data.today.received)} · ↑${bytes(data.today.transmitted)}` : undefined}
            />
          </div>
        </div>
      </div>

      {/* 数据表：浮层之外的另一条读数路径，也是不能悬停时的兜底 */}
      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={() => setShowTable(v => !v)}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showTable ? '收起数据表' : '数据表'}
        </button>
      </div>
      {showTable && (
        <div className="mt-1 max-h-60 overflow-auto rounded-lg border border-border/40">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-[11px] text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-1.5">日期</th>
                <th className="text-right font-medium px-3 py-1.5">合计</th>
                <th className="text-right font-medium px-3 py-1.5">下行</th>
                <th className="text-right font-medium px-3 py-1.5">上行</th>
                <th className="text-right font-medium px-3 py-1.5">台数</th>
              </tr>
            </thead>
            <tbody>
              {[...data.bars]
                .reverse()
                .filter(b => !b.empty)
                .map(b => (
                  <tr key={b.id} className="border-t border-border/30">
                    <td className="px-3 py-1">
                      {b.id}
                      {b.today && <span className="text-muted-foreground">（今天）</span>}
                    </td>
                    <td className="px-3 py-1 text-right font-medium">{bytes(b.total)}</td>
                    <td className="px-3 py-1 text-right text-muted-foreground">{bytes(b.received)}</td>
                    <td className="px-3 py-1 text-right text-muted-foreground">{bytes(b.transmitted)}</td>
                    <td className="px-3 py-1 text-right text-muted-foreground">{b.machines}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground/70 mt-3">
        浅色柱 = 今天，实时累计 · 灰线 = 无记录 · 按主控时区分日
        {data.flagged > 0 && ' · 个别日子有机器统计不完整或当天重启过，悬停可见'}
      </div>
    </>
  )
}
