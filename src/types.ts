export interface NodeMeta {
  name: string
  region: string
  tags: string[]
  hidden: boolean
  virtualization: string
  lat: number | null
  lng: number | null
  order: number
  price: number
  priceUnit: string
  priceCycle: number
  expireTime: string
  trafficLimit?: number
  trafficResetDay: number
  /**
   * 流量计费口径。dual（默认）= 双向合计计入额度；max = 单向计费，
   * 取上/下行较大者计入额度（商家给的 limit 是单向额度）。
   * 主控 metadata 字段：metadata_traffic_billing_mode = "max"
   */
  trafficBillingMode: TrafficBillingMode
}

export type TrafficBillingMode = 'dual' | 'max'

export interface StaticSystem {
  system_name?: string
  system_host_name?: string
  system_kernel?: string
  system_kernel_version?: string
  system_os_version?: string
  system_os_long_version?: string
  distribution_id?: string
  arch?: string
  virtualization?: string
  cpu_arch?: string
  system_version?: string
}

export interface StaticCpu {
  brand?: string
  per_core?: { id: number; brand: string; frequency: number }[]
  physical_cores?: number
  logical_cores?: number
}

export interface StaticData {
  uuid?: string
  timestamp?: number
  system?: StaticSystem
  cpu?: StaticCpu
  gpu?: unknown[]
}

export interface DynamicSummary {
  uuid: string
  timestamp: number
  cpu_usage?: number
  used_memory?: number
  total_memory?: number
  available_memory?: number
  used_swap?: number
  total_swap?: number
  total_space?: number
  available_space?: number
  receive_speed?: number
  transmit_speed?: number
  total_received?: number
  total_transmitted?: number
  read_speed?: number
  write_speed?: number
  load_one?: number
  load_five?: number
  load_fifteen?: number
  uptime?: number
  boot_time?: number
  process_count?: number
  tcp_connections?: number
  udp_connections?: number
}

export interface HistorySample {
  t: number
  cpu: number | null
  mem: number | null
  disk: number | null
  netIn: number
  netOut: number
}

export interface Node {
  uuid: string
  source: string
  online: boolean
  meta: NodeMeta
  static: StaticData
  dynamic: DynamicSummary | null
  history: HistorySample[]
  monthlyTraffic?: MonthlyTraffic
  /**
   * 自然日窗口用量（今日）。与 monthlyTraffic 同结构，cycleId 存窗口 id（YYYY-MM-DD）。
   * 窗口 id 由主控 worker 写定，所以这里是"主控本地时区的今天"。
   * 需要主控的采样 worker 支持 metadata_traffic_window，否则为 undefined。
   */
  dailyTraffic?: MonthlyTraffic
  /** 自然月窗口用量（当月）。同上，cycleId 存 YYYY-MM。 */
  calendarMonthTraffic?: MonthlyTraffic
}

export interface MonthlyTraffic {
  /** 窗口标识：计费周期桶存周期起始日，自然日/自然月桶存 YYYY-MM-DD / YYYY-MM */
  cycleId: string
  received: number
  transmitted: number
  lastReceived?: number
  lastTransmitted?: number
  total: number
  /** 计费口径用量：dual = total（双向），max = max(received, transmitted)。与 percent 同口径 */
  billed?: number
  limit?: number
  percent?: number
  startedAt: number
  updatedAt: number
}

export interface ThemeConfig {
  "name": string
  "description":string
  "author"?: string
  "repository"?: string
  "dist_page"?: string;
  "user_preferences_form":{
    version:string,
    items:any[]
  },
  "version"?: string
  "license"?: string
}

export interface UserConfig {
  "user_preferences":{
    site_name?: string
    site_logo?: string
    footer?: string
  },
  site_tokens: { 
    name: string; 
    backend_url: string; 
    token: string 
  }[]
}

export type SiteConfig = ThemeConfig & UserConfig

export interface TaskQueryResult {
  task_id: number
  timestamp: number
  uuid: string
  success: boolean
  error_message?: string | null
  cron_source?: string
  task_event_type?: Record<string, string>
  task_event_result: Record<string, unknown> | null
}

export interface TaskQueryCondition {
  task_id?: number
  uuid?: string
  timestamp_from_to?: [number, number]
  timestamp_from?: number
  timestamp_to?: number
  is_success?: boolean
  is_failure?: boolean
  is_running?: boolean
  type?: string
  cron_source?: string
  limit?: number
  last?: null
}

export type View = 'cards' | 'console' | 'mini' | 'table' | 'map' | 'stats'

export type SortDir = 'asc' | 'desc'

export type Sort =
  | 'default'
  | 'name'
  | 'region'
  | 'status'
  | 'latency'
  | 'cpu'
  | 'mem'
  | 'disk'
  | 'netIn'
  | 'netOut'
  | 'uptime'
  | 'traffic'
  | 'trafficPct'
  | 'expire'

export type LatencyType = 'ping' | 'tcp_ping'

export interface Usage {
  cpu?: number
  mem?: number
  memUsed: number
  memTotal: number
  disk?: number
  diskUsed: number
  diskTotal: number
  netIn?: number
  netOut?: number
  uptime?: number
  ts?: number
  trafficIn?: number
  trafficOut?: number
}
