<template>
  <div
    class="agent-popover"
    role="dialog"
    aria-label="Agent Access (MCP)"
    :style="position"
    tabindex="-1"
    @keydown.esc="$emit('close')"
  >
    <div class="agent-popover-header">
      <div class="agent-popover-heading">
        <span class="agent-popover-title">Agent Access (MCP)</span>
      </div>
      <x-switch
        v-if="connection"
        :toggled="enabled"
        @click.prevent="toggleEnabled"
      />
    </div>


    <div
      v-if="loading"
      class="agent-popover-empty"
    >
      Loading…
    </div>
    <div
      v-else-if="!connection"
      class="agent-popover-empty"
    >
      Only saved connections can be shared with agents.
    </div>
    <template v-else>
      <div
        v-if="enabled && hasProvider === false"
        class="agent-popover-note"
      >
        No MCP client is configured.
        <a
          href="#"
          @click.prevent="openAgents('setup')"
        >Set one up</a>
      </div>
      <div
        v-if="connection.readOnlyMode"
        class="agent-popover-note"
      >
        Read Only Mode is on, so agents are limited to read queries.
      </div>
      <agent-rules-list
        class="agent-popover-rules"
        :class="{ dimmed: !enabled }"
        :rules="displayedRules"
        :locked="!!connection.readOnlyMode"
        :connection-type="connection.connectionType"
        compact
        @change="setRule"
      />
    </template>
  </div>
</template>

<script lang="ts">
import Vue, { PropType } from 'vue'
import { mapGetters, mapState } from 'vuex'
import { AppEvent } from '@/common/AppEvent'
import AgentRulesList from '@/components/agent/AgentRulesList.vue'
import { normalizeAgentOptions, presetRules } from '@/lib/agent/policy'
import type { AgentRules, CategoryRule, NormalizedAgentOptions, WriteCategory } from '@/lib/agent/types'

export default Vue.extend({
  components: { AgentRulesList },
  props: {
    anchor: { type: Object as PropType<DOMRect>, required: true },
  },
  data() {
    return {
      connection: null as any,
      loading: true,
      saveQueue: Promise.resolve() as Promise<void>,
    }
  },
  computed: {
    ...mapState(['usedConfig']),
    ...mapGetters('agent', ['hasProvider']),
    position(): Record<string, string> {
      return {
        left: `${this.anchor.right + 8}px`,
        bottom: `${Math.max(8, window.innerHeight - this.anchor.bottom)}px`,
      }
    },
    options(): NormalizedAgentOptions {
      return normalizeAgentOptions(this.connection?.agentOptions)
    },
    enabled(): boolean {
      return !!this.connection && this.options.enabled
    },
    displayedRules(): AgentRules {
      return this.connection?.readOnlyMode ? presetRules('read') : this.options.rules
    },
  },
  async mounted() {
    document.body.appendChild(this.$el)
    this.$el.focus()
    this.$store.dispatch('agent/loadClients')
    await this.load()
  },
  beforeDestroy() {
    this.$el.remove()
  },
  methods: {
    async load() {
      this.loading = true
      try {
        const id = this.usedConfig?.id
        this.connection = id
          ? await this.$util.send('appdb/saved/findOneBy', { options: { id } })
          : null
        if (this.connection) this.$emit('change', this.options.enabled)
      } catch (e) {
        this.connection = null
      } finally {
        this.loading = false
      }
    },
    persist(agentOptions: NormalizedAgentOptions): Promise<void> {
      const previous = this.connection.agentOptions
      this.connection = { ...this.connection, agentOptions }
      const snapshot = this.connection
      this.saveQueue = this.saveQueue.then(async () => {
        try {
          await this.$store.dispatch('data/connections/save', snapshot)
          this.$emit('change', agentOptions.enabled)
        } catch (e) {
          if (this.connection === snapshot) {
            this.connection = { ...this.connection, agentOptions: previous }
          }
          this.$noty.error(`Could not save Agent Access: ${e.message}`)
        }
      })
      return this.saveQueue
    },
    async toggleEnabled() {
      const enabled = !this.options.enabled
      await this.persist({ ...this.options, enabled })
      if (!enabled && !this.options.enabled) this.$emit('close')
    },
    setRule(categories: WriteCategory[], rule: CategoryRule) {
      this.persist({ ...this.options, rules: { ...this.options.rules, ...Object.fromEntries(categories.map((c) => [c, rule])) } })
    },
    openAgents(tab: 'activity' | 'setup') {
      this.$emit('close')
      this.trigger(AppEvent.openAgents, tab)
    },
  },
})
</script>

<style lang="scss" scoped>
.agent-popover {
  position: fixed;
  z-index: 1000;
  width: 400px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 0.85rem 1rem 0.6rem;
  border-radius: 8px;
  border: 1px solid rgba(127, 127, 127, 0.2);
  background: var(--theme-bg);
  color: var(--text-dark);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
  font-size: 0.85rem;
  text-align: left;
  outline: none;
}

.agent-popover-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
  padding-bottom: 0.65rem;
  border-bottom: 1px solid rgba(127, 127, 127, 0.15);
}

.agent-popover-heading {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.agent-popover-title {
  font-weight: 600;
  font-size: 0.9rem;
}

.agent-popover-note {
  margin: 0.35rem 0;
  font-size: 0.8rem;
  color: var(--text-light);
}

.agent-popover-empty {
  padding: 0.75rem 0;
  font-size: 0.8rem;
  color: var(--text-light);
}

.agent-popover-rules {
  transition: opacity 120ms ease-out;

  &.dimmed {
    opacity: 0.55;
  }
}
</style>
