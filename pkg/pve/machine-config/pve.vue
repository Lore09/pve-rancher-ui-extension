<script>
import Loading from '@shell/components/Loading';
import { Banner } from '@components/Banner';
import CreateEditView from '@shell/mixins/create-edit-view';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { LabeledInput } from '@components/Form/LabeledInput';
import { Checkbox } from '@components/Form/Checkbox';
import { NORMAN, SECRET } from '@shell/config/types';
import { stringify } from '@shell/utils/error';
import { _VIEW } from '@shell/config/query-params';
import { PveApi } from '../pve.ts';
import {
  FS_OPTIONS, emptyRow, parseRow, rowError, rowsError, serializeRow,
} from '../disk-spec.ts';

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
    Banner, Checkbox, Loading, LabeledInput, LabeledSelect,
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
    this.diskRows = (this.value?.dataDisk || []).map((entry) => parseRow(entry));

    if ( !this.credentialId ) {
      return;
    }

    if (this.mode === _VIEW) {
      this.fakeSelectOptions(this.nodes, this.value?.node);
      this.fakeSelectOptions(this.templates, this.value?.templateVmid);
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
      diskRows:        [],
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

    // A row with an invalid size, storage or mount path must block saving: the
    // driver would reject the same value in PreCreateCheck, but only after the
    // pool has already been created.
    'value.cloudinit'() {
      this.$emit('validationChanged', this.diskRowsValid() && (!this.degraded || (!!this.value?.node && !!this.value?.templateVmid)));
    },

    diskRows: {
      deep: true,
      handler() {
        this.$emit('validationChanged', this.diskRowsValid() && (!this.degraded || (!!this.value?.node && !!this.value?.templateVmid)));
      },
    },
  },

  computed: {
    /**
     * The pve-net-* knobs are only written while rewriting the NIC, which the
     * driver only does when a bridge is named — it rejects the pool otherwise.
     * Mirror that here so the fields cannot be filled in uselessly.
     */
    netOptionsEnabled() {
      return this.degraded ? !!this.value?.netBridge : !!this.bridges.selected;
    },

    /**
     * Tri-state: empty means "leave PVE's own default alone", which a checkbox
     * cannot express and which the driver treats as distinct from false.
     */
    firewallOptions() {
      return [
        { label: this.t('driver.pve.machine.firewall.default'), value: '' },
        { label: this.t('driver.pve.machine.firewall.enabled'), value: 'true' },
        { label: this.t('driver.pve.machine.firewall.disabled'), value: 'false' },
      ];
    },

    /** True when any data disk asks for a filesystem, which requires cloud-init. */
    needsCloudInit() {
      return this.diskRows.some((row) => row.fs !== 'none');
    },

    /**
     * The VM User drives both the cloud-init account and the SSH login, so they
     * can no longer disagree. What remains is the `root` default, which neither
     * documented template permits (Debian uses `debian`, Leap Micro `rancher`)
     * and which surfaces only as a node that provisions and never reaches Ready.
     * A warning, not an error: an image with a root login is legitimate.
     */
    sshUserWarning() {
      return (this.value?.sshUser || '').trim() === 'root'
        ? this.t('driver.pve.machine.warnings.sshUserRoot')
        : '';
    },

    /** Cross-row problems the per-row validator cannot see. */
    diskRowsCrossError() {
      return rowsError(this.diskRows);
    },

    /**
     * "none" is the driver's flag value; the label says what it actually does,
     * since "none" reads like "do not attach a disk" rather than "attach it
     * unformatted".
     */
    fsOptions() {
      return FS_OPTIONS.map((fs) => ({
        label: this.t(`driver.pve.machine.fs.${ fs }`),
        value: fs,
      }));
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

      this.$emit('validationChanged', !!this.value?.node && !!this.value?.templateVmid && this.diskRowsValid());
    },

    addDiskRow() {
      this.diskRows.push(emptyRow());
    },

    removeDiskRow(idx) {
      this.diskRows.splice(idx, 1);
    },

    diskRowError(row) {
      return rowError(row);
    },

    /**
     * Every row must be valid before the pool can be saved, and a disk that
     * wants a filesystem needs cloud-init: the driver formats and mounts it
     * over SSH with the key cloud-init injects, and rejects the pool otherwise.
     */
    diskRowsValid() {
      if (this.needsCloudInit && !this.value?.cloudinit) {
        return false;
      }

      if (rowsError(this.diskRows) !== '') {
        return false;
      }

      return this.diskRows.every((row) => rowError(row) === '');
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
        // String, not Number: every field in an rke-machine-config CRD is typed
        // as a string, and an integer here is rejected outright on save.
        this.templates.options = tmpl.map((o) => ({
          label: `${ o.value.vmid } (${ o.value.name || 'unnamed' })`,
          value: String(o.value.vmid),
        }));
        this.templates.selected = this.value?.templateVmid || this.templates.options[0]?.value;
        this.templates.enabled = true;
      }

      if (!stor.error) {
        // toOptions() sets `value` to the whole PVE object; the machine config
        // needs the storage id string, so map it down here.
        this.storage.options = stor.map((o) => ({
          label: o.value.storage,
          value: o.value.storage,
        }));
        this.storage.enabled = true;
      }

      if (!brg.error) {
        // Same as storage above: toOptions() sets `value` to the whole PVE
        // object, and binding that produces `netBridge: {...}`, which the CRD
        // rejects with "must be of type string: object".
        this.bridges.options = brg.map((o) => ({
          label: o.value.iface,
          value: o.value.iface,
        }));
        this.bridges.selected = this.value?.netBridge || this.bridges.options[0]?.value;
        this.bridges.enabled = true;
      }

      this.templates.busy = this.storage.busy = this.bridges.busy = false;
    },

    test() {
      // Rows are serialized even in degraded mode: they are typed by hand there
      // too, and unlike the selects they hold real values.
      this.value.dataDisk = this.diskRows.map((row) => serializeRow(row));

      // Addressing is DHCP-only for now: the driver discovers the address through
      // the guest agent either way, and a hand-typed static ipconfig0 was a
      // silent way to strand a node on an address nothing routes to.
      this.value.ipconfig = 'ip=dhcp';

      // One field drives both: cloud-init installs the SSH keys for `ciuser`,
      // and that is the account Rancher then logs in as. The driver applies the
      // same fallback, so this only keeps the stored config self-consistent.
      this.value.ciuser = this.value.sshUser || '';

      // The driver hard-fails when a VLAN tag, MTU or firewall setting is given
      // without a bridge. Clear them rather than shipping a pool it will reject.
      if (!this.netOptionsEnabled) {
        this.value.netVlanTag = 0;
        this.value.netMtu = 0;
        this.value.netFirewall = '';
      }

      // In degraded mode the inputs are bound to `value` directly and the
      // selects hold nothing, so copying them across would wipe what was typed.
      if (!this.degraded) {
        // Syncs the form values into the bound machine-config object.
        this.value.node         = this.nodes.selected || '';
        this.value.templateVmid = this.templates.selected ?? this.value?.templateVmid ?? '';
        this.value.netBridge    = this.bridges.selected || '';
      }

      this.stringifyScalars();
    },

    /**
     * Rancher's rke-machine-config CRDs declare **every** field as a string,
     * numbers and booleans included. A number input or a checkbox binds a real
     * number or boolean, and the API then rejects the entire object with
     * `must be of type string: "integer"`. Coercing once here, on the way out,
     * is more reliable than remembering to do it at each binding.
     *
     * `dataDisk` is absent from the list on purpose: it is an array of
     * strings, which is exactly what the CRD expects.
     */
    stringifyScalars() {
      // Explicit list rather than every key of `value`: the bound object is a
      // Steve resource that also carries metadata, links and actions, and
      // rewriting those would be at best pointless and at worst destructive.
      const fields = [
        'node', 'vmid', 'templateVmid', 'vmNamePrefix',
        'cores', 'sockets', 'memory',
        'bootDiskSize', 'bootDiskDevice', 'diskSetupTimeout',
        'netIface', 'netDevice', 'netBridge', 'netModel',
        'netVlanTag', 'netMtu', 'netFirewall', 'agentTimeout',
        'cloudinit', 'ipconfig', 'ciuser', 'sshkeys', 'onboot',
        'skipPermissionCheck', 'keepOnFailure',
        'sshUser', 'sshPort',
      ];

      fields.forEach((key) => {
        const v = this.value?.[key];

        if (v === undefined) {
          return;
        }

        this.value[key] = v === null ? '' : String(v);
      });
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
      <div class="col span-4">
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
      <div class="col span-4">
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
      <div class="col span-4">
        <LabeledInput
          v-model:value="value.vmNamePrefix"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.vmNamePrefix"
          :placeholder="t('driver.pve.machine.placeholders.vmNamePrefix')"
          :tooltip="t('driver.pve.machine.hints.vmNamePrefix')"
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
          v-model:value="value.bootDiskSize"
          type="number"
          :mode="mode"
          :disabled="busy"
          label-key="driver.pve.machine.fields.bootDiskSize"
        />
      </div>
    </div>

    <div class="mt-20">
      <div class="title">
        {{ t('driver.pve.machine.fields.dataDisks') }}
      </div>
      <p class="text-muted mb-10">
        {{ t('driver.pve.machine.hints.dataDisks') }}
      </p>

      <div
        v-for="(row, idx) in diskRows"
        :key="idx"
        class="disk-entry mb-10"
      >
        <div class="disk-row row">
          <div class="col span-2">
            <LabeledInput
              v-model:value.number="row.size"
              type="number"
              :mode="mode"
              :disabled="busy"
              label-key="driver.pve.machine.fields.diskSize"
            />
          </div>
          <div class="col span-3">
            <LabeledSelect
              v-if="!degraded"
              v-model:value="row.storage"
              label-key="driver.pve.machine.fields.diskStorage"
              :options="storage.options"
              :disabled="!storage.enabled || busy"
              :loading="storage.busy"
              :searchable="true"
            />
            <LabeledInput
              v-else
              v-model:value="row.storage"
              :mode="mode"
              :disabled="busy"
              label-key="driver.pve.machine.fields.diskStorage"
              :placeholder="t('driver.pve.machine.placeholders.diskStorage')"
            />
          </div>
          <div class="col span-2">
            <LabeledSelect
              v-model:value="row.fs"
              label-key="driver.pve.machine.fields.diskFs"
              :options="fsOptions"
              :disabled="busy"
            />
          </div>
          <div class="col span-3">
            <LabeledInput
              v-model:value="row.mount"
              :mode="mode"
              :disabled="busy || row.fs === 'none'"
              label-key="driver.pve.machine.fields.diskMount"
              :placeholder="t('driver.pve.machine.placeholders.diskMount')"
            />
          </div>
          <div class="col span-1 disk-row__backup">
            <Checkbox
              v-model:value="row.backup"
              :mode="mode"
              :disabled="busy"
              :label="t('driver.pve.machine.fields.diskBackup')"
            />
          </div>
          <div class="col span-1 disk-row__remove">
            <button
              type="button"
              class="btn role-link"
              :disabled="busy"
              @click="removeDiskRow(idx)"
            >
              {{ t('driver.pve.machine.actions.removeDisk') }}
            </button>
          </div>
        </div>
        <Banner
          v-if="diskRowError(row)"
          color="error"
          class="disk-row__error"
          :label="diskRowError(row)"
        />
      </div>

      <Banner
        v-if="diskRowsCrossError"
        color="error"
        :label="diskRowsCrossError"
      />

      <button
        type="button"
        class="btn role-tertiary"
        :disabled="busy"
        @click="addDiskRow"
      >
        {{ t('driver.pve.machine.actions.addDisk') }}
      </button>
    </div>

    <div class="mt-20">
      <div class="title">
        {{ t('driver.pve.machine.fields.networking') }}
      </div>
      <p class="text-muted mb-10">
        {{ t('driver.pve.machine.hints.networking') }}
      </p>

      <div class="row">
        <div class="col span-4">
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
        <div class="col span-4">
          <LabeledInput
            v-model:value="value.netModel"
            :mode="mode"
            :disabled="busy || !netOptionsEnabled"
            label-key="driver.pve.machine.fields.netModel"
          />
        </div>
        <div class="col span-4">
          <LabeledInput
            v-model:value.number="value.netVlanTag"
            type="number"
            :mode="mode"
            :disabled="busy || !netOptionsEnabled"
            label-key="driver.pve.machine.fields.netVlanTag"
          />
        </div>
      </div>

      <div class="row mt-10">
        <div class="col span-4">
          <LabeledInput
            v-model:value.number="value.netMtu"
            type="number"
            :mode="mode"
            :disabled="busy || !netOptionsEnabled"
            label-key="driver.pve.machine.fields.netMtu"
          />
        </div>
        <div class="col span-4">
          <LabeledSelect
            v-model:value="value.netFirewall"
            label-key="driver.pve.machine.fields.netFirewall"
            :options="firewallOptions"
            :disabled="busy || !netOptionsEnabled"
          />
        </div>
      </div>
    </div>

    <div class="mt-20">
      <div class="title">
        {{ t('driver.pve.machine.fields.cloudInit') }}
      </div>
      <p class="text-muted mb-10">
        {{ t('driver.pve.machine.hints.cloudInit') }}
      </p>

      <div class="row">
        <div class="col span-4 cloudinit-toggle">
          <Checkbox
            v-model:value="value.cloudinit"
            :mode="mode"
            :disabled="busy"
            :label="t('driver.pve.machine.fields.cloudInitEnabled')"
          />
        </div>
        <div class="col span-4">
          <LabeledInput
            v-model:value="value.sshUser"
            :mode="mode"
            :disabled="busy"
            label-key="driver.pve.machine.fields.vmUser"
            :placeholder="t('driver.pve.machine.placeholders.vmUser')"
            :tooltip="t('driver.pve.machine.hints.vmUser')"
            required
          />
        </div>
        <div class="col span-4">
          <LabeledInput
            v-model:value.number="value.sshPort"
            type="number"
            :mode="mode"
            :disabled="busy"
            label-key="driver.pve.machine.fields.sshPort"
          />
        </div>
      </div>

      <Banner
        v-if="needsCloudInit && !value.cloudinit"
        color="error"
        :label="t('driver.pve.machine.errors.cloudInitRequired')"
      />
      <Banner
        v-if="sshUserWarning"
        color="warning"
        :label="sshUserWarning"
      />
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

  .disk-row {
    align-items: flex-start;

    &__backup, &__remove {
      display: flex;
      align-items: center;
      min-height: 40px;
    }

    // The banner is a sibling of the field row, not a column inside it: as a
    // column the flex row squeezed it against the right-hand edge.
    &__error {
      margin: 4px 0 0 0;
    }
  }

  .cloudinit-toggle {
    display: flex;
    align-items: center;
    min-height: 40px;
  }
</style>