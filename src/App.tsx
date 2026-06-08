import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, Loader2, Server } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert'
import { useConfig } from './hooks/useConfig'
import { useNodes } from './hooks/useNodes'
import { Background } from './components/Background'
import { Navbar } from './components/Navbar'
import { Footer } from './components/Footer'
import { GlobalStats, CircularProgress } from './components/GlobalStats'
import { NodeCard } from './components/NodeCard'
import { NodeTable } from './components/NodeTable'
import { NodeDetail } from './components/NodeDetail'
import { TagFilter } from './components/TagFilter'
import { RegionFilter } from './components/RegionFilter'
import { cn, getStatusColor } from './utils/cn'

const WorldMap = lazy(() =>
  import('./components/WorldMap').then(m => ({ default: m.WorldMap })),
)
import { useStableStatus } from './hooks/useStableStatus'
import { deriveUsage, displayName } from './utils/derive'
import type { Sort, View } from './types'
import type { NodeStatusCategory } from './utils/stableStatus'

const DEFAULT_LOGO = `${import.meta.env.BASE_URL}logo.png`
const VIEW_KEY = 'nodeget.view'
const SORT_KEY = 'nodeget.sort'

function initialView(): View {
  const v = localStorage.getItem(VIEW_KEY)
  if (v === 'table' || v === 'map') return v
  return 'cards'
}

function initialSort(): Sort {
  return (localStorage.getItem(SORT_KEY) as Sort) || 'default'
}

function readHash() {
  return decodeURIComponent(window.location.hash.slice(1)) || null
}

const num = (v?: number) => (Number.isFinite(v) ? (v as number) : -Infinity)

