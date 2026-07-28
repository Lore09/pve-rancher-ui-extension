# pve-rancher-ui-extension

The Rancher UI extension for the [`pve`](https://github.com/Lore09/pve-rancher-driver)
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
[`pve-rancher-driver`](https://github.com/Lore09/pve-rancher-driver) repository.
The two are independent: install the driver chart there to make Rancher able to
provision VMs, then install this extension here to get the polished UI for it.

## How users install the extension

Once the `pve` NodeDriver resource is registered on the Rancher local cluster
(see the driver repo's Helm chart):

1. In Rancher: **Apps → Repositories → Create → Extension repository**, then
   add this repository's `master` branch:
     - Name: `pve-rancher-ui-extension`
     - **Git Repo URL:** `https://github.com/Lore09/pve-rancher-ui-extension.git`
     - **Git Branch:** `master`
2. **Apps → Extensions** lists *Proxmox VE Node Driver UI*. Click **Install**.
3. Rancher loads the extension; once active, the cloud-credential and
   machine-config forms for the `pve` driver switch from the generic
   camelCase-keyed form to the polished components shipped here.

Alternatively, each release attaches the packaged Helm chart
(`pve-<version>.tgz`) to its [GitHub
Release](https://github.com/Lore09/pve-rancher-ui-extension/releases), so the
chart can be installed directly without registering an Extension Repository.

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

Hand-written sources:

```
pve-rancher-ui-extension/
  package.json                            @rancher/shell tooling, build scripts
  vue.config.js                           vue-cli config pulled from @rancher/shell
  babel.config.js                         babel config
  tsconfig.json                           TypeScript config
  pkg/
    pve/
      package.json                        version + Rancher catalog annotations
      index.ts                            importTypes() self-registration
      pve.ts                              Proxmox VE REST API helper (proxy)
      icon.svg                            picker icon
      cloud-credential/pve.vue            credential form
      machine-config/pve.vue              node pool form
      components/BusyButton.vue           test-connection button
      l10n/en-us.yaml                     UI labels + placeholders
      babel.config.js                     per-package build config
      tsconfig.json                       per-package build config
      vue.config.js                       per-package build config
  .github/workflows/
    ci.yml                                yarn install + build-pkg on PRs
    version-release.yml                   watches the version, tags, calls release
    release.yml                           build-pkg, publish to master, GitHub Release
```

Generated and committed to `master` by the release workflow — do not edit by
hand, they are overwritten on every release:

```
  index.yaml                              Helm repo index Rancher reads
  assets/pve/pve-<version>.tgz            packaged Helm chart
  charts/pve/<version>/                   unpacked chart source
  extensions/pve/<version>/               built plugin bundle Rancher loads
  extensions/pve/<version>.tgz            compressed bundle (compressedEndpoint)
```

## Development

```bash
yarn install --frozen-lockfile   # fetches @rancher/shell (one-time)
yarn dev                         # dev server against a running Rancher
yarn build-pkg pve               # compile the extension into dist-pkg/
```

`yarn build` is inherited from `@rancher/shell` and runs the *full dashboard*
build, which expects a dashboard monorepo layout — it does not work in a
standalone extension repo. Use `yarn build-pkg pve` instead.

`yarn publish-pkgs` builds the chart and writes `assets/`, `charts/`,
`extensions/` and `index.yaml` into the working tree. It does **not** commit or
push anything; the release workflow is what publishes those to `master`.

See the [Rancher shell docs](https://github.com/rancher/shell) and the
[Custom Node Driver UI walkthrough](https://ranchermanager.docs.rancher.com/v2.14//extensions/provisioning/node-driver/overview)
for the wider context.

## Releasing

**`version` in `pkg/pve/package.json` is the single source of truth.** Bumping it
on `master` is the whole release procedure — there is no tag to create by hand:

```bash
vim pkg/pve/package.json          # e.g. "version": "0.1.4"
git commit -am "Bump version to 0.1.4"
git push
```

`version-release.yml` picks it up from there and:

1. validates the new version is semver, actually changed, has not gone
   backwards, and does not reuse an existing tag,
2. creates and pushes the `v0.1.4` tag,
3. calls `release.yml`, which builds the extension and packages the Helm chart,
4. commits `assets/`, `charts/`, `extensions/` and `index.yaml` to `master`,
   preserving previously published versions,
5. creates a GitHub Release for `v0.1.4` with auto-generated notes and the
   packaged chart attached.

Because the tag is derived from the file, a release can never claim a version the
extension does not. Pushing a `v*` tag manually does **not** start a release;
`release.yml` is reachable only through `version-release.yml`.

> The path filter on `version-release.yml` watches `pkg/pve/package.json` and
> nothing else. That is what stops step 4's commit from re-triggering it and
> looping forever — do not broaden it.

The root `package.json` deliberately has no `version` field, so there is exactly
one place a version can live.

## License

MIT, see `LICENSE`.