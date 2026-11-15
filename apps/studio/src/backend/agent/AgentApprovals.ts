import { uuidv4 } from '@/lib/uuid'
import type { AgentApprovalRequest } from '@/lib/agent/types'

export type ApprovalOutcome = 'approved' | 'denied' | 'timeout'

export const APPROVAL_TIMEOUT_MS = 180_000

interface Pending {
  request: AgentApprovalRequest
  resolve: (outcome: ApprovalOutcome) => void
  timer: NodeJS.Timeout
  detach?: () => void
}

export interface ApprovalNotifier {
  requested(request: AgentApprovalRequest): void
  resolved(id: string, outcome: ApprovalOutcome): void
}

export class AgentApprovals {
  private pending = new Map<string, Pending>()

  constructor(private notifier: ApprovalNotifier, private timeoutMs = APPROVAL_TIMEOUT_MS) {}

  request(input: Omit<AgentApprovalRequest, 'id' | 'requestedAt' | 'expiresAt'>, signal?: AbortSignal): Promise<ApprovalOutcome> {
    const now = Date.now()
    const request: AgentApprovalRequest = {
      ...input,
      id: uuidv4(),
      requestedAt: now,
      expiresAt: now + this.timeoutMs,
    }
    if (signal?.aborted) return Promise.resolve('denied')
    return new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => this.finish(request.id, 'timeout'), this.timeoutMs)
      const onAbort = () => this.finish(request.id, 'denied')
      const detach = signal ? () => signal.removeEventListener('abort', onAbort) : undefined
      this.pending.set(request.id, { request, resolve, timer, detach })
      signal?.addEventListener('abort', onAbort, { once: true })
      this.notifier.requested(request)
    })
  }

  decide(id: string, approved: boolean): boolean {
    return this.finish(id, approved ? 'approved' : 'denied')
  }

  list(): AgentApprovalRequest[] {
    return Array.from(this.pending.values()).map((p) => p.request)
  }

  cancelAll(): void {
    for (const id of Array.from(this.pending.keys())) {
      this.finish(id, 'denied')
    }
  }

  private finish(id: string, outcome: ApprovalOutcome): boolean {
    const entry = this.pending.get(id)
    if (!entry) return false
    this.pending.delete(id)
    clearTimeout(entry.timer)
    entry.detach?.()
    entry.resolve(outcome)
    this.notifier.resolved(id, outcome)
    return true
  }
}
