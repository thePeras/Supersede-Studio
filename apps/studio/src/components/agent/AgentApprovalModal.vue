<template>
  <base-modal
    :name="modalName"
    @closed="onClosed"
  >
    <template #title>
      <mcp-icon />
      Approve agent query?
    </template>
    <div
      v-if="request"
      class="agent-approval"
    >
      <p class="agent-approval-summary">
        <strong>{{ request.clientName || 'An agent' }}</strong>&nbsp;<span class="agent-approval-source">({{ request.sessionLabel }})</span> wants to run a query on <strong>{{ target }}</strong> that includes:
      </p>
      <div class="agent-approval-categories">
        <span
          v-for="category in request.categories"
          :key="category"
          class="agent-approval-category"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              v-for="(d, i) in categoryIcons[category] || categoryIcons.other"
              :key="i"
              :d="d"
            />
          </svg>
          {{ categoryLabel(category) }}
        </span>
      </div>
      <pre class="agent-approval-sql">{{ request.sql }}</pre>
      <div class="agent-approval-meta">
        <span>Denied automatically in {{ remainingLabel }}</span>
        <span v-if="waiting > 0">{{ waiting }} more waiting</span>
      </div>
    </div>
    <template #footer>
      <button
        class="btn btn-flat"
        type="button"
        @click.prevent="decide(false)"
      >
        Deny
      </button>
      <button
        class="btn btn-primary agent-approve-btn"
        type="button"
        @click.prevent="decide(true)"
      >
        Approve
      </button>
    </template>
  </base-modal>
</template>

<script lang="ts">
import Vue from 'vue'
import { mapGetters, mapState } from 'vuex'
import BaseModal from '@/components/common/modals/BaseModal.vue'
import McpIcon from './McpIcon.vue'
import { categoryIcons } from './categoryIcons'
import type { AgentApprovalRequest, WriteCategory } from '@/lib/agent/types'
import { categoryLabels } from '@/lib/agent/policy'

export default Vue.extend({
  components: { BaseModal, McpIcon },
  data() {
    return {
      categoryIcons,
      modalName: 'agent-approval-modal',
      shownId: null as string | null,
      decided: new Set<string>(),
      now: Date.now(),
      timer: null as ReturnType<typeof setInterval> | null,
    }
  },
  computed: {
    ...mapGetters('agent', { request: 'currentApproval' }),
    ...mapState('agent', ['pendingApprovals']),
    target(): string {
      const request = this.request as AgentApprovalRequest | null
      if (!request) return ''
      return request.database ? `${request.connectionName} / ${request.database}` : request.connectionName
    },
    waiting(): number {
      return Math.max(this.pendingApprovals.length - 1, 0)
    },
    remainingLabel(): string {
      const request = this.request as AgentApprovalRequest | null
      if (!request) return ''
      const seconds = Math.max(Math.ceil((request.expiresAt - this.now) / 1000), 0)
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    },
  },
  watch: {
    request: {
      immediate: true,
      handler(request: AgentApprovalRequest | null) {
        this.$nextTick(() => {
          if (request) {
            this.shownId = request.id
            this.$modal.show(this.modalName)
          } else if (this.shownId) {
            this.shownId = null
            this.$modal.hide(this.modalName)
          }
        })
      },
    },
  },
  mounted() {
    this.timer = setInterval(() => { this.now = Date.now() }, 1000)
  },
  beforeDestroy() {
    if (this.timer) clearInterval(this.timer)
  },
  methods: {
    categoryLabel(category: WriteCategory): string {
      return categoryLabels[category] ?? category
    },
    async decide(approved: boolean) {
      const request = this.request as AgentApprovalRequest | null
      if (!request) return
      this.decided.add(request.id)
      try {
        await this.$store.dispatch('agent/decide', { id: request.id, approved })
      } catch (e) {
        this.$noty.error(`Could not send the decision: ${e.message}`)
      }
    },
    onClosed() {
      const request = this.request as AgentApprovalRequest | null
      if (request && request.id === this.shownId && !this.decided.has(request.id)) {
        this.decide(false)
      }
    },
  },
})
</script>

<style lang="scss" scoped>
.agent-approval-summary {
  margin-top: 0;
  line-height: 1.5;
}

.agent-approval-source {
  opacity: 0.7;
}

.agent-approval-categories {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-bottom: 0.6rem;
}

.agent-approval-category {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  border-radius: 3px;
  background: rgba(230, 160, 40, 0.3);

  svg {
    width: 0.9rem;
    height: 0.9rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}

.agent-approval-sql {
  max-height: 16rem;
  overflow: auto;
  padding: 0.75rem;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.12);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.85rem;
  user-select: text;
}

.agent-approval-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  opacity: 0.7;
}

.agent-approve-btn {
  background-color: var(--brand-danger);
  color: white;
}
</style>
