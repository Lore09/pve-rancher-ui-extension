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

## Provider name and icon

Rancher shows the driver as **Proxmox VE** with the Proxmox logo in the
cluster-creation provider grid and the Cloud Credential type picker. Both come
from this repo, not from the driver chart:

- **Label and blurb**: the `cluster.provider.pve` and
  `cluster.providerDescription.pve` keys in `pkg/pve/l10n/en-us.yaml`. Without
  them the dashboard falls back to the raw driver name and renders `pve`.
- **Icon**: `pkg/pve/icon.svg`, registered in `index.ts` as
  `plugin.register('image', 'providers/pve.svg', require('./icon.svg'))`. The
  dashboard checks the extension registry for `providers/<driverName>.svg` before
  its own bundled assets, so this overrides the generic gear icon.

To replace the icon, overwrite `pkg/pve/icon.svg` — the filename is what
`index.ts` requires. The registered name `providers/pve.svg` is a lookup key, not
a filename, and must keep saying `pve`.

The `pve` in the l10n keys and in the registered image name is the driver **id**,
not a label. Rancher derives that id from the NodeDriver two different ways
depending on the page:

| Page | id comes from |
| --- | --- |
| Cluster-creation provider grid, Node Drivers list | `status.displayName` (the driver binary's name) |
| Cloud Credential type picker | `spec.displayName` |

Both must read `pve`, so the driver chart deliberately pins
`nodeDriver.displayName: pve` instead of a pretty value. Setting it to
`Proxmox VE` makes the credential picker compute the id `proxmox ve`, which
matches neither the `pvecredentialConfig` schema field nor any registration here —
the driver then renders unstyled or vanishes from the picker entirely.

The Node Drivers list page shows the name and description but no icon — the shell
renders no icon slot there.

## How requests reach Proxmox VE

Everything the forms read comes from the browser through Rancher's
`/meta/proxy/<host:port>/api2/json/...`. Three properties of that proxy drive
most of the code in `pve.ts` and the two form components:

**1. The credential goes in `X-API-Auth-Header`, never `Authorization`.**
Rancher authenticates the incoming request itself and only falls back to the
`R_SESS` cookie when `Authorization` is absent, so putting `PVEAPIToken=…` there
makes Rancher reject the call with 401 before the proxy runs. The proxy copies
`X-API-Auth-Header` into `Authorization` on the outbound request instead.

**2. Only hosts in the `pve` NodeDriver's `whitelistDomains` are reachable.**
Because every PVE install is at a different host, the credential form watches for
`502`/`503` and offers a one-click *Add host to allow list and retry* button —
the same pattern as Rancher's OpenStack example. The user needs the Manage Node
Drivers permission for that. Rancher matches `url.Hostname()`, so the entry must
be the bare hostname: `pve.example.com`, not `pve.example.com:8006`.

**3. The proxy always verifies PVE's TLS certificate** against the Rancher
server's trust store, using Go's default transport with no overrides. The
credential's `Insecure TLS` / `CA Cert` are consumed by the *driver*, which
connects to PVE directly, so they cannot help here — a stock PVE certificate
fails until its CA is added to Rancher ([how
to](https://github.com/Lore09/pve-rancher-driver/blob/master/docs/rancher-setup.md#make-rancher-trust-the-proxmox-ve-certificate)).

Since none of this affects provisioning — the driver runs in the Rancher pod and
never uses the proxy — an unreachable API degrades instead of blocking:

- `cloud-credential/pve.vue` reports a warning rather than an error when the host
  *is* allow-listed but unreachable, and still emits `validationChanged(true)` so
  the credential can be saved.
- `machine-config/pve.vue` sets `degraded`, swaps the node / template / storage /
  bridge dropdowns for text inputs bound straight to the machine config, and
  re-emits validity from watchers on the two required fields.

Keep those two paths in mind when editing either form: an error that blocks
`validationChanged` makes the credential unsavable, and a disabled
`LabeledSelect` with no options makes a pool impossible to configure.

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
is the whole release procedure — there is no tag to create by hand.

Two long-lived branches: **`dev`** for integration (open feature pull requests
against it) and **`master`** for stable. `master` takes pull requests from `dev`
only.

The branch decides what kind of release you get. The version in the file is
always plain `x.y.z`; the `-dev` suffix belongs to the tag.

| Merge into | Version | Tag | Release | Artifacts published to |
|---|---|---|---|---|
| `dev` | `0.1.4` | `v0.1.4-dev` | prerelease, not latest | `dev` |
| `master` | `0.1.4` | `v0.1.4` | stable, latest | `master` |

`version-release.yml` picks it up and:

1. validates the new version is plain semver, actually changed, has not gone
   backwards, and does not reuse an existing tag,
2. creates and pushes the tag,
3. calls `release.yml`, which builds the extension and packages the Helm chart,
4. commits `assets/`, `charts/`, `extensions/` and `index.yaml` to the branch
   above, preserving previously published versions,
5. creates a GitHub Release with auto-generated notes and the packaged chart
   attached.

After a stable release, `master` is merged back into `dev` so the branches do
not drift.

> Never put the CI skip marker (the `[skip` `ci]` form) in a commit message or
> a pull request title. It suppresses `pull_request` workflows too, so required
> checks never report and the pull request sticks at "Expected" with no error.
> Squash merges use the pull request title as the commit subject, so the title
> matters as much as the message.

To test a dev build in Rancher, add a **second** Extension Repository pointing
at the `dev` branch.

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