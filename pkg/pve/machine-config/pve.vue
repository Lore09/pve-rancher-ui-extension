<script>
import Loading from '@shell/components/Loading';
import { Banner } from '@components/Banner';
import CreateEditView from '@shell/mixins/create-edit-view';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { LabeledInput } from '@components/Form/LabeledInput';
import { NORMAN, SECRET } from '@shell/config/types';
import { stringify } from '@shell/utils/error';
import { _VIEW } from '@shell/config/query-params';
import { PveApi } from '../pve.ts';

function initOptions() {
  return {
    options:  [],
    selected: null,
    busy:     false,
    enabled:  false,
  };
}

export default {
  components: {
    Banner, Loading, LabeledInput, LabeledSelect,
  },

  mixins: [CreateEditView],

  props: {
    uuid: {
      type:     String,
      required: true,
    },

    cluster: {
      type:    Object,
      default: () => ({})
    },

    credentialId: {
      type:     String,
      required: true,
    },

    disabled: {
      type:    Boolean,
      default: false
    },

    busy: {
      type:    Boolean,
      default: false
    },

    provider: {
      type:     String,
      required: true,
    }
  },

  async fetch() {
    this.errors = [];
    if ( !this.credentialId ) {
      return;
    }

    if (this.mode === _VIEW) {
      this.fakeSelectOptions(this.nodes, this.value?.node);
      this.fakeSelectOptions(this.templates, this.value?.templateVmid);
      this.fakeSelectOptions(this.storage, this.value?.extraDiskStorage);
      this.fakeSelectOptions(this.bridges, this.value?.netBridge);

      return;
    }

    try {
      this.credential = await this.$store.dispatch('rancher/find', { type: NORMAN.CLOUD_CREDENTIAL, id: this.credentialId });
    } catch (e) {
      this.credential = null;
    }

    // Cloud credentials hand the driver only the secret value; PVE stores the
    // full token as `USER@REALM!TOKENID=SECRET` in the apiTokenSecret field,
    // so we read it back from the backing Secret to reconstruct the header.
    let api = null;

    try {
      const id = this.credentialId.replace(':', '/');
      const secret = await this.$store.dispatch('management/find', { type: SECRET, id });
      const data = secret.data['pvecredentialConfig-apiTokenSecret'];
      const secretValue = atob(data);

      api = new PveApi(this.$store, {
        apiUrl:    atob(secret.data['pvecredentialConfig-apiUrl'] || ''),
        apiToken:  `${ atob(secret.data['pvecredentialConfig-apiTokenId'] || '') }=${ secretValue }`,
      });
    } catch (e) {
      console.error(e); // eslint-disable-line no-console
      this.errors.push('Unable to read the cloud credential secret');

      return;
    }

    this.api = api;
    this.ready = true;
    this.authenticating = true;

    // Kick off node list load; subsequent dropdowns chain off the selected node.
    const res = await this.api.getNodes();

    this.authenticating = false;

    if (res.error) {
      // The PVE API is not reachable through Rancher's /meta/proxy — typically
      // because the Rancher server does not trust the PVE certificate, which the
      // proxy always verifies and cannot be told to skip. The driver itself does
      // not use this proxy, so provisioning still works; fall back to typing the
      // four discovered fields by hand instead of blocking the form. The cloud
      // credential surfaces the same condition as a warning.
      this.degraded = true;
      this.errors.push(this.t('driver.pve.machine.errors.unreachable'));
      this.emitDegradedValidation();

      return;
    }

    this.nodes.options = res.map((n) => ({ label: n.node, value: n.node }));
    this.nodes.busy = false;
    this.nodes.enabled = true;
    this.nodes.selected = this.value?.node || this.nodes.options[0]?.value;

    if (this.nodes.selected) {
      this.loadNodeSpecific(this.nodes.selected);
    }

    this.$emit('validationChanged', true);
  },

  data() {
    return {
      authenticating:  false,
      ready:           false,
      // True when the PVE API could not be reached: the dropdowns are replaced
      // by free-text inputs bound straight to the machine config.
      degraded:        false,
      api:             null,
      credential:      null,
      nodes:           initOptions(),
      templates:       initOptions(),
      storage:         initOptions(),
      bridges:         initOptions(),
      errors:          null,
    };
  },

  watch: {
    'credentialId'() {
      this.$fetch();
    },

    'nodes.selected'(node) {
      if (node) {
        this.loadNodeSpecific(node);
      }
    },

    // In degraded mode the two required fields are typed rather than picked, so
    // validity has to be re-reported as they change.
    'value.node'() {
      this.emitDegradedValidation();
    },

    'value.templateVmid'() {
      this.emitDegradedValidation();
    },
  },

  methods: {
    stringify,

    /**
     * Node and template are the only fields the driver cannot default, so in
     * degraded mode they decide whether the pool is valid. No-op when the
     * dropdowns loaded normally, where `fetch` already reported validity.
     */
    emitDegradedValidation() {
      if (!this.degraded) {
        return;
      }

      this.$emit('validationChanged', !!this.value?.node && !!this.value?.templateVmid);
    },

    fakeSelectOptions(list, value) {
      list.busy = false;
      list.enabled = false;
      list.options = [];

      if (value) {
        list.options.push({ label: String(value), value });
      }

      list.selected = value;
    },

    async loadNodeSpecific(node) {
      this.templates.busy = this.storage.busy = this.bridges.busy = true;
      this.templates.enabled = this.storage.enabled = this.bridges.enabled = false;

      const [tmpl, stor, brg] = await Promise.all([
        this.api.getTemplates(node),
        this.api.getStorage(node),
        this.api.getBridges(node),
      ]);

      if (!tmpl.error) {
        this.templates.options = tmpl.map((o) => ({
          label: `${ o.value.vmid } (${ o.value.name || 'unnamed' })`,
          value: Number(o.value.vmid),
        }));
        this.templates.selected = this.value?.templateVmid || this.templates.options[0]?.value;
        this.templates.enabled = true;
      }

      if (!stor.error) {
        this.storage.options = stor;
        this.storage.selected = this.value?.extraDiskStorage || this.storage.options[0]?.value;
        this.storage.enabled = true;
      }

      if (!brg.error) {
        this.bridges.options = brg;
        this.bridges.selected = this.value?.netBridge || this.bridges.options[0]?.value;
        this.bridges.enabled = true;
      }

      this.templates.busy = this.storage.busy = this.bridges.busy = false;
    },

    test() {
      // In degraded mode the inputs are bound to `value` directly and the
      // selects hold nothing, so copying them across would wipe what was typed.
      if (this.degraded) {
        return;
      }

      // Syncs the form values into the bound machine-config object.
      this.value.node             = this.nodes.selected || '';
      this.value.templateVmid     = this.templates.selected ?? this.value?.templateVmid ?? 0;
      this.value.extraDiskStorage = this.storage.selected || '';
      this.value.netBridge        = this.bridges.selected || '';
    },
  },
};
</script>

