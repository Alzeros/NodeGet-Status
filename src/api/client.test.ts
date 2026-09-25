import { afterEach, describe, test, expect, vi } from 'vitest'
import { RpcClient } from './client'

// 可控的 WebSocket 替身：何时握手成功、何时断开、回什么，都由测试决定
class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.onclose?.({ code: 1006 })
  }

  accept() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  replyLast(result: unknown) {
    const { id } = JSON.parse(this.sent[this.sent.length - 1])
    this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id, result }) })
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  FakeWebSocket.instances = []
})

describe('RpcClient', () => {
  test('首连没握手就断开，重连成功后新的调用能正常发出', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const client = new RpcClient('wss://backend.example', 'token', 'test')
    const firstOpen = client.opened
    firstOpen.catch(() => {})
    FakeWebSocket.instances[0].close()
    await expect(firstOpen).rejects.toThrow()

    await vi.advanceTimersByTimeAsync(2000) // RECONNECT_DELAY_MS
    expect(FakeWebSocket.instances).toHaveLength(2)
    FakeWebSocket.instances[1].accept()

    const call = client.call<{ uuids: string[] }>('nodeget-server_list_all_agent_uuid')
    await vi.advanceTimersByTimeAsync(0)
    FakeWebSocket.instances[1].replyLast({ uuids: ['a'] })
    await expect(call).resolves.toEqual({ uuids: ['a'] })
    client.close()
  })
})
