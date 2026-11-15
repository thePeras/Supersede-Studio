<template>
  <div class="with-connection-type sql-server-form">
    <common-server-inputs :config="config">
      <div class="advanced-connection-settings">
        <h4 class="advanced-heading">
          SQL Server Options
        </h4>
        <div class="advanced-body">
          <div class="form-group">
            <label for="domain">
              Domain
              <hero-icon
                name="question-mark-circle"
                v-tooltip="'Set \'domain\' to be logged in using Windows Integrated Authentication (NTLM)'"
              />
            </label>
            <input
              type="text"
              v-model="config.domain"
              class="form-control"
              :disabled="disabled"
            >
          </div>
          <div class="form-group">
            <label
              for="trustServerCertificate"
              class="checkbox-group"
            >
              <input
                type="checkbox"
                name="trustServerCertificate"
                v-model="config.trustServerCertificate"
                id="trustServerCertificate"
                :disabled="disabled"
              >
              Trust Server Certificate?
              <hero-icon
                name="question-mark-circle"
                v-tooltip="'Use this for local dev servers and self-signed certificates. ssl -> rejectUnauthorized overrides this setting if ssl is enabled'"
              />
            </label>
          </div>
        </div>
      </div>
    </common-server-inputs>
    <common-advanced :config="config" :disabled="disabled" />
  </div>
</template>

<script>
  import CommonServerInputs from './CommonServerInputs.vue'
  import CommonAdvanced from './CommonAdvanced.vue'
  import _ from 'lodash'
  import { mapState } from 'vuex'

  export default {
    components: { CommonServerInputs, CommonAdvanced },
    props: {
      config: Object,
      disabled: {
        type: Boolean,
        default: false
      }
    },

    computed: {
      ...mapState(['connection']),
    }
  }
</script>
