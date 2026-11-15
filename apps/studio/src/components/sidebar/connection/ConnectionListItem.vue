<template>
  <div
    class="list-item"
    :title="title"
    @contextmenu.prevent="showContextMenu"
  >
    <a
      href=""
      class="list-item-btn"
      :class="classList"
      @click.prevent="click(config)"
      @dblclick.prevent="doubleClick(config)"
    >
      <span :class="`connection-label connection-label-color-${labelColor}`" />
      <div class="connection-title flex-col expand">
        <div class="title">
          <editable-text
            :initial-value="label"
            :rename="rename"
            @submit="submitRename"
            @cancel="rename = false"
          />
        </div>
        <div class="subtitle">
          <span
            class="bastion"
            v-if="config.sshBastionHost && !privacyMode"
          >
            <span class="truncate">{{ config.sshBastionHost }}</span>&nbsp;>&nbsp;
          </span>
          <span
            class="ssh"
            v-if="config.sshHost && !privacyMode"
          >
            <span class="truncate">{{ config.sshHost }}</span>&nbsp;>&nbsp;
          </span>
          <span class="connection">
            <span>
              {{ privacyMode ? '******' : subtitleSimple }}
            </span>
          </span>
        </div>
      </div>
      <span
        v-if="agentEnabled"
        class="agent-indicator"
        v-tooltip="agentTooltip"
      >
        <mcp-icon />
        <span
          v-if="agentConnectionOpen"
          class="agent-open-dot"
        />
      </span>
      <span class="badge"><span>{{ config.connectionType }}</span></span>
    </a>
  </div>
</template>
<script>
import { mapGetters, mapState } from 'vuex'
import EditableText from '@/components/common/EditableText.vue'
import { AppEvent } from '@/common/AppEvent';
import { isAgentEnabled } from '@/lib/agent/policy'
import McpIcon from '@/components/agent/McpIcon.vue'

export default {
  components: { EditableText, McpIcon },
  props: [
    'config',
    'selectedConfig',
    'showDuplicate',
    'privacyMode'
  ],
  data: () => ({
    split: null,
    rename: false,
  }),
  computed: {
    ...mapGetters(["isCloud", "workspace"]),
    ...mapState('data/connectionFolders', {'folders': 'items'}),
    classList() {
      return {
        // the connection screen edits a copy, so compare by key, not identity
        'active': !!this.selectedConfig &&
          this.config.id === this.selectedConfig.id &&
          this.config.workspaceId === this.selectedConfig.workspaceId
      }
    },
    agentEnabled() {
      return isAgentEnabled(this.config)
    },
    agentConnectionOpen() {
      const ids = this.$store.state.agent?.status?.openConnectionIds ?? []
      return ids.includes(this.config.id)
    },
    agentTooltip() {
      const base = this.config.readOnlyMode ? 'MCP enabled, read only' : 'MCP enabled'
      return this.agentConnectionOpen ? `${base}, connection open` : base
    },
    labelColor() {
      return this.config.labelColor || 'default'
    },
    label() {
      if (this.config.name && this.config.name.trim()) {
        return this.config.name
      } else if (this.config.connectionType === 'sqlite' && this.config.defaultDatabase) {
        return window.main.basename(this.config.defaultDatabase)
      }

      return this.$bks.simpleConnectionString(this.config)
    },
    connectionType() {
      if (this.config.connectionType === 'sqlite') {
        return 'path'
      }

      return 'Url'
    },
    subtitleSimple() {
      return this.$bks.simpleConnectionString(this.config)
    },
    title() {
      return this.privacyMode ?
        `Created by ${this.author}` :
        `Created by ${this.author}, ${this.$bks.buildConnectionString(this.config)}`;
    },
    folder() {
      return this.folders.find((f) => f.id === this.config.connectionFolderId);
    },
    isPersonal() {
      return this.folder?.personal;
    },
    author() {
      if (!this.isCloud) {
        return "You";
      }
      if (!this.config || !this.config.membership) {
        return "Unknown";
      }
      if (
        this.config.membership.userId === this.workspace.currentMembership.userId
      ) {
        return "You";
      }
      return this.config.membership.name;
    },
  },
  methods: {
    showContextMenu(event) {
      // Stop here and propagate the event if right clicking an input element
      if (event.target.tagName === 'INPUT') {
        return;
      }

      event.stopPropagation();

      const canConnect = true
      const canWrite = this.config.canWrite ?? true;

      const options = [
        {
          name: "View",
          slug: 'view',
          handler: (blob) => this.click(blob.item)
        },
        {
          name: 'Connect',
          slug: 'connect',
          hideIf: !canConnect,
          handler: (blob) => this.doubleClick(blob.item)
        },
        { type: "divider" },
        {
          name: "Duplicate",
          slug: 'duplicate',
          handler: this.duplicate
        },
        {
          name: `Copy ${this.connectionType}`,
          handler: this.copyUrl
        },
        { type: "divider" },
        {
          name: "Rename",
          slug: 'rename',
          handler: () => {
            this.rename = true;
          },
          hideIf: !canWrite,
        },
        {
          name: "Move",
          handler: () => {
            this.trigger(AppEvent.openMoveFileModal, {
              type: "connection",
              value: this.config,
            });
          },
          hideIf: this.folders.length === 0,
        },
        {
          name: "Delete",
          handler: this.remove
        },
      ].filter(({ hideIf }) => !hideIf)

      this.$bks.openMenu({
        event,
        item: this.config,
        options
      })
    },
    async click() {
      this.$emit('edit', this.config)
    },
    async doubleClick() {
      this.$emit('doubleClick', this.config)
    },
    remove() {
      this.$emit('remove', this.config)
    },
    duplicate() {
      this.$emit('duplicate', this.config)
    },
    async copyUrl() {
      try {
        await this.$copyText(this.$bks.buildConnectionString(this.config))
        this.$noty.success(`The ${this.connectionType} was successfully copied!`)
      } catch (err) {
        this.$noty.success(`The ${this.connectionType} could not be copied!`)
      }
    },
    async submitRename(name) {
      if (!name || name === this.label) {
        this.rename = false
        return
      }
      try {
        const updated = { ...this.config, name }
        await this.$store.dispatch('data/connections/save', updated)
      } catch (ex) {
        this.$noty.error(`Rename error: ${ex.userMessage ?? ex.message}`)
      } finally {
        this.rename = false
      }
    },
  }

}
</script>
<style lang="scss" scoped>
.list-item .list-item-btn .connection-title {
  min-width: 0;

  .title {
    position: relative;
    width: 100%;
    overflow: visible;
  }

  .editable-text {
    width: 100%;
  }
}

/** --depth is from Tree.vue */
.list-group .list-item .list-item-btn {
  padding-left: calc(var(--depth) * 1.15rem);
}

.connection-label {
  margin-left: 0.5rem;
}

.agent-indicator {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  font-size: 1rem;
  margin-right: 0.35rem;
  color: var(--text);

  .hi-icon {
    font-size: 1rem;
  }
}

.agent-open-dot {
  position: absolute;
  right: -2px;
  bottom: -1px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #30a46c;
  box-shadow: 0 0 0 1.5px var(--sidebar-bg, var(--theme-bg));
}
</style>
