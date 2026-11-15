<template>
  <div class="agent-setup">
    <div class="agent-setup-content">
      <div
        v-if="status && !status.running"
        class="alert alert-danger"
      >
        <hero-icon name="exclamation-circle" />
        <div>{{ serverError }}</div>
      </div>

      <p class="agent-setup-intro">
        Agents can only connect if <strong>Agent Access</strong> is enabled in the connection and <strong>Supersede Studio is open</strong>.
      </p>

      <x-progressbar v-if="loading" />
      <error-alert
        v-if="error"
        :error="error"
        title="Problem loading agent clients"
      />

      <div
        v-for="client in clients"
        :key="client.id"
        class="agent-client"
      >
        <div class="agent-client-header">
          <div class="agent-client-name">
            <svg
              v-if="logos[client.id]"
              class="agent-client-logo"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              :aria-label="client.name"
            >
              <path :d="logos[client.id]" />
            </svg>
            <span>{{ client.name }}</span>
            <span
              v-if="!client.detected"
              class="agent-client-detected"
            >Not detected</span>
          </div>
          <span
            class="agent-client-status"
            :class="`status-${client.status}`"
          >{{ statusLabel(client.status) }}</span>
          <span class="expand" />
          <button
            v-if="client.status === 'configured' || client.status === 'outdated'"
            type="button"
            class="btn btn-flat btn-small"
            :disabled="busy[client.id]"
            @click="remove(client)"
          >
            Remove
          </button>
          <button
            v-if="client.canInstall && client.status !== 'configured'"
            type="button"
            class="btn btn-primary btn-small"
            :disabled="busy[client.id]"
            @click="install(client)"
          >
            {{ client.status === 'outdated' ? 'Update' : 'Add' }}
          </button>
        </div>
        <div class="agent-client-path">
          {{ client.configPath }}
        </div>
        <div
          v-if="client.error"
          class="agent-client-error"
        >
          {{ client.error }}
        </div>
        <div
          v-if="client.status === 'outdated'"
          class="agent-client-hint"
        >
          The registered command points to a different Supersede Studio executable. Update it to use this one.
        </div>
        <div
          v-if="restartHint[client.id]"
          class="agent-client-hint"
        >
          {{ restartHint[client.id] }}
        </div>
        <a
          href="#"
          class="agent-client-manual-toggle"
          @click.prevent="toggleManual(client.id)"
        >{{ manualOpen[client.id] ? 'Hide manual setup' : 'Manual setup' }}</a>
        <div
          v-if="manualOpen[client.id]"
          class="agent-client-manual"
        >
          <div class="agent-client-manual-label">
            {{ manualLabel(client) }}
          </div>
          <pre>{{ client.manual.text }}</pre>
          <a
            href="#"
            @click.prevent="copy(client.manual.text)"
          >Copy</a>
        </div>
      </div>

      <div
        v-if="status"
        class="agent-server-command"
      >
        <div class="agent-client-manual-label">
          Server command (for other MCP clients, stdio transport)
        </div>
        <pre>{{ commandPreview }}</pre>
        <a
          href="#"
          @click.prevent="copy(commandPreview)"
        >Copy</a>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import { mapState } from 'vuex'
import ErrorAlert from '@/components/common/ErrorAlert.vue'
import type { AgentClientId, AgentClientState, AgentClientStatus } from '@/lib/agent/types'
import { clientStatusLabels } from './labels'
import { clientLogos as logos } from './clientLogos'

const restartHints: Record<AgentClientId, string> = {
  'claude-code': 'Start a new Claude Code session to load it.',
  codex: 'Start a new Codex session to load it.',
  antigravity: 'Reload the MCP servers in Antigravity (Manage MCP Servers) to load it.',
  'claude-desktop': 'Quit and reopen Claude Desktop to load it.',
}

