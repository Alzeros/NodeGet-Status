import { Card } from './ui/card'

/*
 * 节点卡骨架屏。
 *
 * 节点 uuid 列表(listAgentUuids)会比元数据(metadata_name 等)先到，
 * 此时 displayName() 只能回退成 uuid.slice(0,8)，页面会先显示一串哈希
 * 再突然换成真实节点名 —— 一次很明显的内容闪烁。
 * 用骨架屏占住这段时间，等元数据到齐后一次性呈现真实内容。
 *
 * 结构刻意对齐 NodeCard：头部 / 系统信息 / 2x2 指标 / 网络质量三行 / 底部统计，
 * 以尽量减少骨架切换为真实卡片时的高度跳动。
 */

function Bar({ className }: { className?: string }) {
  return <div className={`rounded bg-muted-foreground/15 ${className ?? ''}`} />
}

export function NodeCardSkeleton() {
  return (
    <Card className="p-4 flex flex-col gap-3 animate-pulse hover:translate-y-0" aria-hidden>
      {/* 头部：状态点 + 图标 + 主机名 + 旗标 */}
      <div className="flex items-center gap-2">
        <Bar className="h-2 w-2 shrink-0 rounded-full" />
        <Bar className="h-5 w-5 shrink-0" />
        <Bar className="h-4 flex-1 max-w-[55%]" />
        <Bar className="h-3 w-5 shrink-0" />
      </div>

      {/* 系统信息行 */}
      <Bar className="h-3 w-3/5" />

      <div className="flex flex-col gap-3.5">
        {/* 2x2 指标区：标签 + 值 + 进度条 + 详情 */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="min-w-0">
              <div className="flex justify-between gap-2">
                <Bar className="h-3 w-10" />
                <Bar className="h-3 w-8" />
              </div>
              <Bar className="h-1.5 w-full mt-1" />
              <Bar className="h-2.5 w-4/5 mt-1" />
            </div>
          ))}
        </div>

        {/* 网络质量 (24h)：标题 + CM/CU/CT 三行 */}
        <div className="flex flex-col gap-[6px]">
          <Bar className="h-3 w-20" />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-[6px]">
              <Bar className="h-2.5 w-7 shrink-0" />
              <Bar className="h-[10px] flex-1" />
            </div>
          ))}
        </div>
      </div>

      {/* 底部统计：上下行速度 / 在线时长 */}
      <div className="pt-2.5 border-t border-dashed space-y-1.5">
        <div className="flex items-center gap-3">
          <Bar className="h-3 w-16" />
          <Bar className="h-3 w-16" />
        </div>
        <div className="flex items-center gap-3">
          <Bar className="h-3 w-20" />
          <Bar className="h-3 w-12 ml-auto" />
        </div>
      </div>
    </Card>
  )
}

export function NodeCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }, (_, i) => (
        <NodeCardSkeleton key={i} />
      ))}
    </div>
  )
}
