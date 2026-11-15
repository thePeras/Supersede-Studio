<template>
  <div class="agent-activity">
    <div class="agent-activity-toolbar">
      <input
        class="form-control agent-search"
        type="text"
        placeholder="Filter by SQL, tool or connection"
        v-model="filters.search"
      >
      <select
        class="form-control"
        v-model="filters.kind"
      >
        <option value="all">
          All
        </option>
        <option value="read">
          Reads
        </option>
        <option value="write">
          Writes
        </option>
        <option
          v-for="(label, value) in categoryLabels"
          :key="value"
          :value="value"
        >
          {{ label }}
        </option>
      </select>
      <select
        class="form-control"
        v-model="filters.decision"
      >
        <option value="all">
          Any status
        </option>
        <option
          v-for="(label, value) in decisionLabels"
          :key="value"
          :value="value"
        >
          {{ label }}
        </option>
      </select>
      <select
        class="form-control"
        v-model="filters.client"
      >
        <option value="all">
          All clients
        </option>
        <option
          v-for="c in clients"
          :key="c"
          :value="c"
        >
          {{ c }}
        </option>
      </select>
      <div
        class="agent-view-toggle"
        role="group"
        aria-label="View"
      >
        <button
          v-for="option in viewOptions"
          :key="option.value"
          type="button"
          class="agent-view-option"
          :class="{ active: view === option.value }"
          :title="option.label"
          :aria-label="option.label"
          :aria-pressed="view === option.value ? 'true' : 'false'"
          @click="view = option.value"
        >
          <svg
            class="agent-view-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path :d="option.icon" />
          </svg>
        </button>
      </div>
      <a
        href="#"
        title="Refresh"
        @click.prevent="load"
      ><i class="material-icons">refresh</i></a>
      <a
        href="#"
        title="Clear activity"
        @click.prevent="clear"
      ><i class="material-icons">delete_sweep</i></a>
    </div>

    <x-progressbar v-if="loading" />
    <error-alert
      v-if="error"
      :error="error"
      title="Problem loading agent activity"
    />

    <div class="agent-activity-content">
      <div
        v-if="!loading && !activity.calls.length"
        class="agent-empty"
      >
        <mcp-icon />
        <p>No agent activity yet.</p>
        <p class="hint">
          Enable Agent Access on a connection, then add Supersede Studio to an agent in
          <a
            href="#"
            @click.prevent="$emit('setup')"
          >Setup</a>.
        </p>
      </div>

      <div
        v-else-if="!filteredCount"
        class="agent-empty"
      >
        <p>No calls match the filters.</p>
      </div>

      <template v-else-if="view === 'grouped'">
        <div
          v-for="node in tree"
          :key="node.session.id"
          class="agent-session"
        >
          <a
            href="#"
            class="agent-session-header"
            @click.prevent="toggleSession(node.session.id)"
          >
            <i class="material-icons">{{ collapsed[node.session.id] ? 'keyboard_arrow_right' : 'keyboard_arrow_down' }}</i>
            <span
              class="agent-session-label truncate"
              :title="node.session.cwd || node.label"
            >{{ node.label }}</span>
            <svg
              v-if="clientLogo(node.session.clientName)"
              class="agent-client-logo"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              :aria-label="node.clientLabel"
            >
              <title>{{ node.clientLabel }}</title>
              <path :d="clientLogo(node.session.clientName)" />
            </svg>
            <span
              v-else
              class="agent-chip"
            >{{ node.clientLabel }}</span>
            <span
              v-if="node.session.identitySource === 'model'"
              class="agent-chip agent-chip-muted"
              title="Session title reported by the model"
            >reported by model</span>
            <span class="agent-session-meta">{{ node.calls.length }} {{ node.calls.length === 1 ? 'call' : 'calls' }} · {{ timeAgo(node.lastAt) }}</span>
          </a>
          <div
            v-if="!collapsed[node.session.id]"
            class="agent-calls"
          >
            <agent-call-row
              v-for="call in node.calls"
              :key="call.id"
              :call="call"
              :label-color="colors[call.connectionId]"
              :focused="call.id === focusedCallId"
            />
          </div>
        </div>
      </template>

      <div
        v-else
        class="agent-calls agent-calls-flat"
      >
        <agent-call-row
          v-for="call in flatCalls"
          :key="call.id"
          :call="call"
          :session-label="sessionLabel(call.sessionId)"
          :label-color="colors[call.connectionId]"
          :focused="call.id === focusedCallId"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue, { PropType } from 'vue'
import _ from 'lodash'
import TimeAgo from 'javascript-time-ago'
import { mapState } from 'vuex'
import ErrorAlert from '@/components/common/ErrorAlert.vue'
import AgentCallRow from './AgentCallRow.vue'
import McpIcon from './McpIcon.vue'
import { loadConnectionColors } from './connectionColors'
import { buildActivityTree, clientOptions, filterCalls, ActivityFilters } from '@/lib/agent/activity'
import { clientDisplayName } from '@/lib/agent/identity'
import { logoForClientName } from './clientLogos'
import type { TransportAgentActivity } from '@/lib/agent/types'
import { decisionLabels } from './labels'
import { categoryLabels } from '@/lib/agent/policy'

