<template>
  <div class="password-input">
    <masked-input
      :type="showPassword ? 'text' : 'password'"
      :value="value"
      class="password"
      @input="$emit('input', $event)"
      :disabled="disabled"
    />
    <hero-icon
      @click.prevent="showPassword = !showPassword"
      class="password-icon"
      :name="showPassword ? 'eye-slash' : 'eye'"
    />
  </div>
</template>

<script>
import MaskedInput from '@/components/MaskedInput.vue';

export default {
  name: 'PasswordInput',
  components: { MaskedInput },
  props: {
    value: {
      type: [String, Number],
      default: ''
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      showPassword: false,
    }
  },
}
</script>

<style scoped>
.password-input {
  position: relative;
}

.password-input .password-icon {
  position: absolute;
  right: 12px;
  bottom: 5px;
  cursor: pointer;
}
</style>
