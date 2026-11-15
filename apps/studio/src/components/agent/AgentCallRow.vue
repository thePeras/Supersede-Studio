<template>
  <div
    class="agent-call"
    :data-call-id="call.id"
    :class="[{ expanded, focused, error: call.status !== 'ok' }, `connection-label-color-${labelColor || 'default'}`]"
  >
    <component
      :is="expandable ? 'a' : 'div'"
      :href="expandable ? '#' : undefined"
      class="agent-call-summary"
      :class="{ expandable }"
      @click.prevent="toggle"
    >
      <span
        class="agent-call-time"
        :title="absoluteTime"
      >{{ shortTime }}</span>
      <span class="agent-call-tool">{{ call.tool }}</span>
      <span
        v-if="call.connectionName"
        class="agent-call-connection"
      >{{ connectionLabel }}</span>
      <span
        v-if="kindIcons.length && !(expanded && call.sql)"
        class="agent-call-kinds"
      >
        <span
          v-for="kind in kindIcons"
          :key="kind.key"
          class="agent-call-kind"
          :title="kind.label"
        >
          <svg
            viewBox="0 0 24 24"
            role="img"
            :aria-label="kind.label"
          >
            <path
              v-for="(d, i) in kind.paths"
              :key="i"
              :d="d"
            />
          </svg>
        </span>
      </span>
      <span
        v-if="sessionLabel"
        class="agent-call-session truncate"
      >{{ sessionLabel }}</span>
      <code
        v-if="call.sql && !expanded"
        class="agent-call-sql truncate"
      >{{ call.sql }}</code>
      <span class="expand" />
      <span
        v-if="call.decision !== 'auto' && call.decision !== 'blocked'"
        class="agent-tag"
        :class="`decision-${call.decision}`"
      >{{ decisionLabel }}</span>
      <hero-icon
        v-if="call.status !== 'ok'"
        class="agent-call-status"
        :title="statusTitle"
        :name="statusIcon"
      />
      <span
        v-if="call.rowCount !== null && call.status === 'ok'"
        class="agent-call-rows"
      >{{ call.rowCount }} rows</span>
      <span
        v-if="call.durationMs !== null"
        class="agent-call-duration"
      >{{ call.durationMs }} ms</span>
    </component>
    <div
      v-if="expanded && expandable"
      class="agent-call-details"
    >
      <div
        v-if="call.sql"
        class="agent-call-sql-block"
      >
        <span
          v-if="kindIcons.length"
          class="agent-call-kinds in-block"
        >
          <span
            v-for="kind in kindIcons"
            :key="kind.key"
            class="agent-call-kind"
            :title="kind.label"
          >
            <svg
              viewBox="0 0 24 24"
              role="img"
              :aria-label="kind.label"
            >
              <path
                v-for="(d, i) in kind.paths"
                :key="i"
                :d="d"
              />
            </svg>
          </span>
        </span>
        <pre class="agent-call-full-sql">{{ call.sql }}</pre>
        <button
          type="button"
          class="agent-call-copy"
          :title="copied ? 'Copied' : 'Copy SQL'"
          :aria-label="copied ? 'Copied' : 'Copy SQL'"
          @click="copy"
        >
          <hero-icon :name="copied ? 'check' : 'document-duplicate'" />
        </button>
      </div>
      <div
        v-if="errorText"
        class="agent-call-error"
      >
        <hero-icon :name="statusIcon" />
        <span>{{ errorText }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue, { PropType } from 'vue'
import type { TransportAgentCall, WriteCategory } from '@/lib/agent/types'
import { categoryLabels } from '@/lib/agent/policy'
import { decisionLabels, displayError } from './labels'
import { categoryIcons } from './categoryIcons'

export default Vue.extend({
  props: {
    call: { type: Object as PropType<TransportAgentCall>, required: true },
    sessionLabel: { type: String, default: null },
    labelColor: { type: String, default: null },
    focused: Boolean,
  },
  watch: {
    focused: {
      immediate: true,
      handler(value: boolean) {
        if (value && this.expandable) this.expanded = true
      },
    },
  },
  data() {
    return { expanded: false, copied: false, copiedTimer: null as ReturnType<typeof setTimeout> | null }
  },
  computed: {
    date(): Date {
      return new Date(this.call.createdAt)
    },
    shortTime(): string {
      const d = this.date
      const today = new Date()
      const sameDay = d.toDateString() === today.toDateString()
      return sameDay
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    },
    absoluteTime(): string {
      return this.date.toLocaleString()
    },
    connectionLabel(): string {
      const db = this.call.database
      return db && !/[\\/]/.test(db) ? `${this.call.connectionName} / ${db}` : this.call.connectionName
    },
    kindIcons(): { key: string, label: string, paths: string[] }[] {
      if (this.call.kind === 'read') return [{ key: 'read', label: 'Read', paths: categoryIcons.read }]
      return (this.call.categories || []).map((c: WriteCategory) => ({
        key: c,
        label: categoryLabels[c] ?? c,
        paths: categoryIcons[c] ?? categoryIcons.other,
      }))
    },
    expandable(): boolean {
      return !!this.call.sql || !!this.errorText
    },
    errorText(): string | null {
      return displayError(this.call.error)
    },
    statusIcon(): string {
      return this.call.decision === 'blocked' ? 'no-symbol' : 'exclamation-circle'
    },
    statusTitle(): string | null {
      return this.call.decision === 'blocked' ? decisionLabels.blocked : this.errorText
    },
    decisionLabel(): string {
      return decisionLabels[this.call.decision] ?? this.call.decision
    },
  },
  beforeDestroy() {
    if (this.copiedTimer) clearTimeout(this.copiedTimer)
  },
  methods: {
    toggle() {
      if (this.expandable) this.expanded = !this.expanded
    },
    async copy() {
      await this.$native.clipboard.writeText(this.call.sql)
      this.copied = true
      if (this.copiedTimer) clearTimeout(this.copiedTimer)
      this.copiedTimer = setTimeout(() => { this.copied = false }, 1500)
    },
  },
})
</script>

<style lang="scss" scoped>
.agent-call.focused {
  animation: agent-call-focus 2.4s ease-out;
}

@keyframes agent-call-focus {
  0%, 40% {
    background: color-mix(in srgb, var(--theme-primary) 18%, transparent);
  }
  100% {
    background: transparent;
  }
}

.agent-call {
  position: relative;
  box-shadow: inset 3px 0 0 var(--connection-label-color, transparent);

  &::after {
    content: '';
    position: absolute;
    left: 3px;
    right: 0;
    bottom: 0;
    height: 1px;
    background: rgba(127, 127, 127, 0.12);
  }

  &:last-child::after {
    display: none;
  }
}

.agent-call-summary {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.65rem;
  font-size: 0.8rem;
  color: inherit;
  text-decoration: none;
  min-width: 0;

  &.expandable {
    cursor: pointer;

    &:hover {
      background: rgba(127, 127, 127, 0.08);
    }
  }
}

.agent-call-time {
  opacity: 0.65;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.agent-call-tool {
  font-weight: 600;
  white-space: nowrap;
}

.agent-call-connection {
  opacity: 0.8;
  flex-shrink: 0;
  white-space: nowrap;
}

.agent-call-session {
  opacity: 0.8;
  max-width: 14rem;
}

.agent-call-sql {
  min-width: 0;
  flex-shrink: 1;
  opacity: 0.85;
}

.agent-call-kinds {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
  margin-right: -0.3rem;
}

.agent-call-kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  svg {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.6;
  }

}

.agent-tag {
  font-size: 0.7rem;
  padding: 0.05rem 0.4rem;
  border-radius: 3px;
  background: rgba(127, 127, 127, 0.18);
  white-space: nowrap;

  &.decision-approved {
    background: rgba(230, 160, 40, 0.25);
  }

  &.decision-denied,
  &.decision-blocked,
  &.decision-timeout {
    background: rgba(220, 60, 60, 0.25);
  }
}

.agent-call-status {
  font-size: 1rem;
  color: var(--brand-danger);
}

.agent-call-rows,
.agent-call-duration {
  opacity: 0.65;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.agent-call-details {
  padding: 0.4rem 0.65rem 0.75rem;
}

.agent-call-sql-block {
  display: flex;
  align-items: flex-start;
  gap: 0.25rem;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.08);
}

.agent-call-copy {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  align-self: center;
  margin: 0 0.35rem 0 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;

  .hi-icon {
    font-size: 0.95rem;
  }

  &:hover {
    opacity: 1;
    background: rgba(127, 127, 127, 0.16);
  }

  &:focus-visible {
    opacity: 1;
    outline: 2px solid rgba(127, 127, 127, 0.5);
    outline-offset: 1px;
  }
}

.agent-call-kinds.in-block {
  align-self: stretch;
  flex-direction: column;
  justify-content: flex-start;
  gap: 0;
  margin: 0;
  border-right: 1px solid rgba(127, 127, 127, 0.25);

  .agent-call-kind {
    width: 2.2rem;
    height: 2.2rem;
  }
}

.agent-call-full-sql {
  flex: 1;
  min-width: 0;
  margin: 0;
  max-height: 14rem;
  overflow: auto;
  padding: 0.5rem 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.8rem;
  user-select: text;
}

.agent-call-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--brand-danger);
  background: color-mix(in srgb, var(--brand-danger) 10%, transparent);
  user-select: text;

  .hi-icon {
    flex-shrink: 0;
    font-size: 1rem;
    line-height: 1;
  }
}
</style>
