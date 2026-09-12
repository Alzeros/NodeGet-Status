import { useEffect, useState } from 'react'

export type StyleId = 'default' | 'neu' | 'term' | 'paper'

const KEY = 'nodeget.style'

function initial(): StyleId {
  const stored = localStorage.getItem(KEY)
  if (stored === 'neu' || stored === 'term' || stored === 'paper') return stored
  return 'default'
}

// 风格主题（玻璃拟态/新拟物），与 useTheme 的明暗模式正交：
// 挂在 <html data-style="..."> 上，CSS 选择器用 html[data-style='neu'] 覆盖，
// 默认风格不落任何属性，保持零开销。
export function useStyle() {
  const [style, setStyle] = useState<StyleId>(initial)

  useEffect(() => {
    if (style === 'default') delete document.documentElement.dataset.style
    else document.documentElement.dataset.style = style
    localStorage.setItem(KEY, style)
  }, [style])

  return { style, setStyle }
}
