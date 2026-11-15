<template>
  <div class="agents-panel">
    <div class="agents-panel-header">
      <div class="agents-panel-title">
        {{ title }}
      </div>
      <div
        v-if="!singleTab"
        class="agents-panel-tabs"
      >
        <a
          href="#"
          :class="{ active: tab === 'activity' }"
          @click.prevent="$emit('update:tab', 'activity')"
        >Activity</a>
        <a
          href="#"
          :class="{ active: tab === 'setup' }"
          @click.prevent="$emit('update:tab', 'setup')"
        >Setup</a>
      </div>
      <a
        class="close-btn btn btn-fab"
        href="#"
        @click.prevent="$emit('close')"
      >
        <i class="material-icons">clear</i>
      </a>
    </div>
    <div class="agents-panel-body">
      <agent-activity
        v-if="tab === 'activity'"
        :focus-call="focusCall"
        @setup="$emit('update:tab', 'setup')"
      />
      <agent-setup v-if="tab === 'setup'" />
    </div>
  </div>
</template>

<script lang="ts">
import Vue, { PropType } from 'vue'
import AgentActivity from './AgentActivity.vue'
import AgentSetup from './AgentSetup.vue'

export default Vue.extend({
  components: { AgentActivity, AgentSetup },
  props: {
    tab: { type: String as PropType<'activity' | 'setup'>, default: 'activity' },
    singleTab: Boolean,
    focusCall: { type: Object as PropType<{ id: number, at: number } | null>, default: null },
  },
  computed: {
    title(): string {
      if (!this.singleTab) return 'Agents'
      return this.tab === 'setup' ? 'MCP Setup' : 'MCP Activity'
    },
  },
})
</script>

<style lang="scss">
.agents-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;

  .agents-panel-header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 1rem 1.5rem 0.5rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.2);

    .close-btn {
      margin-left: auto;
      position: static;
    }
  }

  .agents-panel-title {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .agents-panel-tabs {
    display: flex;
    gap: 1rem;

    a {
      padding: 0.35rem 0;
      border-bottom: 2px solid transparent;
      opacity: 0.7;
      text-decoration: none;
      color: inherit;

      &.active {
        opacity: 1;
        border-bottom-color: var(--theme-primary);
      }
    }
  }

  .agents-panel-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
}
</style>