export function App() {
  const { config, error: configError } = useConfig()
  const { nodes, errors, loading, pool, latencyTracks } = useNodes(config)
  const { statuses: stableStatuses } = useStableStatus(nodes)
  const bandwidthHistoryRef = useRef<number[]>([])
  const trafficHistoryRef = useRef<number[]>([])
  const netInHistoryRef = useRef<number[]>([])

  const globalStats = useMemo(() => {
    let onlineCount = 0
    let totalCount = 0
    let totalNetIn = 0
    let totalNetOut = 0
    let totalTrafficIn = 0
    let totalTrafficOut = 0
    const regions = new Set<string>()

    for (const n of nodes.values()) {
      if (n.meta?.hidden) continue
      totalCount++
      if (n.online) onlineCount++
      totalNetIn += n.dynamic?.receive_speed ?? 0
      totalNetOut += n.dynamic?.transmit_speed ?? 0
      totalTrafficIn += n.monthlyTraffic?.received ?? 0
      totalTrafficOut += n.monthlyTraffic?.transmitted ?? 0
      const code = n.meta?.region?.trim().toUpperCase()
      if (code) regions.add(code)
    }

    const statusCounts = { normal: 0, warning: 0, risk: 0, offline: 0 }
    for (const n of nodes.values()) {
      if (n.meta?.hidden) continue
      const cat = stableStatuses.get(n.uuid) ?? 'normal'
      statusCounts[cat]++
    }

    const totalBandwidth = totalNetIn + totalNetOut
    const totalTraffic = totalTrafficIn + totalTrafficOut
    const bwHistory = bandwidthHistoryRef.current
    if (bwHistory.length === 0 || bwHistory[bwHistory.length - 1] !== totalBandwidth) {
      bwHistory.push(totalBandwidth)
      if (bwHistory.length > 20) bwHistory.shift()
    }
    const trHistory = trafficHistoryRef.current
    if (trHistory.length === 0 || trHistory[trHistory.length - 1] !== totalTraffic) {
      trHistory.push(totalTraffic)
      if (trHistory.length > 20) trHistory.shift()
    }
    const niHistory = netInHistoryRef.current
    if (niHistory.length === 0 || niHistory[niHistory.length - 1] !== totalNetIn) {
      niHistory.push(totalNetIn)
      if (niHistory.length > 20) niHistory.shift()
    }

    return {
      onlineCount,
      totalCount,
      totalNetIn,
      totalNetOut,
      totalTrafficIn,
      totalTrafficOut,
      regionCount: regions.size,
      statusCounts,
    }
  }, [nodes, stableStatuses])

  const [view, setView] = useState<View>(initialView)
  const [sort, setSort] = useState<Sort>(initialSort)
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [activeRegion, setActiveRegion] = useState<string | null>(null)
  const [activeStatus, setActiveStatus] = useState<NodeStatusCategory | null>(null)
  const [selected, setSelected] = useState<string | null>(readHash)
  const [regionsExpanded, setRegionsExpanded] = useState(true)
  const [statusExpanded, setStatusExpanded] = useState(true)

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  useEffect(() => {
    localStorage.setItem(SORT_KEY, sort)
  }, [sort])

  useEffect(() => {
    if (selected) {
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [selected])

  useEffect(() => {
    const onHash = () => setSelected(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const target = selected ? `#${encodeURIComponent(selected)}` : ''
    if (window.location.hash === target) return
    if (selected) {
      window.location.hash = encodeURIComponent(selected)
    } else {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [selected])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const n of nodes.values()) {
      if (n.meta?.hidden) continue
      for (const t of n.meta?.tags ?? []) set.add(t)
    }
    return [...set].sort()
  }, [nodes])

  const regions = useMemo(() => {
    const map = new Map<string, number>()
    let total = 0
    for (const n of nodes.values()) {
      if (n.meta?.hidden) continue
      total++
      const code = n.meta?.region?.trim().toUpperCase()
      if (!code || !/^[A-Z]{2}$/.test(code)) continue
      map.set(code, (map.get(code) ?? 0) + 1)
    }
    const list = [...map.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    return { list, total }
  }, [nodes])

  useEffect(() => {
    if (activeTag && !allTags.includes(activeTag)) setActiveTag(null)
  }, [allTags, activeTag])

  useEffect(() => {
    if (activeRegion && !regions.list.some(r => r.code === activeRegion)) setActiveRegion(null)
  }, [regions, activeRegion])

  const list = useMemo(() => {
    let arr = [...nodes.values()].filter(n => !n.meta?.hidden)
    if (activeTag) arr = arr.filter(n => n.meta?.tags?.includes(activeTag))
    if (activeRegion) {
      arr = arr.filter(n => n.meta?.region?.trim().toUpperCase() === activeRegion)
    }
    if (activeStatus) {
      arr = arr.filter(n => (stableStatuses.get(n.uuid) ?? 'normal') === activeStatus)
    }

    const q = query.trim().toLowerCase()
    if (q) {
      arr = arr.filter(n => {
        const hay = [
          n.uuid,
          n.source,
          n.meta?.name,
          n.meta?.region,
          n.meta?.virtualization,
          n.static?.system?.system_host_name,
          n.static?.system?.system_name,
          ...(n.meta?.tags ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
    }

    const rank = new Map(regions.list.map((r, i) => [r.code, i]))

    return arr.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1

      const ua = deriveUsage(a)
      const ub = deriveUsage(b)
      let cmp = 0
      if (sort === 'cpu') cmp = num(ub.cpu) - num(ua.cpu)
      else if (sort === 'mem') cmp = num(ub.mem) - num(ua.mem)
      else if (sort === 'disk') cmp = num(ub.disk) - num(ua.disk)
      else if (sort === 'netIn') cmp = num(ub.netIn) - num(ua.netIn)
      else if (sort === 'netOut') cmp = num(ub.netOut) - num(ua.netOut)
      else if (sort === 'uptime') cmp = num(ub.uptime) - num(ua.uptime)
      else if (sort === 'traffic') cmp = num(b.monthlyTraffic?.total) - num(a.monthlyTraffic?.total)
      else if (sort === 'region') {
        const ar = rank.get(a.meta?.region?.trim().toUpperCase() || '') ?? Infinity
        const br = rank.get(b.meta?.region?.trim().toUpperCase() || '') ?? Infinity
        cmp = ar - br
      }
      else if (sort === 'default') cmp = (a.meta?.order ?? 0) - (b.meta?.order ?? 0)

      return cmp || displayName(a).localeCompare(displayName(b))
    })
  }, [nodes, query, activeTag, activeRegion, activeStatus, sort, regions, stableStatuses])

  const filteredStatusCounts = useMemo(() => {
    let arr = [...nodes.values()].filter(n => !n.meta?.hidden)
    if (activeTag) arr = arr.filter(n => n.meta?.tags?.includes(activeTag))
    if (activeRegion) {
      arr = arr.filter(n => n.meta?.region?.trim().toUpperCase() === activeRegion)
    }
    const q = query.trim().toLowerCase()
    if (q) {
      arr = arr.filter(n => {
        const hay = [
          n.uuid, n.source, n.meta?.name, n.meta?.region,
          n.meta?.virtualization, n.static?.system?.system_host_name,
          n.static?.system?.system_name, ...(n.meta?.tags ?? []),
        ].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(q)
      })
    }
    const counts = { normal: 0, warning: 0, risk: 0, offline: 0 }
    for (const n of arr) {
      const cat = stableStatuses.get(n.uuid) ?? 'normal'
      counts[cat]++
    }
    return counts
  }, [nodes, activeTag, activeRegion, query, stableStatuses])

  const selectedNode = selected ? nodes.get(selected) || null : null
  const clearFilters = () => {
    setQuery('')
    setActiveTag(null)
    setActiveRegion(null)
    setActiveStatus(null)
  }

  if (configError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>加载 config.json 失败</AlertTitle>
          <AlertDescription>{String(configError.message || configError)}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        加载中…
      </div>
    )
  }

  const logo = config.user_preferences.site_logo || DEFAULT_LOGO
  const hasErrors = errors.length > 0
  const hasNodes = globalStats.totalCount > 0
  const hasResults = list.length > 0
  const noResults = hasNodes && !hasResults
  const showInitialLoading = !hasNodes && loading && !hasErrors
  const showNoNodes = !hasNodes && (!loading || hasErrors)

  return (
    <div className="min-h-screen flex flex-col">
      <Background />
      <Navbar
        siteName={config.user_preferences.site_name || '你没设置'}
        logo={logo}
        query={query}
        onQuery={setQuery}
        view={view}
        onView={setView}
        sort={sort}
        onSort={setSort}
      />

      <main className="flex-1 w-full max-w-[1600px] mx-auto px-6 sm:px-8 lg:px-12 xl:px-16 py-6 sm:py-8">
        <div className="flex gap-6">
          {/* 左侧固定侧边栏 - 仅 lg 以上显示 */}
          {hasNodes && (
            <aside className="hidden lg:block w-[260px] shrink-0">
              <div className="sticky top-[60px] space-y-3 max-h-[calc(100vh-80px)] overflow-y-auto sidebar-scroll pb-4">
                {/* 节点状态与地区筛选合并卡片 */}
                <div className="rounded-xl border border-[#f0f0f0] dark:border-border/20 shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 bg-card text-card-foreground">
                  <div className="flex items-center gap-2 mb-2">
                    <Server className="shrink-0 h-4 w-4 text-emerald-500" strokeWidth={1.5} />
                    <span className="text-[11px] text-muted-foreground font-medium">节点状态</span>
                  </div>
                  {(() => {
                    const statusColor = getStatusColor(globalStats.onlineCount, globalStats.totalCount)
                    return (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <span className={cn("text-2xl font-bold", statusColor.text)}>
                            {globalStats.onlineCount}
                          </span>
                          <span className="text-lg text-gray-400 dark:text-gray-500 font-normal">/ {globalStats.totalCount}</span>
                        </div>
                        <CircularProgress
                          value={globalStats.totalCount > 0 ? globalStats.onlineCount / globalStats.totalCount : 0}
                          colorClass={statusColor.ring}
                          size={36}
                        />
                      </div>
                    )
                  })()}
                  <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground/60 leading-none">
                    <span>Online</span>
                    <span>解锁地区: {globalStats.regionCount} 个</span>
                  </div>

                  {regions.list.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-[#f0f0f0] dark:border-border/20">
                      <button
                        type="button"
                        onClick={() => setRegionsExpanded(e => !e)}
                        className="flex items-center justify-between w-full text-[11px] text-muted-foreground font-medium hover:text-foreground transition-colors group"
                      >
                        <span>地区筛选</span>
                        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground transition-transform duration-200", regionsExpanded ? "rotate-0" : "-rotate-90")} />
                      </button>

                      <div className={cn(
                        "grid transition-[grid-template-rows,opacity,margin] duration-200 ease-in-out",
                        regionsExpanded ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0 pointer-events-none mt-0"
                      )}>
                        <div className="overflow-hidden">
                          <RegionFilter
                            regions={regions.list}
                            total={regions.total}
                            active={activeRegion}
                            onChange={setActiveRegion}
                            layout="vertical"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-[#f0f0f0] dark:border-border/20">
                    <button
                      type="button"
                      onClick={() => setStatusExpanded(e => !e)}
                      className="flex items-center justify-between w-full text-[11px] text-muted-foreground font-medium hover:text-foreground transition-colors group"
                    >
                      <span>状态筛选</span>
                      <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground transition-transform duration-200", statusExpanded ? "rotate-0" : "-rotate-90")} />
                    </button>

                    <div className={cn(
                      "grid transition-[grid-template-rows,opacity,margin] duration-200 ease-in-out",
                      statusExpanded ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0 pointer-events-none mt-0"
                    )}>
                      <div className="overflow-hidden">
                        <div className="grid grid-cols-2 gap-1.5">
                          {([
                            { key: 'normal' as const, label: '正常', dot: 'bg-emerald-500' },
                            { key: 'warning' as const, label: '注意', dot: 'bg-amber-500' },
                            { key: 'risk' as const, label: '风险', dot: 'bg-rose-500' },
                            { key: 'offline' as const, label: '离线', dot: 'bg-gray-400' },
                          ]).map(({ key, label, dot }) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setActiveStatus(activeStatus === key ? null : key)}
                              className={cn(
                                'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors w-full',
                                activeStatus === key
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'bg-card text-foreground/80 border-border hover:bg-accent'
                              )}
                            >
                              <span className={cn("w-2 h-2 rounded-full shrink-0", activeStatus === key ? 'bg-white/80' : dot)} />
                              <span>{label}</span>
                              <span className="text-[10px] font-bold opacity-70 ml-auto">{filteredStatusCounts[key]}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <GlobalStats
                  onlineCount={globalStats.onlineCount}
                  totalCount={globalStats.totalCount}
                  totalNetIn={globalStats.totalNetIn}
                  totalNetOut={globalStats.totalNetOut}
                  totalTrafficIn={globalStats.totalTrafficIn}
                  totalTrafficOut={globalStats.totalTrafficOut}
                  regionCount={globalStats.regionCount}
                  bandwidthHistory={[...bandwidthHistoryRef.current]}
                  trafficHistory={[...trafficHistoryRef.current]}
                  netInHistory={[...netInHistoryRef.current]}
                  layout="vertical"
                  excludeOverview
                  excludeRegionCount
                />

                {allTags.length > 0 && (
                  <div className="rounded-xl border border-[#f0f0f0] dark:border-border/20 shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 bg-card text-card-foreground">
                    <h3 className="text-[11px] text-muted-foreground mb-2 font-medium">标签筛选</h3>
                    <TagFilter tags={allTags} active={activeTag} onChange={setActiveTag} />
                  </div>
                )}
              </div>
            </aside>
          )}

          {/* 右侧主内容区 */}
          <div className="flex-1 min-w-0">
            {!selectedNode ? (
              <div className="flex flex-col gap-6 animate-in fade-in duration-200">
                {/* 小屏幕下显示原始堆叠布局 */}
                {hasNodes && (
                  <div className="lg:hidden">
                    <GlobalStats
                      onlineCount={globalStats.onlineCount}
                      totalCount={globalStats.totalCount}
                      totalNetIn={globalStats.totalNetIn}
                      totalNetOut={globalStats.totalNetOut}
                      totalTrafficIn={globalStats.totalTrafficIn}
                      totalTrafficOut={globalStats.totalTrafficOut}
                      regionCount={globalStats.regionCount}
                      bandwidthHistory={[...bandwidthHistoryRef.current]}
                      trafficHistory={[...trafficHistoryRef.current]}
                      netInHistory={[...netInHistoryRef.current]}
                    />
                  </div>
                )}
                {hasNodes && (
                  <div className="lg:hidden">
                    <RegionFilter
                      regions={regions.list}
                      total={regions.total}
                      active={activeRegion}
                      onChange={setActiveRegion}
                      layout="vertical"
                    />
                  </div>
                )}
                {hasNodes && <div className="lg:hidden"><TagFilter tags={allTags} active={activeTag} onChange={setActiveTag} /></div>}
                {hasNodes && (
                  <div className="lg:hidden">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground font-medium">状态筛选</span>
                      {activeStatus && (
                        <button type="button" onClick={() => setActiveStatus(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">清除</button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {([
                        { key: 'normal' as const, label: '正常', dot: 'bg-emerald-500' },
                        { key: 'warning' as const, label: '注意', dot: 'bg-amber-500' },
                        { key: 'risk' as const, label: '风险', dot: 'bg-rose-500' },
                        { key: 'offline' as const, label: '离线', dot: 'bg-gray-400' },
                      ]).map(({ key, label, dot }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setActiveStatus(activeStatus === key ? null : key)}
                          className={cn(
                            'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors w-full',
                            activeStatus === key
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-card text-foreground/80 border-border hover:bg-accent'
                          )}
                        >
                          <span className={cn("w-2 h-2 rounded-full shrink-0", activeStatus === key ? 'bg-white/80' : dot)} />
                          <span>{label}</span>
                          <span className="text-[10px] font-bold opacity-70 ml-auto">{filteredStatusCounts[key]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {showInitialLoading && (
                  <div className="py-24 flex flex-col items-center gap-3 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-sm">连接后端中…</span>
                  </div>
                )}

                {showNoNodes && (
                  <div className="py-20 text-center text-muted-foreground">暂无节点</div>
                )}

                {noResults && (
                  <div className="py-20 flex flex-col items-center gap-3 text-center text-muted-foreground">
                    <div className="text-sm">暂无匹配节点</div>
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
                    >
                      清除筛选
                    </button>
                  </div>
                )}

                {hasResults && view === 'cards' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {list.map(n => (
                      <NodeCard key={n.uuid} node={n} latencyTracks={latencyTracks.get(n.uuid)} status={stableStatuses.get(n.uuid)} />
                    ))}
                  </div>
                )}
                {hasResults && view === 'table' && <NodeTable nodes={list} onOpen={setSelected} statuses={stableStatuses} />}
                {hasResults && view === 'map' && (
                  <Suspense
                    fallback={
                      <div className="py-24 flex items-center justify-center text-sm text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin mr-2" /> 加载地图中…
                      </div>
                    }
                  >
                    <WorldMap nodes={list} onOpen={setSelected} />
                  </Suspense>
                )}

                {hasErrors && (
                  <Alert variant="warning">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>{errors.length} 个后端错误</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc pl-5 space-y-1 mt-2">
                        {errors.map((e, i) => (
                          <li key={i}>
                            <b>{e.source}</b>：
                            {e.error instanceof Error ? e.error.message : String(e.error)}
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <NodeDetail
                node={selectedNode}
                onClose={() => {
                  setSelected(null)
                  window.scrollTo({ top: 0, behavior: 'instant' })
                }}
                showSource={(config.site_tokens?.length ?? 0) > 1}
                pool={pool}
              />
            )}
          </div>
        </div>
      </main>

      <Footer text={config.user_preferences.footer} repo={config.repository} dist_page={config.dist_page}/>
    </div>
  )
}
