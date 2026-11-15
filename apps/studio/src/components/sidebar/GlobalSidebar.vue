<template>
  <div class="global-items">
    <a
      href=""
      @click.prevent="$emit('select', 'tables')"
      class="nav-item selectable"
      :class="{ active: activeItem === 'tables'}"
      title="Database"
    >
      <span class="bk-database" />
    </a>
    <a
      href=""
      @click.prevent="$emit('select', 'queries')"
      class="nav-item selectable"
      :class="{ active: activeItem === 'queries'}"
      title="Saved Queries"
    >
      <span class="material-icons">code</span>
    </a>
    <a
      href=""
      @click.prevent="$emit('select', 'history')"
      class="nav-item selectable"
      :class="{ active: activeItem === 'history'}"
      title="Run History"
    >
      <span class="material-icons">history</span>
    </a>
    <span class="expand" />
    <a
      ref="agentButton"
      href=""
      @click.prevent="togglePopover"
      class="nav-item agent-nav-item"
      :class="{ active: popoverAnchor, 'agent-on': agentEnabled }"
      :title="agentEnabled ? 'Agent Access (MCP): on' : 'Agent Access (MCP): off'"
      aria-haspopup="dialog"
      :aria-expanded="popoverAnchor ? 'true' : 'false'"
    >
      <mcp-icon />
      <i
        v-if="pendingAgentApprovals"
        class="agent-dot agent-pending-dot"
      />
      <i
        v-else-if="agentEnabled"
        class="agent-dot agent-on-dot"
      />
    </a>
    <agent-access-popover
      v-if="popoverAnchor"
      ref="popover"
      :anchor="popoverAnchor"
      @change="agentEnabled = $event"
      @close="closePopover"
    />
  </div>
</template>

<script>
  import { mapState } from 'vuex'
  import AgentAccessPopover from './AgentAccessPopover.vue'
  import McpIcon from '@/components/agent/McpIcon.vue'
  import { isAgentEnabled } from '@/lib/agent/policy'

  export default {
    components: { AgentAccessPopover, McpIcon },
    props: ['activeItem'],
    data() {
      return {
        popoverAnchor: null,
        agentEnabled: false,
      }
    },
    computed: {
      ...mapState(['usedConfig']),
      pendingAgentApprovals() {
        return this.$store.state.agent?.pendingApprovals?.length ?? 0
      },
    },
    watch: {
      'usedConfig.id': {
        immediate: true,
        handler() {
          this.loadAgentState()
        },
      },
    },
    beforeDestroy() {
      document.removeEventListener('mousedown', this.onDocumentMousedown, true)
    },
    methods: {
      async loadAgentState() {
        const id = this.usedConfig?.id
        if (!id) {
          this.agentEnabled = false
          return
        }
        try {
          const saved = await this.$util.send('appdb/saved/findOneBy', { options: { id } })
          this.agentEnabled = isAgentEnabled(saved)
        } catch (e) {
          this.agentEnabled = false
        }
      },
      togglePopover() {
        if (this.popoverAnchor) {
          this.closePopover()
          return
        }
        this.popoverAnchor = this.$refs.agentButton.getBoundingClientRect()
        document.addEventListener('mousedown', this.onDocumentMousedown, true)
      },
      closePopover() {
        this.popoverAnchor = null
        document.removeEventListener('mousedown', this.onDocumentMousedown, true)
      },
      onDocumentMousedown(event) {
        const popover = this.$refs.popover?.$el
        const button = this.$refs.agentButton
        if (popover?.contains(event.target) || button?.contains(event.target)) return
        this.closePopover()
      },
    },
  }
</script>

<style lang="scss" scoped>
  .nav-item {
    position: relative;
  }


  .agent-dot {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--theme-bg);
  }

  .agent-pending-dot {
    background: var(--brand-danger);
  }

  .agent-on-dot {
    background: #30a46c;
  }
</style>
