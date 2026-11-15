<template>
  <div
    class="list-item table-item"
    :style="{ '--level': level }"
    @contextmenu="$emit('contextmenu', $event)"
  >
    <a
      class="list-item-btn"
      role="button"
      :class="{ open: expanded }"
    >
      <span
        @contextmenu.prevent.stop=""
        class="btn-fab open-close"
        @click.prevent="$emit('expand', $event)"
      >
        <hero-icon name="chevron-right" class="dropdown-icon" />
      </span>
      <span
        class="item-wrapper flex flex-middle expand"
        @dblclick.prevent="$emit('dblclick', $event)"
      >
        <span
          :title="draggable ? 'drag me!' : ''"
          class="table-item-wrapper"
          :class="{ draggable: draggable, 'drag-handle': draggable }"
        >
          <table-icon
            :table="table"
            class="table-icon"
          />
          <hero-icon
            name="bars-3"
            class="item-icon dh"
            v-if="draggable"
          />
        </span>
        <span
          class="table-name truncate"
          :title="table.name"
        >{{
          table.name
        }}</span>
      </span>
      <span
        v-if="enablePinning"
        class="actions"
        :class="{ pinned: pinned }"
      >
        <span
          class="btn-fab pin"
          :class="{ pinned: pinned }"
          :title="pinned ? 'Unpin' : 'Pin'"
          @mousedown.prevent.stop="$emit('pin', $event)"
        >
          <i class="bk-pin pin" />
          <hero-icon name="x-mark" class="unpin" />
        </span>
      </span>
    </a>
    <div
      v-if="expanded"
      class="sub-items"
    >
      <span
        class="sub-item"
        v-if="!loadingColumns && !(table.columns?.length)"
      >
        No Columns
      </span>
      <template v-else-if="table.columns?.length > 0">
        <span
          :key="c.name"
          v-for="(c, i) in table.columns"
          class="sub-item"
        >
          <span
            class="title truncate"
            ref="title"
          >{{
            c.field
          }}</span>
          <span
            class="badge"
            :class="c.dataType"
          ><span>{{ c.dataType }}</span></span>
        </span>
      </template>
      <span
        class="sub-item"
        v-else
      >
        Loading columns...
      </span>
    </div>
  </div>
</template>

<script lang="ts">
import HeroIcon from '../HeroIcon.vue'
import Vue from "vue";
import _ from "lodash";
import TableIcon from "./TableIcon.vue";

export default Vue.extend({
  props: [
    "table",
    "pinned",
    "draggable",
    "level",
    "expanded",
    "loadingColumns",
    "enablePinning",
  ],
  components: { HeroIcon, TableIcon },
});
</script>
