<script>
// A button that shows a spinner while its async handler (`@clicked`) is in
// flight. The handler receives a callback it must invoke when finished.
export default {
  props: {
    labelKey: {
      type:     String,
      required: true,
    },
    disabled: {
      type:    Boolean,
      default: false,
    },
  },

  data() {
    return { busy: false };
  },

  methods: {
    onClick() {
      if (this.busy || this.disabled) {
        return;
      }
      this.busy = true;
      this.$emit('clicked', (ok) => {
        this.busy = false;
      });
    },
  },
};
</script>

<template>
  <button
    class="btn role-primary"
    :disabled="busy || disabled"
    @click="onClick"
  >
    <i
      v-if="busy"
      class="icon icon-spinner icon-spin"
    />
    <span>{{ t(labelKey) }}</span>
  </button>
</template>