export default Vue.extend({
  components: { ErrorAlert },
  data() {
    return {
      clients: [] as AgentClientState[],
      loading: false,
      error: null,
      busy: {} as Record<string, boolean>,
      manualOpen: {} as Record<string, boolean>,
      restartHint: {} as Record<string, string>,
      logos,
    }
  },
  computed: {
    ...mapState('agent', ['status']),
    serverError(): string {
      return this.status?.error ? `The agent server is not running: ${this.status.error}` : 'The agent server is not running.'
    },
    commandPreview(): string {
      if (!this.status) return ''
      const env = Object.entries(this.status.env || {}).map(([k, v]) => `${k}=${v}`).join(' ')
      const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v)
      return [env, quote(this.status.command), ...this.status.args.map(quote)].filter(Boolean).join(' ')
    },
  },
  watch: {
    clients(clients: AgentClientState[]) {
      this.$store.commit('agent/setClients', clients)
    },
  },
  async mounted() {
    await Promise.all([this.load(), this.$store.dispatch('agent/refreshStatus')])
  },
  methods: {
    async load() {
      this.loading = true
      try {
        this.clients = await this.$util.send('agent/clients')
        this.error = null
      } catch (e) {
        this.error = e
      } finally {
        this.loading = false
      }
    },
    replace(state: AgentClientState) {
      this.clients = this.clients.map((c) => (c.id === state.id ? state : c))
    },
    async install(client: AgentClientState) {
      this.$set(this.busy, client.id, true)
      try {
        const state = await this.$util.send('agent/installClient', { client: client.id })
        this.replace(state)
        this.$set(this.restartHint, client.id, restartHints[client.id])
        this.$noty.success(`Supersede Studio added to ${client.name}`)
      } catch (e) {
        this.$noty.error(`Could not add to ${client.name}: ${e.message}`)
        this.$set(this.manualOpen, client.id, true)
      } finally {
        this.$set(this.busy, client.id, false)
      }
    },
    async remove(client: AgentClientState) {
      this.$set(this.busy, client.id, true)
      try {
        const state = await this.$util.send('agent/removeClient', { client: client.id })
        this.replace(state)
        this.$set(this.restartHint, client.id, '')
        this.$noty.success(`Supersede Studio removed from ${client.name}`)
      } catch (e) {
        this.$noty.error(`Could not remove from ${client.name}: ${e.message}`)
      } finally {
        this.$set(this.busy, client.id, false)
      }
    },
    toggleManual(id: string) {
      this.$set(this.manualOpen, id, !this.manualOpen[id])
    },
    manualLabel(client: AgentClientState): string {
      switch (client.manual.kind) {
        case 'command':
          return 'Run in a terminal:'
        case 'toml':
          return `Add to ${client.configPath}:`
        default:
          return `Merge into ${client.configPath}:`
      }
    },
    statusLabel(status: AgentClientStatus) {
      return clientStatusLabels[status] ?? status
    },
    async copy(text: string) {
      await this.$native.clipboard.writeText(text)
    },
  },
})
</script>

<style lang="scss" scoped>
.agent-setup {
  height: 100%;
  overflow: auto;
}

.agent-setup-content {
  padding: 1rem 1.5rem 1.5rem;
  max-width: 820px;
}

.agent-setup-intro {
  margin-top: 0;
  opacity: 0.85;
  line-height: 1.5;
}

.agent-client {
  border: 1px solid rgba(127, 127, 127, 0.2);
  border-radius: 4px;
  padding: 0.75rem 0.9rem;
  margin-bottom: 0.75rem;
}

.agent-client-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.agent-client-name {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.agent-client-logo {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  fill: currentColor;
  opacity: 0.5;
}

.agent-client-detected {
  font-weight: normal;
  font-size: 0.75rem;
  opacity: 0.6;
}

.agent-client-status {
  font-size: 0.7rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: rgba(127, 127, 127, 0.18);

  &.status-configured {
    background: rgba(60, 170, 90, 0.25);
  }

  &.status-outdated {
    background: rgba(230, 160, 40, 0.3);
  }

  &.status-error {
    background: rgba(220, 60, 60, 0.3);
  }
}

.agent-client-path {
  font-family: monospace;
  font-size: 0.75rem;
  opacity: 0.65;
  margin: 0.35rem 0;
  word-break: break-all;
  user-select: text;
}

.agent-client-error {
  font-size: 0.8rem;
  color: var(--brand-danger);
  margin-bottom: 0.35rem;
}

.agent-client-hint {
  font-size: 0.8rem;
  opacity: 0.8;
  margin-bottom: 0.35rem;
}

.agent-client-manual-toggle {
  font-size: 0.8rem;
}

.agent-client-manual,
.agent-server-command {
  margin-top: 0.5rem;
  font-size: 0.8rem;

  pre {
    padding: 0.6rem;
    border-radius: 4px;
    background: rgba(127, 127, 127, 0.12);
    white-space: pre-wrap;
    word-break: break-all;
    user-select: text;
    margin: 0.35rem 0;
  }
}

.agent-server-command {
  margin-top: 1.5rem;
}

.agent-client-manual-label {
  opacity: 0.75;
}
</style>
