import { useState } from 'react'
import { distroLogo } from '../utils/derive'
import type { Node } from '../types'

/** 发行版 logo：纯装饰，加载失败时直接隐藏，不留碎图占位 */
export function DistroLogo({ node, className }: { node: Node; className?: string }) {
  const [failed, setFailed] = useState(false)
  const url = distroLogo(node)
  if (!url || failed) return null
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  )
}
