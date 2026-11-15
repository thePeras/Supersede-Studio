import crypto from 'crypto'
import fs from 'fs'
import net from 'net'
import type { RelayHello } from '@/lib/agent/types'
import { SocketTransport } from './SocketTransport'
import rawLog from '@bksLogger'

const log = rawLog.scope('AgentServer')

const HELLO_TIMEOUT_MS = 5000
const MAX_LINE_BYTES = 8 * 1024 * 1024

export type SessionFactory = (transport: SocketTransport, hello: RelayHello) => Promise<void>

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(String(a ?? ''))
  const bb = Buffer.from(String(b ?? ''))
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

function isSocketInUse(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createConnection(socketPath)
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })
}

export class AgentServer {
  private server: net.Server | null = null
  private sockets = new Set<net.Socket>()

  constructor(private socketPath: string, private token: string, private createSession: SessionFactory) {}

  async listen(): Promise<void> {
    if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
      if (await isSocketInUse(this.socketPath)) {
        throw new Error('Another Supersede Studio instance is already serving agents')
      }
      fs.unlinkSync(this.socketPath)
    }
    const server = net.createServer((socket) => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.socketPath, () => {
        server.off('error', reject)
        resolve()
      })
    })
    if (process.platform !== 'win32') {
      fs.chmodSync(this.socketPath, 0o600)
    }
    server.on('error', (e) => log.error('Agent server error', e))
    this.server = server
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    const server = this.server
    this.server = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(this.socketPath)
      } catch {
        return
      }
    }
  }

  connectionCount(): number {
    return this.sockets.size
  }

  private accept(socket: net.Socket) {
    this.sockets.add(socket)
    socket.on('close', () => this.sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    socket.setEncoding('utf8')

    let buffer = ''
    let transport: SocketTransport | null = null
    let handshaking = true
    const helloTimer = setTimeout(() => {
      if (handshaking) socket.destroy()
    }, HELLO_TIMEOUT_MS)

    const handleLine = (line: string) => {
      if (transport) {
        transport.receive(line)
        return
      }
      if (!handshaking) return
      handshaking = false
      clearTimeout(helloTimer)
      let hello: RelayHello
      try {
        hello = JSON.parse(line)
      } catch {
        socket.end(JSON.stringify({ type: 'hello-error', message: 'invalid handshake' }) + '\n')
        return
      }
      if (hello?.type !== 'hello' || !tokensMatch(hello.token, this.token)) {
        socket.end(JSON.stringify({ type: 'hello-error', message: 'invalid token' }) + '\n')
        return
      }
      const created = new SocketTransport(socket)
      transport = created
      socket.write(JSON.stringify({ type: 'hello-ok' }) + '\n')
      this.createSession(created, { ...hello, token: '' }).catch((e) => {
        log.error('Could not start agent session', e)
        socket.destroy()
      })
    }

    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > MAX_LINE_BYTES) {
        log.warn('Agent message too large, closing connection')
        socket.destroy()
        return
      }
      let index = buffer.indexOf('\n')
      while (index !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1)
        if (line.trim()) handleLine(line)
        index = buffer.indexOf('\n')
      }
    })
  }
}
