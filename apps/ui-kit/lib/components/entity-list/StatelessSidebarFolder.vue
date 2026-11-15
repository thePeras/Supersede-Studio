<template>
  <div
    class="list-item schema-item"
    @contextmenu="$emit('contextmenu', $event)"
  >
    <div
      class="folder-group schema"
    >
      <a
        class="folder-btn"
        :class="{'open': expanded}"
        role="button"
        @click.prevent="$emit('expand', $event)"
      >
        <span class="btn-fab open-close">
          <hero-icon name="chevron-right" class="dropdown-icon" />
        </span>
        <hero-icon
          name="folder"
          title="Schema"
          class="schema-icon item-icon"
        />
        <span
          class="table-name truncate expand"
          :title="schema.name"
        >{{ schema.name }}</span>
      </a>
    </div>
  </div>
</template>

<script lang="ts">
import HeroIcon from '../HeroIcon.vue'
	export default {
  components: { HeroIcon },
    props: ["schema", "expanded"],
	}
</script>
