# pve-rancher-ui-extension

The Rancher UI extension for the [`pve`](https://github.com/lore09/pve-rancher-driver)
node driver — a Proxmox VE clone-based provisioner for RKE2/K3s node pools.

This repo ships the **Vue dashboard components** Rancher uses to render:

- the **Cloud Credential** form for the `pve` driver (labels, placeholders, a
  *Test Connection* button that reaches the live PVE `/version` endpoint through
  Rancher's proxy, and an automated allow-list fix-up when the host is blocked),
- the **Machine Config / Node Pool** form (dropdowns for the PVE cluster node,
  template VMID, storage and network bridge populated from the live PVE API,
  labelled numeric inputs for cores / sockets / memory / disk, and a VM-name
  field pre-populated from the machine name).

It does **not** ship the Go driver binary — that lives in the separate
[`pve-rancher-driver`](https://github.com/lore09/pve-rancher-driver) repository.
The two are independent: install the driver chart there to make Rancher able to
provision VMs, then install this extension here to get the polished UI for it.

## How users install the extension

Once the `pve` NodeDriver resource is registered on the Rancher local cluster
(see the driver repo's Helm chart):

1. In Rancher: **Apps → Repositories → Create → Extension repository**, then
   add this repository's `gh-pages` branch:
     - Name: `pve-rancher-ui-extension`
     - **Git Repo URL:** `https://github.com/lore09/pve-rancher-ui-extension.git`
     - **Git Branch:** `gh-pages`
2. **Apps → Extensions** lists *Proxmox VE Node Driver UI*. Click **Install**.
3. Rancher loads the extension; once active, the cloud-credential and
   machine-config forms for the `pve` driver switch from the generic
   camelCase-keyed form to the polished components shipped here.

> The extension does not edit the NodeDriver's `uiUrl` — the modern
> dashboard auto-registers Vue components named after the driver
> (`cloud-credential/pve.vue`, `machine-config/pve.vue`) via `importTypes()`.

## Allow-lists and the 502 path

Rancher only proxies to hosts explicitly listed in the `pve` NodeDriver's
`whitelistDomains`. Because every PVE install is at a different host, the
credential form watches for `502`/`503` from `/meta/proxy/...` and offers a
one-click *Add host to allow list and retry* button — the same pattern used by
Rancher's OpenStack example. The user needs the Manage Node Drivers permission
to update the driver resource.

## Repository layout

```
pve-rancher-ui-extension/
  package.json                              @rancher/shell tooling, build scripts
  vue.config.js                             vue-cli-config pulled from @rancher/shell
  babel.config.js                           tsconfig.json
  pkg/
    pve/
      package.json                          Rancher catalog annotations
      index.ts                              importTypes() self-registration
      pve.ts                                 Proxmox VE REST API helper (proxy)
      icon.svg                              picker icon
      cloud-credential/pve.vue              credential form
      machine-config/pve.vue                node pool form
      components/BusyButton.vue              test-connection button
      l10n/en-us.yaml                       UI labels + placeholders
  .github/workflows/
    ci.yml                                  yarn install + yarn build
    release.yml                             build-pkg + publish to gh-pages
```

## Development

```bash
yarn install               # fetches @rancher/shell (one-time)
yarn dev                   # vue-cli-service dev server against a running Rancher
yarn build                 # build
yarn build-pkg             # build the Helm chart package
yarn publish-pkgs          # commit chart(s) to gh-pages
```

See the [Rancher shell docs](https://github.com/rancher/shell) and the
[Custom Node Driver UI walkthrough](https://ranchermanager.docs.rancher.com/v2.14//extensions/provisioning/node-driver/overview)
for the wider context.

## License

Apache-2.0, see `LICENSE`.