export default Vue.extend({
  components: { ErrorAlert, AgentCallRow, McpIcon },
  props: {
    focusCall: { type: Object as PropType<{ id: number, at: number } | null>, default: null },
  },
  data() {
    return {
      focusedCallId: null as number | null,
      loaded: false,
      activity: { sessions: [], calls: [] } as TransportAgentActivity,
      loading: false,
      colors: {} as Record<number, string>,
      error: null,
      view: 'grouped' as 'grouped' | 'list',
      collapsed: {} as Record<number, boolean>,
      filters: {
        connectionId: null,
        kind: 'all',
        decision: 'all',
        client: 'all',
        search: '',
      } as ActivityFilters,
      timeAgoFormatter: new TimeAgo('en-US'),
      decisionLabels,
      categoryLabels,
      viewOptions: [
        { value: 'grouped', label: 'Group by session', icon: 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z' },
        { value: 'list', label: 'Flat list', icon: 'M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z' },
      ] as { value: 'grouped' | 'list', label: string, icon: string }[],
    }
  },
  computed: {
    ...mapState('agent', ['activityVersion']),
    sessionsById() {
      return new Map(this.activity.sessions.map((s) => [s.id, s]))
    },
    tree() {
      return buildActivityTree(this.activity.sessions, this.activity.calls, this.filters)
    },
    flatCalls() {
      return filterCalls(this.activity.calls, this.sessionsById, this.filters)
    },
    filteredCount(): number {
      return this.flatCalls.length
    },
    clients(): string[] {
      return clientOptions(this.activity.sessions)
    },
  },
  watch: {
    activityVersion() {
      this.debouncedLoad()
    },
    focusCall() {
      this.applyFocus()
    },
  },
  created() {
    this.debouncedLoad = _.debounce(this.load, 400)
  },
  async mounted() {
    await this.load()
  },
  methods: {
    async load() {
      this.loading = true
      try {
        this.activity = await this.$util.send('agent/activity', { limit: 1000 })
        this.colors = await loadConnectionColors().catch(() => this.colors)
        this.error = null
      } catch (e) {
        this.error = e
      } finally {
        this.loading = false
      }
      if (!this.loaded) {
        this.loaded = true
        this.applyFocus()
      }
    },
    applyFocus() {
      if (!this.focusCall || !this.loaded) return
      const call = this.activity.calls.find((c) => c.id === this.focusCall.id)
      if (!call) return
      if (!this.flatCalls.some((c) => c.id === call.id)) {
        this.filters = { connectionId: null, kind: 'all', decision: 'all', client: 'all', search: '' }
      }
      this.$set(this.collapsed, call.sessionId, false)
      this.focusedCallId = null
      this.$nextTick(() => {
        this.focusedCallId = call.id
        this.$nextTick(() => {
          const el = this.$el.querySelector(`[data-call-id="${call.id}"]`)
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        })
      })
    },
    async clear() {
      const confirmed = await this.$confirm('Clear agent activity?', 'All recorded agent sessions and calls will be removed. Queries in the connection history are kept.')
      if (!confirmed) return
      await this.$util.send('agent/clearActivity')
      await this.load()
    },
    toggleSession(id: number) {
      this.$set(this.collapsed, id, !this.collapsed[id])
    },
    sessionLabel(sessionId: number): string {
      const session = this.sessionsById.get(sessionId)
      if (!session) return ''
      return session.title || session.label || clientDisplayName(session.clientName)
    },
    clientLogo(clientName?: string | null): string | null {
      return logoForClientName(clientName)
    },
    timeAgo(value: number) {
      return this.timeAgoFormatter.format(new Date(value))
    },
  },
})
</script>

<style lang="scss" scoped>
.agent-activity {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.agent-activity-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;

  .form-control {
    width: auto;
    min-width: 8rem;
    margin: 0;
  }

  .agent-search {
    flex: 1;
    min-width: 14rem;
  }

}

.agent-view-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.12);
}

.agent-view-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  height: 1.6rem;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out;

  .agent-view-icon {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  &:hover:not(.active) {
    background: rgba(127, 127, 127, 0.16);
    color: var(--text-dark);
  }

  &.active {
    background: var(--theme-bg);
    color: var(--text-dark);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }

  &:focus-visible {
    outline: 2px solid rgba(127, 127, 127, 0.5);
    outline-offset: 1px;
  }
}

.agent-activity-content {
  flex: 1;
  overflow: auto;
  padding: 0 1.5rem 1.5rem;
}

.agent-empty {
  text-align: center;
  padding: 3rem 1rem;
  opacity: 0.8;

  .material-icons {
    font-size: 2.5rem;
    opacity: 0.5;
  }
}

.agent-session {
  border: 1px solid rgba(127, 127, 127, 0.2);
  border-radius: 4px;
  margin-bottom: 0.5rem;
}

.agent-session-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.65rem;
  color: inherit;
  text-decoration: none;
}

.agent-session-label {
  font-weight: 600;
  max-width: 40%;
}

.agent-session-meta {
  margin-left: auto;
  font-size: 0.8rem;
  opacity: 0.7;
  white-space: nowrap;
}

.agent-client-logo {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  fill: currentColor;
  opacity: 0.6;
}

.agent-chip {
  font-size: 0.7rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: rgba(127, 127, 127, 0.18);
  white-space: nowrap;
}

.agent-chip-muted {
  opacity: 0.7;
  font-style: italic;
}

.agent-calls {
  border-top: 1px solid rgba(127, 127, 127, 0.15);
}

.agent-calls-flat {
  border: 1px solid rgba(127, 127, 127, 0.2);
  border-radius: 4px;
}
</style>
