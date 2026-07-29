<script>
import Banner from '@components/Banner/Banner.vue';
import { LabeledInput } from '@components/Form/LabeledInput';
import { Checkbox } from '@components/Form/Checkbox';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { parse as parseUrl } from '@shell/utils/url';
import { _CREATE } from '@shell/config/query-params';
import BusyButton from '../components/BusyButton.vue';
import { PveApi } from '../pve.ts';

export default {
  components: {
    Banner,
    BusyButton,
    Checkbox,
    LabeledInput,
    LabeledSelect,
  },

  props: {
    mode: {
      type:     String,
      required: true,
    },

    value: {
      type:     Object,
      required: true,
    },
  },

  async fetch() {
    this.driver = await this.$store.dispatch('rancher/find', {
      type: 'nodedriver',
      id:   'pve',
    });
  },

  data() {
    // In edit/view mode the credential's public field is in decodedData already;
    // the secret (`apiTokenSecret`) is masked server-side and not shown back.
    return {
      driver:          {},
      step:            1,             // 1: editable, 2: connected/locked
      busy:            false,
      allowBusy:       false,
      error:           '',
      warning:         '',
      errorAllowHost:  false,
      versionInfo:     null,
    };
  },

  computed: {
    isCreate() {
      return this.mode === _CREATE;
    },

    /**
     * The credential stores its values as strings in a Secret, so this is
     * `'true'` or `''` on the wire while the checkbox needs a real boolean.
     *
     * `''` rather than `'false'` for the off state is deliberate: Rancher
     * decides whether to pass a bool flag by testing the stored string, and a
     * literal "false" is non-empty — it would switch verification off exactly
     * when the user asked for it to stay on.
     */
    apiInsecure: {
      get() {
        const v = this.value?.decodedData?.apiInsecure;

        return v === true || v === 'true';
      },
      set(v) {
        this.value.setData('apiInsecure', v ? 'true' : '');
      },
    },

    canAuthenticate() {
      return !!this.value?.decodedData?.apiUrl &&
        !!this.value?.decodedData?.apiTokenId &&
        !!this.value?.decodedData?.apiTokenSecret;
    },

    hostname() {
      const u = parseUrl(this.value.decodedData.apiUrl);

      return u?.host || '';
    },
  },

  created() {
    // On create nothing is valid until Test Connection succeeds. On edit the
    // credential already exists and Rancher never returns `apiTokenSecret` —
    // it is write-only — so `canAuthenticate` can never be satisfied, Test
    // Connection stays disabled, and requiring a fresh test would leave Save
    // permanently greyed out. Editing the TLS options must not be gated on
    // retyping a secret the form cannot show.
    this.$emit('validationChanged', !this.isCreate);
  },

  methods: {
    clear() {
      this.step = 1;
      this.errorAllowHost = false;
      this.error = '';
      this.warning = '';
      this.versionInfo = null;
      this.$emit('validationChanged', !this.isCreate);
    },

    async addHostToAllowList() {
      this.allowBusy = true;
      const api = new PveApi(this.$store, this.value.decodedData);
      const ok = await api.addHostToAllowList(this.driver);

      this.allowBusy = false;

      if (ok) {
        // Re-trigger the connection attempt.
        this.$refs.connect.$el.click();
      }
    },

    /**
     * "Test Connection": fetch /api2/json/version through the Rancher proxy.
     *
     * A gateway failure means one of two things, told apart by the allow-list:
     * the host is not allow-listed (offer the one-click fix), or it is and the
     * proxy still could not reach it — nearly always because Rancher's proxy
     * verifies the PVE certificate against the Rancher server's trust store
     * and, unlike the driver, cannot be told to skip it. The latter blocks the
     * machine-pool dropdowns but not provisioning, so it is a warning rather
     * than a validation failure; see `warnings.proxyUnverified`.
     */
    async connect(cb) {
      this.error = '';
      this.warning = '';
      this.errorAllowHost = false;

      let okay = false;

      if (!this.value.decodedData.apiUrl) {
        return cb(okay);
      }

      // The driver expects the full token id `USER@REALM!TOKENID`; the secret
      // is concatenated with a `=` separator in the PVEAPIToken header value.
      const fullToken = `${ this.value.decodedData.apiTokenId }=${ this.value.decodedData.apiTokenSecret }`;
      const api = new PveApi(this.$store, {
        apiUrl:    this.value.decodedData.apiUrl,
        apiToken:  fullToken,
      });

      this.busy = true;
      this.step = 2;

      const res = await api.getVersion();

      if (res.error) {
        this.versionInfo = null;

        const status = res.error._status;
        const gateway = status === 502 || status === 503;

        if (gateway && !api.hostInAllowList(this.driver)) {
          this.step = 1;
          this.errorAllowHost = true;
        } else if (gateway) {
          // Allow-listed but unreachable: let the credential through, since the
          // driver reaches PVE directly and honours the TLS fields above.
          this.warning = this.t('driver.pve.auth.warnings.proxyUnverified', { hostname: this.hostname });
          okay = true;
        } else if (status === 401 || status === 403) {
          this.step = 1;
          this.error = this.t('driver.pve.auth.errors.unauthorized');
        } else {
          this.step = 1;
          this.error = res.error.message || this.t('driver.pve.auth.errors.other');
        }
      } else {
        okay = true;
        this.versionInfo = res?.data?.version || res?.version || '';
      }

      this.busy = false;
      // A failed test still leaves an existing credential saveable: the probe
      // goes through Rancher's proxy, which the driver does not use, so it is
      // advisory. The driver validates for real in PreCreateCheck.
      this.$emit('validationChanged', okay || !this.isCreate);
      cb(okay);
    },
  },
};
</script>

