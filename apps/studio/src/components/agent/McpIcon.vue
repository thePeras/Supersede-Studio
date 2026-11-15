<template>
  <span
    class="material-icons mcp-icon"
    aria-hidden="true"
  >
    <svg viewBox="0 0 24 24">
      <path :d="path" />
    </svg>
  </span>
</template>

<script lang="ts">
import Vue from 'vue'
import { siModelcontextprotocol } from 'simple-icons'

export default Vue.extend({
  data() {
    return { path: siModelcontextprotocol.path }
  },
})
</script>

<style lang="scss" scoped>
.mcp-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;

  svg {
    width: 0.9em;
    height: 0.9em;
    fill: currentColor;
  }
}
</style>
