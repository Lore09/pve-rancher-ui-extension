import { importTypes } from '@rancher/auto-import';
import { IPlugin } from '@shell/core/types';

// Init the package. The directory name `pve` must match the Go node-driver
// binary name; the cloud-credential and machine-config components live under
// identically-named subfolders and self-register via importTypes().
export default function(plugin: IPlugin) {
  // Auto-import localization + the cloud-credential/pve.vue and
  // machine-config/pve.vue components.
  importTypes(plugin);

  // Provider logo. The dashboard resolves a provider's icon by asking the
  // extension registry for `providers/<driverName>.svg` *before* falling back to
  // its own bundled assets, so registering this name replaces the generic gear
  // icon for `pve`. It covers both the cluster-creation provider grid and the
  // Cloud Credential type picker.
  //
  // The name must stay `providers/pve.svg` — `pve` is the driver name Rancher
  // looks up, not a display label.
  plugin.register('image', 'providers/pve.svg', require('./icon.svg'));

  // Provide plugin metadata from package.json
  plugin.metadata = require('./package.json');
}