<template>
  <div>
    <Loading
      v-if="$fetchState.pending"
      :delayed="true"
    />
    <div v-if="errors && errors.length">
      <div
        v-for="(err, idx) in errors"
        :key="idx"
      >
        <Banner
          :color="degraded ? 'warning' : 'error'"
          :label="stringify(err)"
        />
      </div>
    </div>

    <div class="pve-config">
      <div class="title">
        {{ t('driver.pve.machine.title') }}
      </div>
      <div
        v-if="authenticating"
        class="loading"
      >
        <i class="icon-spinner icon-spin icon-lg" />
        <span>
          {{ t('driver.pve.machine.loading') }}
        </span>
      </div>
    </div>

    <div class="row mt-10">
      <div class="col span-6">
        <LabeledSelect
          v-if="!degraded"
          v-model:value="nodes.selected"
          label-key="driver.pve.machine.fields.node"
          :options="nodes.options"
          :disabled="!nodes.enabled || busy"
          :loading="nodes.busy"
          :searchable="true"
        />
        <LabeledInput
          v-else
          v-model:value="value.node"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.node"
          :placeholder="t('driver.pve.machine.placeholders.node')"
          required
        />
      </div>
      <div class="col span-6">
        <LabeledSelect
          v-if="!degraded"
          v-model:value="templates.selected"
          label-key="driver.pve.machine.fields.template"
          :options="templates.options"
          :disabled="!templates.enabled || busy"
          :loading="templates.busy"
          :searchable="true"
        />
        <LabeledInput
          v-else
          v-model:value.number="value.templateVmid"
          type="number"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.template"
          :placeholder="t('driver.pve.machine.placeholders.template')"
          required
        />
      </div>
    </div>

    <div class="row mt-10">
      <div class="col span-4">
        <LabeledInput
          v-model:value="value.cores"
          type="number"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.cores"
        />
      </div>
      <div class="col span-4">
        <LabeledInput
          v-model:value="value.sockets"
          type="number"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.sockets"
        />
      </div>
      <div class="col span-4">
        <LabeledInput
          v-model:value="value.memory"
          type="number"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.memory"
        />
      </div>
    </div>

    <div class="row mt-10">
      <div class="col span-4">
        <LabeledInput
          v-model:value="value.disk"
          type="number"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.disk"
        />
      </div>
      <div class="col span-4">
        <LabeledInput
          v-model:value="value.extraDiskSize"
          type="number"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.extraDiskSize"
        />
      </div>
      <div class="col span-4">
        <LabeledSelect
          v-if="!degraded"
          v-model:value="storage.selected"
          label-key="driver.pve.machine.fields.extraDiskStorage"
          :options="storage.options"
          :disabled="!storage.enabled || busy"
          :loading="storage.busy"
          :searchable="true"
        />
        <LabeledInput
          v-else
          v-model:value="value.extraDiskStorage"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.extraDiskStorage"
          :placeholder="t('driver.pve.machine.placeholders.extraDiskStorage')"
        />
      </div>
    </div>

    <div class="row mt-10">
      <div class="col span-6">
        <LabeledSelect
          v-if="!degraded"
          v-model:value="bridges.selected"
          label-key="driver.pve.machine.fields.netBridge"
          :options="bridges.options"
          :disabled="!bridges.enabled || busy"
          :loading="bridges.busy"
          :searchable="true"
        />
        <LabeledInput
          v-else
          v-model:value="value.netBridge"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.netBridge"
          :placeholder="t('driver.pve.machine.placeholders.netBridge')"
        />
      </div>
      <div class="col span-6">
        <LabeledInput
          v-model:value="value.vmName"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.vmName"
          :placeholder="uuid"
        />
      </div>
    </div>

    <div class="row mt-10">
      <div class="col span-6">
        <LabeledInput
          v-model:value="value.netModel"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.netModel"
        />
      </div>
      <div class="col span-6">
        <LabeledInput
          v-model:value="value.netVlanTag"
          type="number"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.netVlanTag"
        />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
  .pve-config {
    display: flex;
    align-items: center;

    > .title {
      font-weight: bold;
      padding: 4px 0;
    }

    > .loading {
      margin-left: 20px;
      display: flex;
      align-items: center;

      > i {
        margin-right: 4px;
      }
    }
  }
</style>