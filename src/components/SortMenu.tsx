import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '../utils/cn'
import { nextSort } from '../utils/tableSort'
import type { Sort, SortDir } from '../types'

const OPTIONS: { value: Sort; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'name', label: '名称' },
  { value: 'region', label: '地区' },
  { value: 'status', label: '异常优先' },
  { value: 'latency', label: '延迟' },
  { value: 'cpu', label: 'CPU 占用' },
  { value: 'mem', label: '内存占用' },
  { value: 'disk', label: '磁盘占用' },
  { value: 'netIn', label: '下行速度' },
  { value: 'netOut', label: '上行速度' },
  { value: 'uptime', label: '在线时长' },
  { value: 'traffic', label: '周期流量' },
  { value: 'trafficPct', label: '流量占比' },
  { value: 'expire', label: '到期时间' },
]

export function SortMenu({
  value,
  dir,
  onChange,
  align = 'right',
}: {
  value: Sort
  dir: SortDir
  onChange: (v: Sort, d: SortDir) => void
  /** 菜单贴按钮的哪一边展开：导航栏里靠右，节点页顶栏里按钮靠左，得往右展开 */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = OPTIONS.find(o => o.value === value) ?? OPTIONS[0]
  const DirIcon = dir === 'asc' ? ArrowUp : ArrowDown

  useEffect(() => {
    if (open) setShow(true)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="gap-1.5"
      >
        <DirIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{current.label}</span>
      </Button>
      {show && (
        <div
          data-state={open ? 'open' : 'closed'}
          onAnimationEnd={() => {
            if (!open) setShow(false)
          }}
          className={cn(
            'absolute mt-1 w-36 z-20 rounded-md border bg-popover shadow-md py-1 fill-mode-forwards data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            align === 'left' ? 'left-0 origin-top-left' : 'right-0 origin-top-right',
          )}
        >
          {OPTIONS.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(...nextSort(value, dir, o.value))
                setOpen(false)
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 text-sm hover:bg-accent"
            >
              <span>{o.label}</span>
              {o.value === value && <DirIcon className="h-3.5 w-3.5" />}
            </button>
          ))}
          <div className="mt-1 border-t border-border/60 px-2.5 pt-1.5 text-[10px] text-muted-foreground">
            再点一次当前项可反向
          </div>
        </div>
      )}
    </div>
  )
}
