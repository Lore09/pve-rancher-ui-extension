import { importTypes } from '@rancher/auto-import';
import { IPlugin } from '@shell/core/types';

// Init the package. The directory name `pve` must match the Go node-driver
// binary name; the cloud-credential and machine-config components live under
// identically-named subfolders and self-register via importTypes().
export default function(plugin: IPlugin) {
  // Auto-import localization + the cloud-credential/pve.vue and
  // machine-config/pve.vue components.
  importTypes(plugin);

  // Provide plugin metadata from package.json
  plugin.metadata = require('./package.json');
}