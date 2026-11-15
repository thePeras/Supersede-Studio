<template>
  <toggle-form-area
    title="Agent Access (MCP)"
    :expanded="options.enabled"
    class="agent-access-form"
  >
    <template #header>
      <x-switch
        @click.prevent="options.enabled = !options.enabled"
        :toggled="options.enabled"
        :disabled="disabled"
      />
    </template>
    <template>
      <div
        v-if="hasProvider === false"
        class="row alert-row"
      >
        <div class="alert alert-warning">
          <hero-icon name="exclamation-triangle" />
          <div>
            Requires an MCP client. No agent client is configured yet. Set one up in
            <a
              href="#"
              @click.prevent="openSetup"
            >Tools → Agents</a>.
          </div>
        </div>
      </div>
      <div
        v-if="config.readOnlyMode"
        class="row alert-row"
      >
        <div class="alert alert-warning">
          <hero-icon name="lock-closed" />
          <div>Read Only Mode is on, so agents are limited to read queries.</div>
        </div>
      </div>
      <div
        v-if="config.rememberPassword === false"
        class="row alert-row"
      >
        <div class="alert alert-warning">
          <hero-icon name="exclamation-triangle" />
          <div>Passwords are not saved for this connection. Agents can only connect with saved credentials.</div>
        </div>
      </div>

      <div class="form-group">
        <agent-rules-list
          :rules="displayedRules"
          :locked="locked"
          :connection-type="config.connectionType"
          @change="setRule"
        />
      </div>
    </template>
  </toggle-form-area>
</template>

<script lang="ts">
import Vue from 'vue'
import { mapGetters } from 'vuex'
import ToggleFormArea from '@/components/common/ToggleFormArea.vue'
import { AppEvent } from '@/common/AppEvent'
import { normalizeAgentOptions, presetRules, WRITE_CATEGORIES } from '@/lib/agent/policy'
import AgentRulesList from '@/components/agent/AgentRulesList.vue'
import type { AgentRules, CategoryRule, NormalizedAgentOptions, WriteCategory } from '@/lib/agent/types'


export default Vue.extend({
  components: { ToggleFormArea, AgentRulesList },
  props: {
    config: { type: Object, required: true },
    disabled: Boolean,
  },
  data() {
    return {
    }
  },
  computed: {
    ...mapGetters('agent', ['hasProvider']),
    options(): NormalizedAgentOptions {
      return this.config.agentOptions
    },
    locked(): boolean {
      return this.disabled || !!this.config.readOnlyMode
    },
    displayedRules(): AgentRules {
      return this.config.readOnlyMode ? presetRules('read') : this.options.rules
    },
  },
  mounted() {
    this.$store.dispatch('agent/loadClients')
  },
  watch: {
    config: {
      immediate: true,
      handler() {
        const current = this.config.agentOptions
        const normalized = normalizeAgentOptions(current)
        const stale = !current
          || current.access !== undefined
          || current.enabled !== normalized.enabled
          || 'maxRows' in current
          || WRITE_CATEGORIES.some((c) => current.rules?.[c] !== normalized.rules[c])
        if (stale) {
          this.$set(this.config, 'agentOptions', normalized)
        }
      },
    },
  },
  methods: {
    setRule(categories: WriteCategory[], rule: CategoryRule) {
      this.$set(this.options, 'rules', { ...this.options.rules, ...Object.fromEntries(categories.map((c) => [c, rule])) })
    },
    openSetup() {
      this.trigger(AppEvent.openAgents, 'setup')
    },
  },
})
</script>
