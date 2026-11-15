import { shallowMount } from '@vue/test-utils'
import Vue from 'vue'
import Vuex from 'vuex'
import ConnectionListItem from '@/components/sidebar/connection/ConnectionListItem.vue'

Vue.use(Vuex)

function buildStore(savedConnections: any[] = []) {
  return new Vuex.Store({
    state: { workspaceId: -1 },
    getters: {
      isCloud: () => false,
      isUltimate: () => true,
    },
    modules: {
      'data/connections': {
        namespaced: true,
        state: { items: savedConnections },
      },
      'data/connectionFolders': {
        namespaced: true,
        state: { items: [] },
      },
    },
  })
}

function buildBksMock() {
  return {
    simpleConnectionString: (c: any) => `${c.host}:${c.port}/${c.defaultDatabase}`,
    buildConnectionString: (c: any) =>
      `${c.connectionType}://${c.username}@${c.host}:${c.port}/${c.defaultDatabase}`,
  }
}

function mountItem(opts: { config: any; saved?: any[]; selectedConfig?: any }) {
  return shallowMount(ConnectionListItem as any, {
    store: buildStore(opts.saved ?? []),
    propsData: {
      config: opts.config,
      selectedConfig: opts.selectedConfig ?? null,
      showDuplicate: false,
      pinned: false,
      privacyMode: false,
    },
    mocks: { $bks: buildBksMock() },
  })
}

describe('ConnectionListItem display', () => {
  it('shows the row config', () => {
    const saved = {
      id: 7,
      workspaceId: -1,
      name: 'My DB',
      connectionType: 'postgresql',
      host: 'saved-host.example.com',
      port: 5432,
      username: 'user',
      defaultDatabase: 'mydb',
      labelColor: 'default',
    }

    const wrapper = mountItem({ config: saved, saved: [saved] })

    expect(wrapper.vm['label']).toBe('My DB')
    expect(wrapper.vm['title']).toContain('saved-host.example.com')
  })
})

describe('ConnectionListItem active state', () => {
  const saved = {
    id: 7,
    workspaceId: -1,
    name: 'My DB',
    connectionType: 'postgresql',
    host: 'db.example.com',
    port: 5432,
    labelColor: 'default',
  }

  it('highlights the row the connection screen is editing', () => {
    // The connection screen edits a *copy* of the row, so this can never be
    // an identity comparison.
    const wrapper = mountItem({
      config: saved,
      selectedConfig: { ...saved },
    })

    expect(wrapper.vm['classList'].active).toBe(true)
  })

  it('does not highlight a different connection', () => {
    const wrapper = mountItem({
      config: saved,
      selectedConfig: { ...saved, id: 8 },
    })

    expect(wrapper.vm['classList'].active).toBe(false)
  })
})
