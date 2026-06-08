import { useEffect, useMemo, useRef, useState } from 'react'
import type { Node } from '../types'
import type { AbnormalCounters } from '../utils/stableStatus'
import { loadCounters, saveCounters, updateSingleCounter, getStableStatus } from '../utils/stableStatus'

export function useStableStatus(nodes: Map<string, Node>) {
  const [counters, setCounters] = useState<Map<string, AbnormalCounters>>(() => loadCounters())
  const processedRef = useRef<Map<string, number>>(new Map())
  const saveTimerRef = useRef(0)
  const pendingSaveRef = useRef<Map<string, AbnormalCounters> | null>(null)

  useEffect(() => {
    setCounters(prev => {
      let changed = false
      const next = new Map(prev)
      const activeIds = new Set<string>()

      for (const n of nodes.values()) {
        if (n.meta?.hidden) continue
        activeIds.add(n.uuid)

        const ts = n.dynamic?.timestamp
        const lastTs = processedRef.current.get(n.uuid)

        if (ts && ts !== lastTs) {
          processedRef.current.set(n.uuid, ts)
          const existing = next.get(n.uuid)
          const updated = updateSingleCounter(n, existing)

          if (!existing ||
            existing.cpu !== updated.cpu ||
            existing.memory !== updated.memory ||
            existing.disk !== updated.disk ||
            existing.tcp !== updated.tcp ||
            existing.udp !== updated.udp ||
            existing.process !== updated.process
          ) {
            next.set(n.uuid, updated)
            changed = true
          }
        }
      }

      for (const uuid of next.keys()) {
        if (!activeIds.has(uuid)) {
          next.delete(uuid)
          processedRef.current.delete(uuid)
          changed = true
        }
      }

      if (changed) {
        clearTimeout(saveTimerRef.current)
        pendingSaveRef.current = next
        saveTimerRef.current = window.setTimeout(() => {
          saveCounters(next)
          pendingSaveRef.current = null
        }, 2000)
        return next
      }
      return prev
    })
  }, [nodes])

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      clearTimeout(saveTimerRef.current)
      if (pendingSaveRef.current) saveCounters(pendingSaveRef.current)
    }
  }, [])

  const statuses = useMemo(() => {
    const map = new Map<string, 'normal' | 'warning' | 'risk' | 'offline'>()
    for (const n of nodes.values()) {
      map.set(n.uuid, getStableStatus(n, counters.get(n.uuid)))
    }
    return map
  }, [nodes, counters])

  return { counters, statuses }
}
