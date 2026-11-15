import { shallowMount } from '@vue/test-utils'
import Vue from 'vue'
import Vuex from 'vuex'
import { TestOrmConnection } from '@tests/lib/TestOrmConnection'
import { AppDbHandlers } from '@/handlers/appDbHandlers'
import ConnectionInterface from '@/components/ConnectionInterface.vue'

Vue.use(Vuex)

// split.js needs real DOM geometry, and only drives the sidebar gutter.
jest.mock('split.js', () => jest.fn(() => ({
  destroy: jest.fn(),
  getSizes: () => [25, 75],
})))

const WORKSPACE_ID = -1

function buildStore(connectCalls: any[]) {
  return new Vuex.Store({
    state: {
      workspaceId: WORKSPACE_ID,
      connection: null,
      sshConfigWarnings: [],
      username: 'testuser',
    } as any,
    getters: {
      isUltimate: () => true,
      isCloud: () => false,
      workspace: () => ({ id: WORKSPACE_ID }),
    },
    actions: {
      connect(_context, payload) {
        connectCalls.push(payload)
      },
    },
    modules: {
      'data/connections': {
        namespaced: true,
        state: { items: [] },
        actions: { remove: jest.fn() },
      },
      'data/connectionFolders': { namespaced: true, state: { items: [] } },
      licenses: {
        namespaced: true,
        getters: { isTrial: () => false, trialLicense: () => null },
      },
      settings: { namespaced: true, getters: { privacyMode: () => false } },
      pinnedConnections: {
        namespaced: true,
        actions: { loadPins: jest.fn(), reorder: jest.fn(), remove: jest.fn() },
      },
      credentials: { namespaced: true, actions: { load: jest.fn() } },
    },
  })
}

describe('ConnectionInterface', () => {
  let wrapper: any
  let connectCalls: any[]

  beforeEach(async () => {
    await TestOrmConnection.connect()
    connectCalls = []

    wrapper = shallowMount(ConnectionInterface as any, {
      store: buildStore(connectCalls),
      mocks: {
        $config: { appVersion: '0.0.0', defaults: { connectionTypes: [] } },
        $util: {
          send: async (channel: string, args: any) => {
            const handler = (AppDbHandlers as any)[channel]
            if (!handler) throw new Error(`No handler for ${channel}`)
            return await handler(args ?? {})
          },
        },
        $bks: { unlock: async () => ({ auth: null, cancelled: false }) },
        $confirm: async () => true,
        $noty: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
        registerHandlers: jest.fn(),
        unregisterHandlers: jest.fn(),
      },
    })
  })

  afterEach(async () => {
    wrapper.destroy()
    await TestOrmConnection.disconnect()
  })

  it('connects with a saved connection unchanged', async () => {
    const saved = await AppDbHandlers['appdb/saved/save']({
      obj: {
        connectionType: 'postgresql',
        name: 'My Saved Conn',
        host: 'saved.example.com',
        port: 5432,
        workspaceId: WORKSPACE_ID,
      },
      options: {},
    } as any)

    await wrapper.vm.handleConnect({ ...saved, workspaceId: WORKSPACE_ID })

    const { config } = connectCalls[0]
    expect(config.id).toBe(saved.id)
    expect(config.host).toBe('saved.example.com')
  })

  it('clears the form when the connection being edited is deleted', async () => {
    const saved = await AppDbHandlers['appdb/saved/save']({
      obj: {
        connectionType: 'postgresql',
        name: 'Doomed',
        host: 'doomed.example.com',
        workspaceId: WORKSPACE_ID,
      },
      options: {},
    } as any)

    // The screen edits a copy, so `remove` can't compare by identity.
    await wrapper.vm.edit({ ...saved, workspaceId: WORKSPACE_ID })
    expect(wrapper.vm.config.id).toBe(saved.id)

    await wrapper.vm.remove({ ...saved, workspaceId: WORKSPACE_ID })

    expect(wrapper.vm.config.id).toBeNull()
  })
})
