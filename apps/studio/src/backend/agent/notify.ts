import { allStates } from '@/handlers/handlerState'
import rawLog from '@bksLogger'

const log = rawLog.scope('AgentNotify')

export function broadcast(type: string, input?: any): number {
  let sent = 0
  for (const s of allStates()) {
    if (!s?.port) continue
    try {
      s.port.postMessage({ type, input })
      sent++
    } catch (e) {
      log.warn('Could not push to window', e)
    }
  }
  return sent
}

export function requestAttention(title: string, body: string): void {
  try {
    process.parentPort?.postMessage({ type: 'agentAttention', title, body })
  } catch (e) {
    log.warn('Could not request attention', e)
  }
}
