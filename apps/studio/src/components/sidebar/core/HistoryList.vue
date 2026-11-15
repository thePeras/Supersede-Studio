<template>
  <div class="sidebar-history flex-col expand">
    <div class="sidebar-list">
      <nav
        class="list-group"
        ref="wrapper"
      >
        <div class="list-heading row">
          <div class="sub row flex-middle expand">
            <div
              class="expand"
              title="Query execution history for this workspace"
            >
              History
            </div>
            <div class="actions">
              <a @click.prevent="refresh">
                <hero-icon
                  name="arrow-path"
                  title="Refresh Query History"
                />
              </a>
            </div>
          </div>
        </div>
        <div class="show-all-history-container" title="By default, only the history executed on the current connection are shown.">
          <input type="checkbox" id="show-all-history-checkbox" v-model="showAllHistory">
          <label for="show-all-history-checkbox" class="show-all-history-text">Show all</label>
        </div>
        <error-alert
          v-if="error"
          :error="error"
          title="Problem loading history"
        />
        <sidebar-loading v-else-if="loading" />
        <div
          v-else-if="!currentHistory.length"
         class="empty"
        >
          No recent queries
        </div>
        <div
          v-else
          class="list-body"
        >
          <div
            class="list-item"
            @contextmenu.prevent.stop="openContextMenu($event, item)"
            v-for="item in currentHistory"
            :key="item.id"
          >
            <a
              class="list-item-btn"
              @click.prevent="select(item)"
              @dblclick.prevent="click(item)"
              :title="item.excerpt"
              :class="{selected: item === selected}"
            >
              <i
                v-if="item.agentLabel"
                class="item-icon hi-icon agent-history-logo"
                :title="`Run by ${item.agentLabel}`"
              >
                <svg
                  viewBox="-2 -2 28 28"
                  role="img"
                  :aria-label="item.agentLabel"
                >
                  <path :d="agentLogo(item)" />
                </svg>
              </i>
              <hero-icon
                name="code-bracket"
                v-else
                class="item-icon query"
              />
              <!-- <input @click.stop="" type="checkbox" :value="item" class="form-control delete-checkbox" v-model="checkedHistoryQueries" v-bind:class="{ shown: checkedHistoryQueries.length > 0 }"> -->
              <div class="list-title flex-col">
                <span class="item-text expand truncate">{{ nicelySized(item.excerpt) }}</span>
                <span class="subtitle">
                  <span>{{ item.numberOfRecords || 0 }} Results</span>, {{ formatTimeAgo(item) }}
                </span>
              </div>
            </a>
          </div>
        </div>
      </nav>
    </div>
    <!-- <div class="toolbar btn-group row flex-right" v-show="checkedHistoryQueries.length > 0">
      <a class="btn btn-link" @click="discardCheckedHistoryQueries">Cancel</a>
      <a class="btn btn-primary" :title="removeTitle" @click="removeCheckedHistoryQueries">Remove</a>
    </div> -->
  </div>
</template>

<script>
import _ from 'lodash'
import TimeAgo from 'javascript-time-ago';
  import { mapState } from 'vuex'
import ErrorAlert from '@/components/common/ErrorAlert.vue';
import SidebarLoading from '@/components/common/SidebarLoading.vue'
import { logoForClientName } from '@/components/agent/clientLogos'
import { siModelcontextprotocol } from 'simple-icons'

  export default {
  components: { ErrorAlert, SidebarLoading },
    data: function () {
      return {
        checkedHistoryQueries: [],
        timeAgo: new TimeAgo('en-US'),
        selected: null,
        showAllHistory: false
      }
    },
    computed: {
      ...mapState(['usedConfig']),
      ...mapState('data/usedQueries', { 'history': 'items', 'loading': 'loading', 'error': 'error'},),
      removeTitle() {
        return `Remove ${this.checkedHistoryQueries.length} saved history queries`;
      },
      currentHistory(){
        if(this.showAllHistory){
          return this.history;
        } else {
          // an unsaved connection has no id, and so no history of its own
          return this.usedConfig?.id
            ? this.history.filter(item => item.connectionId === this.usedConfig.id)
            : [];
        }
      },
    },
    mounted() {
      document.addEventListener('mousedown', this.maybeUnselect)
    },
    beforeDestroy() {
      document.removeEventListener('mousedown', this.maybeUnselect)
    },
    methods: {
      agentLogo(item) {
        return logoForClientName(item.agentLabel) ?? siModelcontextprotocol.path
      },
      formatTimeAgo(item) {
        const dt = _.isDate(item.updatedAt) ? item.updatedAt : new Date(item.updatedAt * 1000)
        return this.timeAgo.format(dt)
      },
      maybeUnselect(e) {
        if (!this.selected) return
        if (this.$refs.wrapper.contains(e.target)) {
          return
        } else {
          this.selected = null
        }
      },
      openContextMenu(event, item) {
        this.$bks.openMenu({
          event, item,
          options: [
            {
              name: "Remove",
              handler: ({ item }) => this.remove(item)
            }
          ]
        })
      },
      refresh() {
        this.$store.dispatch('data/usedQueries/load')
      },
      click(item) {
        this.$root.$emit("historyClick", item)
      },
      nicelySized(text) {
        if (text.length >= 128) {
          return `${text.substring(0, 128)}...`
        } else {
          return text
        }
      },
      select(item) {
        this.selected = item
      },
      async remove(historyQuery) {
        await this.$store.dispatch('data/usedQueries/remove', historyQuery)
      },
      async removeCheckedHistoryQueries() {
        for(let i = 0; i < this.checkedHistoryQueries.length; i++) {
          await this.remove(this.checkedHistoryQueries[i])
        }
        this.checkedHistoryQueries = [];
      },
      discardCheckedHistoryQueries() {
        this.checkedHistoryQueries = [];
      }
    },
  }
</script>

<style lang="scss" scoped>
  .list-item-btn .item-icon.agent-history-logo {
    color: rgb(from var(--theme-base) r g b / 45%);

    svg {
      width: 1em;
      height: 1em;
      vertical-align: baseline;
      fill: currentColor;
    }
  }
</style>
