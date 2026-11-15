<template>
  <div
    class="agent-rules"
    :class="{ compact }"
  >
    <div class="agent-rule">
      <svg
        class="agent-rule-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          v-for="(d, i) in icons.read"
          :key="i"
          :d="d"
        />
      </svg>
      <div class="agent-rule-label">
        <span class="agent-rule-title">Read</span>
        <span class="hint">{{ readHint }}</span>
      </div>
      <div
        class="agent-rule-control"
        title="Reads are always allowed"
      >
        <div
          class="agent-rule-options"
          role="group"
          aria-label="Read queries"
        >
          <button
            v-for="rule in readRules"
            :key="rule"
            type="button"
            class="agent-rule-option"
            :class="[`rule-${rule}`, { active: rule === 'allow' }]"
            :aria-pressed="rule === 'allow' ? 'true' : 'false'"
            disabled
          >
            {{ ruleLabels[rule] }}
          </button>
        </div>
      </div>
    </div>
    <div
      v-for="row in rows"
      :key="row.key"
      class="agent-rule"
    >
      <svg
        class="agent-rule-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          v-for="(d, i) in icons[row.icon]"
          :key="i"
          :d="d"
        />
      </svg>
      <div class="agent-rule-label">
        <span class="agent-rule-title">{{ row.label }}</span>
        <span class="hint">{{ row.hint }}</span>
      </div>
      <div class="agent-rule-control">
        <div
          class="agent-rule-options"
          role="group"
          :aria-label="`${row.label} queries`"
        >
          <button
            v-for="rule in allowedRules(row.icon)"
            :key="rule"
            type="button"
            class="agent-rule-option"
            :class="[`rule-${rule}`, { active: rowRule(row) === rule }]"
            :aria-pressed="rowRule(row) === rule ? 'true' : 'false'"
            :disabled="locked"
            @click="$emit('change', row.categories, rule)"
          >
            {{ ruleLabels[rule] }}
          </button>
        </div>
      </div>
      <div
        v-if="row.key === 'other' && rules.other === 'allow'"
        class="agent-rule-warning"
      >
        <i class="material-icons-outlined">warning</i>
        <span>Unrecognized statements also run without approval.</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue, { PropType } from 'vue'
import { allowedRules, readRuleHint, RuleRow, ruleLabels, ruleRows, strictestRule } from '@/lib/agent/policy'
import type { AgentRules, CategoryRule, WriteCategory } from '@/lib/agent/types'
import type { ConnectionType } from '@/lib/db/types'
import { categoryIcons as icons } from './categoryIcons'

export default Vue.extend({
  props: {
    rules: { type: Object as PropType<AgentRules>, required: true },
    locked: Boolean,
    compact: Boolean,
    connectionType: { type: String as PropType<ConnectionType>, default: null },
  },
  data() {
    return {
      icons,
      ruleLabels,
      readRules: ['block', 'ask', 'allow'] as CategoryRule[],
    }
  },
  computed: {
    rows(): RuleRow[] {
      return ruleRows(this.connectionType)
    },
    readHint(): string {
      return readRuleHint(this.connectionType)
    },
  },
  methods: {
    allowedRules(category: WriteCategory): CategoryRule[] {
      return allowedRules(category)
    },
    rowRule(row: RuleRow): CategoryRule {
      return strictestRule(this.rules, row.categories)
    },
  },
})
</script>

<style lang="scss" scoped>
$option-width: 4rem;
$option-width-compact: 3.25rem;

.agent-rule {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid rgba(127, 127, 127, 0.12);

  &:last-child {
    border-bottom: none;
  }
}

.agent-rule-icon {
  flex-shrink: 0;
  width: 1.1rem;
  height: 1.1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.55;
}

.agent-rule-label {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  min-width: 0;
}

.agent-rules .agent-rule-label .hint {
  margin: 0;
  font-size: 80%;
  line-height: 1.3;
  color: var(--text-hint);
}

.agent-rule-warning {
  flex-basis: 100%;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--brand-warning);
  background: color-mix(in srgb, var(--brand-warning) 10%, transparent);

  .material-icons-outlined {
    flex-shrink: 0;
    font-size: 1rem;
  }
}

.agent-rule-title {
  color: var(--text);
  font-weight: 600;
  line-height: 1.3;
}

.agent-rule-control {
  flex-shrink: 0;
  width: calc(#{$option-width} * 3 + 6px);

  .compact & {
    width: calc(#{$option-width-compact} * 3 + 6px);
  }
  display: flex;
  justify-content: flex-start;
}

.agent-rule-options {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.12);
}

.agent-rule-option {
  width: $option-width;

  .compact & {
    width: $option-width-compact;
  }

  height: 1.75rem;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out, box-shadow 120ms ease-out;

  &:hover:not(:disabled):not(.active) {
    background: rgba(127, 127, 127, 0.16);
    color: var(--text-dark);
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--theme-base) 45%, transparent);
    outline-offset: 1px;
  }

  &:disabled {
    cursor: default;

    &:not(.active) {
      opacity: 0.45;
    }
  }

  &.active {
    background: var(--theme-bg);
    color: var(--text-dark);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(127, 127, 127, 0.12);
  }
}
</style>
