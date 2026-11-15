<template>
  <hero-icon
    name="table-cells"
    :title="title"
    class="item-icon"
    :class="iconClass"
  />
</template>
<script>
import HeroIcon from '../HeroIcon.vue'
import _ from 'lodash'
export default {
  components: { HeroIcon },
  props: ['table'],
  computed: {
    iconClass() {
      const result = {}
      result[`${this.table.entityType}-icon`] = true
      return result
    },
      title() {
        return _.startCase(this.table.entityType)
      },
  }
}
</script>