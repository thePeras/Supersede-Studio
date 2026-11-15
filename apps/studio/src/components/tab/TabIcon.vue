<template>
  <loading-spinner v-if="isRunning && !forceIcon" />
  <table-icon
    v-else-if="tab.tabType === 'table'"
    :table="tab"
  />
  <hero-icon
    name="table-cells"
    v-else-if="tab.tabType === 'view'"
    class="item-icon view-icon"
  />
  <hero-icon
    name="code-bracket"
    v-else-if="tab.tabType === 'query'"
    class="item-icon query"
  />
  <hero-icon
    name="wrench-screwdriver"
    v-else-if="tab.tabType === 'table-properties'"
    class="item-icon icon-table-properties"
    :class="iconClass"
  />
  <hero-icon
    name="cog-6-tooth"
    v-else-if="tab.tabType === 'settings'"
    class="item-icon settings"
  />
  <hero-icon
    name="plus"
    v-else-if="tab.tabType === 'table-builder'"
    class="item-icon table-builder-icon"
  />
  <i
    v-else
    class="hi-icon material-icons item-icon"
  >{{ tabTypeConfig?.icon || 'new_releases' }}</i>
</template>
<script lang="ts">
import Vue, { PropType } from 'vue'
import TableIcon from '../common/TableIcon.vue'
import LoadingSpinner from '../common/loading/LoadingSpinner.vue'
import { mapGetters } from 'vuex'
import { TransportOpenTab } from '@/common/transport/TransportOpenTab'

export default Vue.extend({
  components: { TableIcon, LoadingSpinner },
  props: {
    tab: {
      type: Object as PropType<TransportOpenTab>
    },
    forceIcon: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      isRunning: false,
    }
  },
  watch: {
    tab: {
      deep: true,
      handler(value) {
        this.isRunning = value.isRunning;
      }
    }
  },
  computed: {
    ...mapGetters({
      'tabTypeConfigs': 'tabs/tabTypeConfigs',
    }),
    iconClass() {
      const result = {}
      result[`${this.tab.entityType}-icon`] = true
      return result
    },
    tabTypeConfig() {
      return this.tabTypeConfigs.find((config) => {
        return (
          config.type === this.tab.tabType &&
          config.pluginId === this.tab.context.pluginId
        );
      });
    },
  }
})
</script>
