import net from 'net'
import fs from 'fs'
import path from 'path'
import { RELAY_ENV_ALLOWLIST } from '@/lib/agent/identity'

const RELAY_VERSION = 1
const RETRY_MS = 3000
const REPLAY_ID = '__supersedure_relay_initialize__'
const NOT_RUNNING = 'Supersedure Studio is not running. Open Supersedure Studio to use agent access.'

type JsonRpc = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: any
  result?: any
  error?: any
}

type State = 'offline' | 'connecting' | 'online'

let state: State = 'offline'
let socket: net.Socket | null = null
let helloDone = false
let initRequest: JsonRpc | null = null
let clientInitialized = false
let answeredLocally = false
let replaying = false
const inflight = new Set<string | number>()
const queue: string[] = []

function writeStdout(message: JsonRpc) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function logErr(...args: any[]) {
  process.stderr.write(`[supersedure-relay] ${args.join(' ')}\n`)
}

function lineSplitter(onLine: (line: string) => void) {
  let buffer = ''
  return (chunk: Buffer | string) => {
    buffer += chunk.toString('utf8')
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      if (line.trim()) onLine(line)
      index = buffer.indexOf('\n')
    }
  }
}

function parse(line: string): JsonRpc | null {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function readEndpoint(): { socketPath: string, token: string } | null {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'endpoint.json'), 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed.socketPath === 'string' && typeof parsed.token === 'string') return parsed
  } catch {
    return null
  }
  return null
}

function helloPayload(token: string) {
  const env: Record<string, string> = {}
  for (const key of RELAY_ENV_ALLOWLIST) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return {
    type: 'hello',
    token,
    pid: process.pid,
    ppid: process.ppid,
    cwd: process.cwd(),
    env,
    relayVersion: RELAY_VERSION,
  }
}

function respondOffline(message: JsonRpc) {
  if (message.id === undefined || message.id === null) return
  switch (message.method) {
    case 'initialize':
      answeredLocally = true
      writeStdout({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'supersedure-studio', version: String(RELAY_VERSION) },
          instructions: NOT_RUNNING,
        },
      })
      return
    case 'ping':
      writeStdout({ jsonrpc: '2.0', id: message.id, result: {} })
      return
    case 'tools/list':
      writeStdout({ jsonrpc: '2.0', id: message.id, result: { tools: [] } })
      return
    case 'resources/list':
      writeStdout({ jsonrpc: '2.0', id: message.id, result: { resources: [] } })
      return
    case 'prompts/list':
      writeStdout({ jsonrpc: '2.0', id: message.id, result: { prompts: [] } })
      return
    default:
      writeStdout({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: NOT_RUNNING } })
  }
}

function forward(line: string, message: JsonRpc) {
  if (message.method && message.id !== undefined && message.id !== null) {
    inflight.add(message.id)
  }
  socket.write(line + '\n')
}

function handleClientLine(line: string) {
  const message = parse(line)
  if (!message) return

  if (message.method === 'initialize') {
    initRequest = message
    answeredLocally = false
  }
  if (message.method === 'notifications/initialized') {
    clientInitialized = true
  }

  if (state === 'connecting' || replaying) {
    queue.push(line)
    return
  }
  if (state === 'online') {
    forward(line, message)
    return
  }
  respondOffline(message)
  if (message.method === 'tools/call') connect()
}

function handleServerLine(line: string) {
  if (!helloDone) {
    const reply = parse(line)
    if (reply?.['type'] === 'hello-ok') {
      helloDone = true
      goOnline()
    } else {
      logErr('handshake rejected:', reply?.['message'] ?? line)
      socket?.destroy()
    }
    return
  }

  const message = parse(line)
  if (!message) return

  if (message.id === REPLAY_ID) {
    replaying = false
    socket?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    writeStdout({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    flushQueue()
    return
  }
  if (message.id !== undefined && message.id !== null && !message.method) {
    inflight.delete(message.id)
  }
  process.stdout.write(line + '\n')
}

function flushQueue() {
  const pending = queue.splice(0)
  for (const line of pending) {
    const message = parse(line)
    if (message) handleClientLine(line)
  }
}

function goOnline() {
  state = 'online'
  if (initRequest && answeredLocally) {
    replaying = true
    socket.write(JSON.stringify({ ...initRequest, id: REPLAY_ID }) + '\n')
    return
  }
  flushQueue()
}

function goOffline() {
  const wasOnline = state === 'online'
  state = 'offline'
  socket = null
  helloDone = false
  replaying = false
  for (const id of inflight) {
    writeStdout({ jsonrpc: '2.0', id, error: { code: -32000, message: NOT_RUNNING } })
  }
  inflight.clear()
  if (initRequest && !answeredLocally) answeredLocally = true
  if (wasOnline && clientInitialized) {
    writeStdout({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
  }
  const pending = queue.splice(0)
  for (const line of pending) {
    const message = parse(line)
    if (message) respondOffline(message)
  }
}

function connect() {
  if (state !== 'offline') return
  const endpoint = readEndpoint()
  if (!endpoint) return
  state = 'connecting'
  const s = net.createConnection(endpoint.socketPath)
  socket = s
  s.setEncoding('utf8')
  s.on('connect', () => {
    s.write(JSON.stringify(helloPayload(endpoint.token)) + '\n')
  })
  s.on('data', lineSplitter(handleServerLine))
  s.on('error', () => {
    s.destroy()
  })
  s.on('close', () => {
    if (socket === s || socket === null) goOffline()
  })
}

process.stdin.on('data', lineSplitter(handleClientLine))
process.stdin.on('end', () => {
  socket?.end()
  process.exit(0)
})

setInterval(() => {
  if (state === 'offline' && !replaying) connect()
}, RETRY_MS).unref()

connect()
