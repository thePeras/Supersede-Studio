<template>
  <div
    class="connection-button"
    v-if="config"
    :title="privacyMode ?
      'Connection details hidden by Privacy Mode' :
      $bks.buildConnectionString(config)"
    :class="classes"
  >
    <div class="connection-info">
      <button
        class="btn btn-link btn-icon disconnect"
        title="Disconnect"
        @click.prevent="disconnect(false)"
      >
        <hero-icon name="power" />
      </button>
      <span class="connection-name truncate expand">
        {{ connectionName }}
      </span>
    </div>
    <button
      ref="switchButton"
      class="btn btn-link btn-icon connection-action"
      :class="{ active: isQuickSwitcherVisible }"
      title="Switch Connection"
      @click.stop.prevent="showQuickSwitcher"
    >
      <hero-icon name="arrows-right-left" />
    </button>
    <portal to="modals">
      <modal
        class="vue-dialog supersede-modal"
        name="running-exports-modal"
        height="auto"
        :scrollable="true"
        @opened="$refs.cancel.focus()"
      >
        <form
          v-kbd-trap="true"
          @submit.prevent="disconnect(true)"
        >
          <div class="dialog-content">
            <div class="dialog-c-title">
              Confirm Disconnect
            </div>
            There are active exports running. Are you sure you want to disconnect?
          </div>
          <div class="vue-dialog-buttons">
            <button
              class="btn btn-flat"
              type="button"
              ref="cancel"
              @click.prevent="$modal.hide('running-exports-modal')"
            >
              Cancel
            </button>
            <button
              class="btn btn-danger"
              type="submit"
            >
              Disconnect
            </button>
          </div>
        </form>
      </modal>
    </portal>
    <portal to="menus">
      <div
        class="quick-switcher-panel"
        ref="quickSwitcherPanel"
        v-if="isQuickSwitcherVisible"
        :style="{ left: `${switcherLeft}px` }"
        @click.stop
      >
        <div class="quick-switcher-header">
          {{ showingMore ? 'Saved Connections:' : 'Recent Connections:' }}
        </div>
        <div class="quick-switcher-list-wrapper">
          <div class="quick-switcher-list">
            <button
              v-for="conn in displayedConnections"
              :key="conn.id"
              :config="conn"
              :show-duplicate="false"
              class="quick-switcher-item"
              @click="selectConnection(conn)"
            >
              {{ conn.name }}
            </button>
            <div
              v-if="!displayedConnections.length"
              class="quick-switcher-empty"
            >
              No {{ showingMore ? 'saved' : 'recent' }} connections
            </div>
          </div>
        </div>
        <div class="quick-switcher-footer">
          <button
            class="quick-switcher-item more"
            :disabled="moreDisabled"
            @click.stop="toggleMore"
          >
            <span class="label">{{ showingMore ? 'less' : 'more' }}</span>
            <span style="font-size: 22px;">›</span>
          </button>
        </div>
      </div>
    </portal>
  </div>
</template>
<script>
import { mapState, mapGetters } from 'vuex'
import rawLog from '@bksLogger'

const log = rawLog.scope('app.vue')

export default {
  data() {
    return {
      isQuickSwitcherVisible: false,
      switcherLeft: 0,
      showingMore: false,
      recentConnections: [],
    }
  },
  computed: {
    ...mapState({
      config: state => state.usedConfig,
      connection: state => state.connection,
    }),
    ...mapState('data/connections', {'connectionConfigs': 'items'}),
    ...mapGetters({
      hasRunningExports: 'exports/hasRunningExports',
      workspace: 'workspace',
      connectionColor: 'connectionColor',
      savedConnections: 'data/connections/filteredConnections',
      privacyMode: 'settings/privacyMode'
    }),
    connectionName() {
      return this.config ? this.$bks.buildConnectionName(this.config) : 'Connection'
    },
    recentConnectionsConfigs() {
      return this.$store.getters['data/usedconnections/orderedUsedConfigs'] || []
    },
    displayedConnections() {
      const connections = this.showingMore ? this.savedConnections : this.recentConnections;

      return connections.filter(conn =>
        conn.id !== this.config.id || conn.workspaceId !== this.config.workspaceId
      );
    },
    moreDisabled() {
      const otherConnections = this.showingMore ? this.recentConnections : this.savedConnections;
      return !otherConnections.filter(conn =>
        conn.id !== this.config.id || conn.workspaceId !== this.config.workspaceId
      ).length;
    },
    classes() {
      const result = {
        'connection-button': true
      }

      result[this.connectionColor] = true
      return result;
    }
  },
  beforeDestroy() {
    document.removeEventListener('click', this.hideQuickSwitcher)
  },
  methods: {
    disconnect(force) {
      if (this.hasRunningExports && !force) {
        this.$modal.show('running-exports-modal')
      } else {
        this.$store.dispatch('disconnect')
      }
    },
    showQuickSwitcher() {
      this.isQuickSwitcherVisible = !this.isQuickSwitcherVisible;
      if (this.isQuickSwitcherVisible) {
        this.populateRecentConnections();
        this.switcherLeft = this.$refs.switchButton.getBoundingClientRect().left;
        document.addEventListener('click', this.hideQuickSwitcher)
      } else {
        document.removeEventListener('click', this.hideQuickSwitcher)
      }
    },
    hideQuickSwitcher() {
      this.isQuickSwitcherVisible = false
      document.removeEventListener('click', this.hideQuickSwitcher)
    },
    async selectConnection(config) {
      try {
        await this.$store.dispatch('disconnect')
        const { auth, cancelled } = await this.$bks.unlock();
        if (cancelled) return;
        await this.$store.dispatch('connect', { config, auth });
      } catch (ex) {
        log.error(ex)
        this.$noty.error(`Error establishing a connection: ${ex?.message ?? ex}`)
      }
      this.hideQuickSwitcher()
    },
    toggleMore() {
      this.showingMore = !this.showingMore;
    },
    populateRecentConnections() {
      if (!this.config.id || !this.config.workspaceId) {
        console.log('Missing id or workspaceId:', {
          id: this.config.id,
          workspaceId: this.config.workspaceId
        });
        return
      }

      const filteredRecent = this.recentConnectionsConfigs
        .map(rc => this.connectionConfigs.find(c =>
          c.id === rc.connectionId &&
          c.workspaceId === rc.workspaceId &&
          (c.id !== this.config.id || c.workspaceId !== this.config.workspaceId)
        ))
        .filter(Boolean);
      this.recentConnections = filteredRecent.slice(0, 5)
    },
  }
}
</script>
