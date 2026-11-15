<template>
  <base-modal
    :name="modalName"
    class="dbeaver-import-modal"
    @submit="submit"
  >
    <template #title>
      Import Connections from DBeaver
    </template>
    <div v-if="!importing">
      <div v-if="detecting" class="message">
        Looking for DBeaver workspaces...
      </div>
      <template v-else>
        <div v-if="projects.length === 0" class="message">
          No DBeaver workspace found. Choose the DBeaver workspace or project folder (usually <code>DBeaverData/workspace6</code>).
        </div>
        <div v-else class="form-group">
          <label for="dbeaver-project">Project</label>
          <select
            id="dbeaver-project"
            class="form-control custom-select"
            v-model="projectDir"
          >
            <option
              v-for="project in projects"
              :key="project.dir"
              :value="project.dir"
            >
              {{ project.name }} — {{ $pluralize('connection', project.connectionCount, true) }}
            </option>
          </select>
          <small class="text-muted">{{ projectDir }}</small>
        </div>
        <div class="form-group">
          <label>{{ projects.length ? 'Other workspace' : 'Workspace' }}</label>
          <file-picker
            v-model="workspaceDir"
            :directory="true"
            :show-hidden-files="true"
            button-text="Choose Folder"
          />
        </div>
        <div class="form-group">
          <label>Parent Folder</label>
          <in-app-folder-picker
            v-model="parentId"
            folder-path="data/connectionFolders"
          />
        </div>
        <div class="form-group">
          <label class="checkbox form-row">
            <input
              v-model="includePasswords"
              type="checkbox"
            >
            Import saved passwords
          </label>
        </div>
      </template>
    </div>
    <div v-else>
      <div v-if="!importFinished" class="importing-state">
        <label class="importing-ellipsis">Importing</label>
        <x-progressbar />
      </div>
      <div v-else class="import-stats">
        <p class="stats-summary">
          Imported
          {{ $pluralize('connection', importStats.items, true) }}
          and {{ $pluralize('folder', importStats.directories, true) }}
        </p>
        <ul v-if="importStats.warnings.length" class="warnings-list">
          <li v-for="(warning, index) in importStats.warnings" :key="index">
            {{ warning }}
          </li>
        </ul>
      </div>
    </div>
    <template #footer="{ close }">
      <button
        class="btn btn-flat"
        type="button"
        @click="close"
      >
        {{ importFinished ? "Close" : "Cancel" }}
      </button>
      <button
        v-if="!importing"
        class="btn btn-primary"
        type="submit"
        :disabled="!projectDir"
      >
        Import
      </button>
    </template>
  </base-modal>
</template>

<script lang="ts">
import FilePicker from "@/components/common/form/FilePicker.vue";
import InAppFolderPicker from "@/components/common/form/InAppFolderPicker.vue";
import BaseModal from "@/components/common/modals/BaseModal.vue";
import { AppEvent } from "@/common/AppEvent";
import { IObjectImportStats } from "@/common/interfaces/IObjectImportStats";
import rawLog from "@bksLogger";

const log = rawLog.scope("DBeaverImport");

export default {
  components: {
    FilePicker,
    InAppFolderPicker,
    BaseModal,
  },
  data() {
    return {
      modalName: "dbeaver-import",
      detecting: false,
      projects: [],
      projectDir: null,
      workspaceDir: null,
      parentId: null,
      includePasswords: true,
      importing: false,
      importFinished: false,
      importStats: null as IObjectImportStats | null,
    };
  },
  computed: {
    rootBindings() {
      return [{ event: AppEvent.promptDBeaverImport, handler: this.open }];
    },
  },
  watch: {
    workspaceDir(value) {
      if (value) this.detect();
    },
  },
  methods: {
    open() {
      this.projects = [];
      this.projectDir = null;
      this.workspaceDir = null;
      this.parentId = null;
      this.includePasswords = true;
      this.importing = false;
      this.importFinished = false;
      this.importStats = null;
      this.$modal.show(this.modalName);
      this.detect();
    },
    async detect() {
      const workspaceDir = Array.isArray(this.workspaceDir) ? this.workspaceDir[0] : this.workspaceDir;
      this.detecting = true;
      try {
        this.projects = await this.$util.send("workspace/detectDBeaverProjects", { workspaceDir });
        this.projectDir = this.projects[0]?.dir ?? null;
        if (workspaceDir && !this.projects.length) {
          this.$noty.error(`No DBeaver connections found in ${workspaceDir}`);
        }
      } catch (e) {
        log.error(e);
        this.projects = [];
        this.projectDir = null;
      } finally {
        this.detecting = false;
      }
    },
    async submit() {
      if (!this.projectDir) return;
      this.importing = true;
      try {
        this.importStats = await this.$util.send("workspace/importDBeaver", {
          projectDir: this.projectDir,
          parentId: this.parentId,
          includePasswords: this.includePasswords,
        });
        await this.$store.dispatch("refreshConnections");
        this.importFinished = true;
      } catch (e) {
        this.$noty.error(`Error importing DBeaver connections: ${e?.message ?? e}`);
        log.error(e);
        this.$modal.hide(this.modalName);
      }
    },
  },
  mounted() {
    this.registerHandlers(this.rootBindings);
  },
};
</script>

<style lang="scss" scoped>
.message {
  margin-bottom: 1rem;
}

.importing-state {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 0;

  .importing-ellipsis {
    margin: 0;
    text-align: center;
  }
}

.import-stats {
  .stats-summary {
    margin: 0 0 0.5rem;
  }

  .warnings-list {
    margin: 0.25rem 0 0;
    padding-left: 1.5rem;
    list-style: disc;
    max-height: 12rem;
    overflow-y: auto;

    li {
      margin-bottom: 0.25rem;
      word-break: break-word;
    }
  }
}

.importing-ellipsis::after {
  content: "...";
  animation: dots 1s steps(2) infinite;
}

@keyframes dots {
  0%   { content: "..."; }
  50%  { content: ".."; }
  100% { content: "..."; }
}
</style>
