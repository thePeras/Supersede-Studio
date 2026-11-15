<template>
  <div
    class="list-item routine-item"
    :style="{ '--level': level }"
    @contextmenu="$emit('contextmenu', $event)"
  >
    <a
      class="list-item-btn"
      role="button"
      :class="{ active: selected, open: expanded }"
    >
      <span
        class="btn-fab open-close"
        @click.prevent="$emit('expand', $event)"
        @contextmenu.stop.prevent=""
      >
        <hero-icon
          name="chevron-right"
          v-if="displayParams.length > 0"
          class="dropdown-icon"
        />
      </span>
      <span class="item-wrapper flex flex-middle expand">
        <div
          :title="draggable ? 'drag me!' : ''"
          class="table-item-wrapper"
          :class="{ draggable: draggable, 'drag-handle': draggable }"
        >
          <hero-icon
            name="variable"
            :title="title"
            :class="iconClass"
            class="item-icon entity-icon"
          />
          <hero-icon
            name="bars-3"
            class="item-icon dh"
            v-if="draggable"
          />
        </div>

        <span
          class="table-name truncate"
          :title="routine.name"
        >{{
          routine.name
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
          <i class="bk-pin" />
          <hero-icon name="x-mark" class="unpin" />
        </span>
      </span>
    </a>
    <div
      v-if="expanded"
      class="sub-items"
    >
      <span class="sub-item" v-if="displayParams.length === 0">
        <span class="title truncate">No Parameters</span>
      </span>
      <span
        :key="param.name"
        v-for="param in displayParams"
        class="sub-item"
      >
        <span
          class="title truncate"
          ref="title"
        >{{ param.name }}</span>
        <span
          class="badge"
          :class="param.type"
        >{{ param.type
        }}<span v-if="param.length">({{ param.length }})</span></span>
      </span>
    </div>
  </div>
</template>

<script lang="ts">
import HeroIcon from '../HeroIcon.vue'
import Vue from "vue";
import { RoutineTypeNames } from "./models";

export default Vue.extend({
  components: { HeroIcon },
  props: ["routine", "pinned", "draggable", "level", "expanded", "enablePinning"],
  data() {
    return {
      selected: false,
    };
  },
  watch: {
    selected() {
      if (this.selected) {
        this.$el.scrollIntoView();
      }
    },
  },
  computed: {
    displayParams() {
      const result = [...this.routine.routineParams];
      if (this.routine.returnType) {
        result.push({
          name: "RETURN",
          type: this.routine.returnType,
          length: this.routine.returnTypeLength,
        });
      }
      return result;
    },
    iconClass() {
      const result = { "routine-icon": true };
      result[`routine-${this.routine.type}-icon`] = true;
      return result;
    },
    title() {
      return RoutineTypeNames[this.routine.type];
    },
  },
});
</script>
