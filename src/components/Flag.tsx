import { useState } from 'react'
import { cn } from '../utils/cn'

// A→🇦 区域指示符偏移：0x1F1E6 - 'A'(65)
const REGIONAL_OFFSET = 0x1f1a5

function flagEmoji(code: string) {
  return String.fromCodePoint(
    ...[...code].map(ch => REGIONAL_OFFSET + ch.charCodeAt(0)),
  )
}

export function Flag({ code, className }: { code?: string | null; className?: string }) {
  // flagcdn 在部分网络环境不可达，失败时降级为 emoji 国旗（无网络依赖）
  const [failed, setFailed] = useState(false)
  let c = code?.trim().toUpperCase() || ''
  if (!/^[A-Z]{2}$/.test(c)) return null
  if (c === 'TW') c = 'CN'

  if (failed) {
    return (
      <span
        title={c}
        aria-label={c}
        className={cn('inline-block text-sm leading-none select-none', className)}
      >
        {flagEmoji(c)}
      </span>
    )
  }

  return (
    <img
      src={`https://flagcdn.com/${c.toLowerCase()}.svg`}
      alt={c}
      title={c}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('inline-block w-5 h-3.5 rounded-[1px] object-cover shadow-sm', className)}
    />
  )
}
