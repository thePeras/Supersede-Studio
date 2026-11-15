<template>
  <portal to="modals">
    <modal
      :name="modalName"
      class="vue-dialog supersedure-modal agents-modal"
      @opened="opened = true"
      @closed="opened = false"
    >
      <div class="dialog-content">
        <agents-panel
          v-if="opened"
          :tab.sync="tab"
          @close="close"
        />
      </div>
    </modal>
  </portal>
</template>

<script lang="ts">
import Vue from 'vue'
import { AppEvent } from '@/common/AppEvent'
import AgentsPanel from './AgentsPanel.vue'

export default Vue.extend({
  components: { AgentsPanel },
  data() {
    return {
      modalName: 'agents-modal',
      tab: 'activity' as 'activity' | 'setup',
      opened: false,
    }
  },
  computed: {
    rootBindings() {
      return [{ event: AppEvent.openAgents, handler: this.open }]
    },
  },
  mounted() {
    this.registerHandlers(this.rootBindings)
  },
  beforeDestroy() {
    this.unregisterHandlers(this.rootBindings)
  },
  methods: {
    open(tab?: 'activity' | 'setup') {
      if (!this.$store.state.connected) return
      if (tab === 'activity' || tab === 'setup') this.tab = tab
      this.$modal.show(this.modalName)
    },
    close() {
      this.$modal.hide(this.modalName)
    },
  },
})
</script>

<style lang="scss">
.agents-modal {
  &.v--modal-overlay .v--modal.v--modal-box {
    width: min(1100px, 92vw) !important;
    max-width: none;
    height: 85vh !important;
    max-height: 85vh;
  }

  .dialog-content {
    height: 100%;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
}
</style>
