<template>
  <portal to="modals">
    <modal
      :name="modalName"
      @before-open="beforeOpen"
      @opened="opened"
      class="vue-dialog supersede-modal update-pin-modal"
    >
      <form v-kbd-trap="true" @submit.prevent="submit">
        <div class="dialog-content">
          <div class="dialog-c-title has-icon">
            <hero-icon name="pencil" />
            Update your PIN
            <a class="close-btn btn btn-fab" href="#" @click.prevent="close">
              <hero-icon name="x-mark" />
            </a>
          </div>
          <div class="description">
            <p>Enter your current PIN and choose a new one. Your new PIN will be required for all future database connections.</p>
          </div>

          <error-alert v-if="errorMessage" :error="errorMessage" />
          <error-alert
            v-if="!valid && attemptedSubmit"
            :error="`New PIN must be at least ${$bksConfig.security.minPinLength} characters long`"
            title="Please fix the following errors"
          />

          <div class="form-group form-group-password">
            <label for="input-old-pin">Current PIN</label>
            <input
              id="input-old-pin"
              name="oldPin"
              :type="showOldPin ? 'text' : 'password'"
              v-model="oldPin"
              ref="oldPinInput"
              placeholder="Enter your current PIN"
            >
            <hero-icon
              class="password-icon"
              @click="toggleOldPinVisibility"
              :title="showOldPin ? 'Hide current PIN' : 'Show current PIN'"
              :name="showOldPin ? 'eye-slash' : 'eye'"
            />
          </div>

          <div class="form-group form-group-password">
            <label for="input-new-pin">New PIN</label>
            <input
              id="input-new-pin"
              name="newPin"
              :type="showNewPin ? 'text' : 'password'"
              v-model="newPin"
              :placeholder="`Enter at least ${$bksConfig.security.minPinLength} characters`"
            >
            <hero-icon
              class="password-icon"
              @click="toggleNewPinVisibility"
              :title="showNewPin ? 'Hide new PIN' : 'Show new PIN'"
              :name="showNewPin ? 'eye-slash' : 'eye'"
            />
          </div>

          <div class="alert alert-info">
            <hero-icon name="information-circle" />
            <div class="alert-body">
              Your new PIN will be encrypted and stored securely on your device.&nbsp;<external-link href="https://docs.supersedestudio.io/user_guide/configuration#forgot-pin">
                Forgot your current PIN?
              </external-link>
            </div>
          </div>
        </div>
        <div class="vue-dialog-buttons">
          <button
            class="btn btn-flat btn-cancel"
            type="button"
            @click.prevent="close"
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            type="submit"
            @click.prevent="submit"
            :disabled="submitting || !valid"
          >
            Submit
          </button>
        </div>
      </form>
    </modal>
  </portal>
</template>

<script lang="ts">
import Vue from "vue";
import { AppEvent } from "@/common/AppEvent";
import ErrorAlert from "@/components/common/ErrorAlert.vue";
import ExternalLink from "@/components/common/ExternalLink.vue";

export default Vue.extend({
  components: { ErrorAlert, ExternalLink },
  data() {
    return {
      modalName: "update-pin-modal",
      submitting: false,
      oldPin: "",
      newPin: "",
      showOldPin: false,
      showNewPin: false,
      errorMessage: "",
      attemptedSubmit: false,
    };
  },
  computed: {
    rootBindings() {
      return [{ event: AppEvent.updatePin, handler: this.open }];
    },
    valid() {
      return this.newPin.length >= this.$bksConfig.security.minPinLength;
    },
  },
  methods: {
    beforeOpen() {
      this.submitting = false;
      this.newPin = "";
      this.oldPin = "";
      this.showOldPin = false;
      this.showNewPin = false;
      this.errorMessage = "";
      this.attemptedSubmit = false;
    },
    opened() {
      this.$nextTick(() => {
        this.$refs.oldPinInput.focus();
      });
    },
    close() {
      this.$modal.hide(this.modalName);
    },
    toggleOldPinVisibility() {
      this.showOldPin = !this.showOldPin;
    },
    toggleNewPinVisibility() {
      this.showNewPin = !this.showNewPin;
    },
    open() {
      this.$modal.show(this.modalName);
    },
    async submit() {
      this.attemptedSubmit = true;

      if (this.submitting) {
        return;
      }

      if (!this.valid) {
        return;
      }

      this.submitting = true;
      this.errorMessage = "";

      try {
        await this.$util.send("lock/update", {
          oldPin: this.oldPin,
          newPin: this.newPin,
        });
        this.close();
      } catch (e) {
        this.errorMessage = e.message;
      }
      this.submitting = false;
    },
  },
  mounted() {
    this.registerHandlers(this.rootBindings);
  },
  beforeDestroy() {
    this.unregisterHandlers(this.rootBindings);
  },
});
</script>
