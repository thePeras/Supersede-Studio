import { describe, it, expect, vi, afterEach } from 'vitest'
import { AgentApprovals } from '@/backend/agent/AgentApprovals'

const input = {
  sessionLabel: 'feature-x',
  clientName: 'Claude Code',
  connectionId: 1,
  connectionName: 'prod',
  database: null,
  sql: 'delete from users',
  categories: ['delete' as const],
}

function setup(timeoutMs = 1000) {
  const notifier = { requested: vi.fn(), resolved: vi.fn() }
  const approvals = new AgentApprovals(notifier, timeoutMs)
  return { notifier, approvals }
}

describe('AgentApprovals', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('announces a request and resolves with the decision', async () => {
    const { notifier, approvals } = setup()
    const promise = approvals.request(input)
    expect(notifier.requested).toHaveBeenCalledTimes(1)
    const request = notifier.requested.mock.calls[0][0]
    expect(approvals.list().map((r) => r.id)).toEqual([request.id])

    expect(approvals.decide(request.id, true)).toBe(true)
    await expect(promise).resolves.toBe('approved')
    expect(notifier.resolved).toHaveBeenCalledWith(request.id, 'approved')
    expect(approvals.list()).toEqual([])
  })

  it('only accepts the first decision', async () => {
    const { notifier, approvals } = setup()
    const promise = approvals.request(input)
    const { id } = notifier.requested.mock.calls[0][0]
    approvals.decide(id, false)
    expect(approvals.decide(id, true)).toBe(false)
    await expect(promise).resolves.toBe('denied')
  })

  it('times out as a denial', async () => {
    vi.useFakeTimers()
    const { approvals } = setup(5000)
    const promise = approvals.request(input)
    vi.advanceTimersByTime(5000)
    await expect(promise).resolves.toBe('timeout')
  })

  it('denies when the agent cancels the call', async () => {
    const { approvals } = setup()
    const controller = new AbortController()
    const promise = approvals.request(input, controller.signal)
    controller.abort()
    await expect(promise).resolves.toBe('denied')
  })

  it('denies at once when the call is already cancelled', async () => {
    const { notifier, approvals } = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(approvals.request(input, controller.signal)).resolves.toBe('denied')
    expect(notifier.requested).not.toHaveBeenCalled()
    expect(approvals.list()).toEqual([])
  })

  it('removes the abort listener once decided', async () => {
    const { notifier, approvals } = setup()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const promise = approvals.request(input, controller.signal)
    approvals.decide(notifier.requested.mock.calls[0][0].id, true)
    await expect(promise).resolves.toBe('approved')
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('denies everything on shutdown', async () => {
    const { approvals } = setup()
    const a = approvals.request(input)
    const b = approvals.request(input)
    approvals.cancelAll()
    await expect(Promise.all([a, b])).resolves.toEqual(['denied', 'denied'])
  })

  it('sets an expiry for the dialog countdown', () => {
    const { notifier, approvals } = setup(1000)
    approvals.request(input)
    const request = notifier.requested.mock.calls[0][0]
    expect(request.expiresAt - request.requestedAt).toBe(1000)
    approvals.cancelAll()
  })
})