<template>
  <div>
    <div class="row">
      <div class="col span-12">
        <LabeledInput
          :value="value.decodedData.apiUrl"
          :disabled="step !== 1"
          label-key="driver.pve.auth.fields.apiUrl"
          placeholder-key="driver.pve.auth.placeholders.apiUrl"
          type="text"
          :mode="mode"
          @update:value="value.setData('apiUrl', $event);"
        />
      </div>
    </div>
    <div class="row">
      <div class="col span-6">
        <LabeledInput
          :value="value.decodedData.apiTokenId"
          :disabled="step !== 1"
          class="mt-20"
          label-key="driver.pve.auth.fields.apiTokenId"
          placeholder-key="driver.pve.auth.placeholders.apiTokenId"
          type="text"
          :mode="mode"
          @update:value="value.setData('apiTokenId', $event);"
        />
      </div>
      <div class="col span-6">
        <LabeledInput
          :value="value.decodedData.apiTokenSecret"
          :disabled="step !== 1"
          class="mt-20"
          label-key="driver.pve.auth.fields.apiTokenSecret"
          :placeholder="isCreate
            ? t('driver.pve.auth.placeholders.apiTokenSecret')
            : t('driver.pve.auth.placeholders.apiTokenSecretEdit')"
          type="password"
          :mode="mode"
          @update:value="value.setData('apiTokenSecret', $event);"
        />
      </div>
    </div>

    <Banner
      v-if="!isCreate"
      color="info"
      :label="t('driver.pve.auth.hints.secretWriteOnly')"
    />

    <div class="row mt-10">
      <div class="col span-12">
        <LabeledInput
          :value="value.decodedData.caCert"
          class="mt-20"
          label-key="driver.pve.auth.fields.caCert"
          placeholder-key="driver.pve.auth.placeholders.caCert"
          type="multiline"
          :mode="mode"
          @update:value="value.setData('caCert', $event);"
        />
      </div>
    </div>
    <div class="row mt-10">
      <div class="col span-12">
        <Checkbox
          v-model:value="apiInsecure"
          :mode="mode"
          :label="t('driver.pve.auth.fields.apiInsecure')"
        />
        <p class="text-muted mt-5">
          {{ t('driver.pve.auth.hints.apiInsecure') }}
        </p>
      </div>
    </div>

    <BusyButton
      ref="connect"
      label-key="driver.pve.auth.actions.test"
      :disabled="step !== 1 || !canAuthenticate"
      class="mt-20"
      @clicked="connect"
    />

    <button
      class="btn role-primary mt-20 ml-20"
      :disabled="busy || step === 1"
      @click="clear"
    >
      {{ t('driver.pve.auth.actions.edit') }}
    </button>

    <Banner
      v-if="versionInfo"
      class="mt-20"
      color="success"
    >
      {{ t('driver.pve.auth.connected', { version: versionInfo }) }}
    </Banner>

    <Banner
      v-if="error"
      class="mt-20"
      color="error"
    >
      {{ error }}
    </Banner>

    <Banner
      v-if="warning"
      class="mt-20"
      color="warning"
    >
      {{ warning }}
    </Banner>

    <Banner
      v-if="errorAllowHost"
      color="error"
      class="allow-list-error mt-10"
    >
      <div>
        {{ t('driver.pve.auth.errors.notAllowed', { hostname }) }}
      </div>
      <button
        :disabled="allowBusy"
        class="btn ml-10 role-primary"
        @click="addHostToAllowList"
      >
        {{ t('driver.pve.auth.actions.addToAllowList') }}
      </button>
    </Banner>
  </div>
</template>

<style lang="scss" scoped>
  .allow-list-error {
    display: flex;

    > :first-child {
      flex: 1;
    }
  }
</style>