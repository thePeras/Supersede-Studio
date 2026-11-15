<template>
  <div class="list-group agent-activity-list">
    <div class="list-heading row">
      <div class="sub row flex-middle expand">
        <div class="expand noselect">
          MCP Activity
          <span
            v-if="pendingApprovals"
            class="badge pending-badge"
            title="Waiting for approval"
          >{{ pendingApprovals }}</span>
        </div>
        <div class="actions">
          <a
            title="Agent setup"
            @click.prevent="open('setup')"
          >
            <hero-icon name="cog-6-tooth" />
          </a>
        </div>
      </div>
    </div>
    <nav class="list-body">
      <div
        v-if="!loading && !calls.length"
        class="empty-state"
      >
        No agent calls yet
      </div>
      <div
        v-for="call in calls"
        :key="call.id"
        class="list-item"
        :title="call.sql || call.tool"
      >
        <a
          href=""
          class="list-item-btn"
          @click.prevent="open('activity', call.id)"
        >
          <span
            class="connection-label"
            :class="`connection-label-color-${connectionColor(call)}`"
          />
          <div class="flex-col expand call-text">
            <div class="title truncate">
              {{ call.sql || call.tool }}
            </div>
            <div class="subtitle truncate">
              {{ subtitle(call) }}
            </div>
          </div>
          <span
            v-if="statusIcon(call)"
            class="call-status"
            :class="statusIcon(call).tone"
            :title="decisionTitle(call)"
          >
            <hero-icon :name="statusIcon(call).name" />
          </span>
        </a>
      </div>
    </nav>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import _ from 'lodash'
import TimeAgo from 'javascript-time-ago'
import { mapState } from 'vuex'
import { AppEvent } from '@/common/AppEvent'
import type { TransportAgentCall } from '@/lib/agent/types'
import { decisionLabels, displayError } from '@/components/agent/labels'
import { loadConnectionColors } from '@/components/agent/connectionColors'

const LIMIT = 50


export default Vue.extend({
  props: {
    privacyMode: Boolean,
  },
  data() {
    return {
      calls: [] as TransportAgentCall[],
      loading: false,
      colors: {} as Record<number, string>,
      timeAgo: new TimeAgo('en-US'),
    }
  },
  computed: {
    ...mapState('agent', ['activityVersion']),
    pendingApprovals(): number {
      return this.$store.state.agent?.pendingApprovals?.length ?? 0
    },
  },
  watch: {
    activityVersion() {
      this.debouncedLoad()
    },
  },
  created() {
    this.debouncedLoad = _.debounce(this.load, 400)
  },
  async mounted() {
    await this.load()
  },
  beforeDestroy() {
    this.debouncedLoad.cancel()
  },
  methods: {
    async load() {
      this.loading = true
      try {
        const activity = await this.$util.send('agent/activity', { limit: LIMIT })
        this.calls = _.orderBy(activity.calls, (c) => new Date(c.createdAt).getTime(), 'desc')
        this.colors = await loadConnectionColors().catch(() => this.colors)
      } catch (e) {
        this.calls = []
      } finally {
        this.loading = false
      }
    },
    subtitle(call: TransportAgentCall): string {
      const connection = this.privacyMode ? '******' : call.connectionName
      return [connection, this.timeAgo.format(new Date(call.createdAt), 'mini-now')]
        .filter(Boolean)
        .join(' · ')
    },
    connectionColor(call: TransportAgentCall): string {
      return (call.connectionId && this.colors[call.connectionId]) || 'default'
    },
    statusIcon(call: TransportAgentCall): { name: string, tone: string } | null {
      if (call.decision === 'blocked' || call.decision === 'denied') return { name: 'no-symbol', tone: 'tone-muted' }
      if (call.decision === 'timeout') return { name: 'clock', tone: 'tone-warning' }
      if (call.status !== 'ok') return { name: 'exclamation-circle', tone: 'tone-muted' }
      return null
    },
    decisionTitle(call: TransportAgentCall): string {
      if (call.status !== 'ok' && call.error) return displayError(call.error)
      return decisionLabels[call.decision] ?? call.decision
    },
    open(tab: 'activity' | 'setup', callId?: number) {
      this.trigger(AppEvent.openAgents, tab, callId)
    },
  },
})
</script>

<style lang="scss" scoped>
.list-item .list-item-btn {
  align-items: center;
}

.call-status {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  margin-left: 0.5rem;

  .hi-icon {
    font-size: 1rem;
  }

  &.tone-warning {
    color: var(--brand-warning);
  }

  &.tone-muted {
    color: var(--text-light);
  }
}

.call-text {
  min-width: 0;

  .title {
    font-family: monospace;
    font-size: 0.8rem;
  }
}

.pending-badge {
  background: var(--brand-danger);
  color: #fff;
}

.empty-state {
  padding-top: 0.25rem;
  padding-left: 0.5rem;
  font-size: 0.85rem;
  opacity: 0.7;
}
</style>
