<template>
  <hero-icon
    name="table-cells"
    :title="title"
    class="item-icon"
    :class="iconClass"
  />
</template>
<script>
import _ from 'lodash'
export default {
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