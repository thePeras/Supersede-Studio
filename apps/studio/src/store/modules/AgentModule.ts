import { Module } from 'vuex'
import Vue from 'vue'
import _ from 'lodash'
import { State as RootState } from '../index'
import type { AgentApprovalRequest, AgentClientState, AgentServerInfo } from '@/lib/agent/types'
import rawLog from '@bksLogger'

const log = rawLog.scope('AgentModule')

interface State {
  initialized: boolean
  pendingApprovals: AgentApprovalRequest[]
  activityVersion: number
  status: (AgentServerInfo & { clients: number, openConnectionIds?: number[] }) | null
  clients: AgentClientState[] | null
}

export const AgentModule: Module<State, RootState> = {
  namespaced: true,
  state: () => ({
    initialized: false,
    pendingApprovals: [],
    activityVersion: 0,
    status: null,
    clients: null,
  }),
  getters: {
    currentApproval(state): AgentApprovalRequest | null {
      return state.pendingApprovals[0] ?? null
    },
    hasProvider(state): boolean | null {
      if (!state.clients) return null
      return state.clients.some((c) => c.status === 'configured' || c.status === 'outdated')
    },
  },
  mutations: {
    initialized(state) {
      state.initialized = true
    },
    setPending(state, approvals: AgentApprovalRequest[]) {
      state.pendingApprovals = _.sortBy(approvals, 'requestedAt')
    },
    addPending(state, approval: AgentApprovalRequest) {
      if (state.pendingApprovals.some((a) => a.id === approval.id)) return
      state.pendingApprovals = _.sortBy([...state.pendingApprovals, approval], 'requestedAt')
    },
    removePending(state, id: string) {
      state.pendingApprovals = state.pendingApprovals.filter((a) => a.id !== id)
    },
    bumpActivity(state) {
      state.activityVersion++
    },
    setStatus(state, status) {
      state.status = status
    },
    setClients(state, clients: AgentClientState[]) {
      state.clients = clients
    },
  },
  actions: {
    async init(context) {
      if (context.state.initialized) return
      context.commit('initialized')
      const util = Vue.prototype.$util
      util.addListener('agentApprovalRequested', (request: AgentApprovalRequest) => {
        context.commit('addPending', request)
      })
      util.addListener('agentApprovalResolved', ({ id }: { id: string }) => {
        context.commit('removePending', id)
      })
      const refreshHistory = _.debounce(() => {
        context.dispatch('data/usedQueries/load', undefined, { root: true }).catch((e) => log.warn(e))
      }, 500)
      util.addListener('agentActivity', () => {
        context.commit('bumpActivity')
        refreshHistory()
      })
      util.addListener('agentStatus', (status) => {
        context.commit('setStatus', status)
      })
      await Promise.all([
        context.dispatch('loadPending'),
        context.dispatch('refreshStatus'),
      ])
    },
    async loadPending(context) {
      try {
        const pending = await Vue.prototype.$util.send('agent/pendingApprovals')
        context.commit('setPending', pending ?? [])
      } catch (e) {
        log.warn('Could not load pending approvals', e)
      }
    },
    async refreshStatus(context) {
      try {
        context.commit('setStatus', await Vue.prototype.$util.send('agent/status'))
      } catch (e) {
        log.warn('Could not load agent status', e)
      }
    },
    async loadClients(context) {
      try {
        context.commit('setClients', await Vue.prototype.$util.send('agent/clients'))
      } catch (e) {
        log.warn('Could not load agent clients', e)
      }
    },
    async decide(context, { id, approved }: { id: string, approved: boolean }) {
      context.commit('removePending', id)
      await Vue.prototype.$util.send('agent/decideApproval', { id, approved })
    },
  },
}
