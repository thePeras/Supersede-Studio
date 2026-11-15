import net from 'net'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js'

export class SocketTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  private closed = false
  private backlog: JSONRPCMessage[] = []

  constructor(private socket: net.Socket) {
    socket.on('close', () => this.handleClose())
    socket.on('error', (error) => this.onerror?.(error))
  }

  async start(): Promise<void> {
    const pending = this.backlog.splice(0)
    for (const message of pending) this.onmessage?.(message)
  }

  receive(line: string): void {
    let message: JSONRPCMessage
    try {
      message = JSONRPCMessageSchema.parse(JSON.parse(line))
    } catch (error) {
      this.onerror?.(error as Error)
      return
    }
    if (this.onmessage) {
      this.onmessage(message)
    } else {
      this.backlog.push(message)
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed || this.socket.destroyed) return
    this.socket.write(JSON.stringify(message) + '\n')
  }

  async close(): Promise<void> {
    this.socket.end()
    this.handleClose()
  }

  private handleClose() {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
}
