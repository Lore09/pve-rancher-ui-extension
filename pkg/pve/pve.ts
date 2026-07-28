/**
 * Minimal helper for the Proxmox VE REST API (api2/json), reached via Rancher's
 * /meta/proxy endpoint. The user supplies the API base URL like
 * `https://host:8006/api2/json` and an API token of the form
 * `USER@REALM!TOKENID=SECRET` (single concatenated string, as printed by
 * `pveum user token add`). We authenticate by setting the
 * `X-API-Auth-Header: PVEAPIToken=<...>` header on every proxied request,
 * which Rancher's proxy turns into `Authorization` upstream.
 *
 * If the user's PVE host is not in the node driver's `whitelistDomains`, Rancher
 * returns 502/503 from the proxy; the caller is expected to surface that to the
 * user and offer to add the host to the allow-list (see cloud-credential/pve.vue).
 */
export class PveApi {
  public apiUrl: string       = '';
  public apiToken: string     = '';

  private $dispatch: any;

  constructor($store: any, obj: any) {
    if (obj.annotations) {
      Object.keys(obj.annotations).forEach((key) => {
        const p = key.split('/');

        if (p.length === 2 && p[0] === 'pve.cattle.io') {
          (this as any)[p[1]] = obj.annotations[key];
        }
      });
    } else {
      Object.keys(obj).forEach((key) => {
        (this as any)[key] = obj[key];
      });
    }

    this.$dispatch = $store.dispatch;
  }

  /** Host:port of the PVE API, stripped of scheme and path; used for the proxy prefix. */
  private get proxyBase(): string {
    const stripped = this.apiUrl.replace(/^https?:\/\//, '');

    // `/api2/json` and any trailing slash are stripped — we append paths below.
    return `/meta/proxy/${ stripped.replace(/\/api2\/json\/?$/, '') }`;
  }

  /**
   * Headers sent on every proxied request.
   *
   * The PVE credential goes in `X-API-Auth-Header`, not `Authorization`:
   * Rancher authenticates the incoming request itself, and its token
   * extraction only falls back to the `R_SESS` cookie when `Authorization`
   * is absent — a non-`Bearer`/`Basic` value there makes Rancher reject the
   * call with 401 before the proxy ever runs. `/meta/proxy` copies
   * `X-API-Auth-Header` into `Authorization` on the outbound request instead.
   */
  private authHeader(): Record<string, string> {
    return {
      Accept:                'application/json',
      'X-API-Auth-Header':   `PVEAPIToken=${ this.apiToken }`,
    };
  }

  /** Returns true if the host:port of `apiUrl` is in the driver's whitelistDomains. */
  public hostInAllowList(driver: any): boolean {
    if (!driver?.whitelistDomains) {
      return false;
    }

    const host = this.apiUrl.replace(/^https?:\/\//, '').split('/')[0];

    if (!host) {
      return true;
    }

    return (driver.whitelistDomains || []).includes(host);
  }

  public async addHostToAllowList(driver: any): Promise<boolean> {
    const host = this.apiUrl.replace(/^https?:\/\//, '').split('/')[0];

    driver.whitelistDomains = driver.whitelistDomains || [];

    if (host && !driver.whitelistDomains.includes(host)) {
      driver.whitelistDomains.push(host);
    }

    try {
      await driver.save();

      return true;
    } catch (e) {
      console.error('Could not update driver allow-list', e); // eslint-disable-line no-console

      return false;
    }
  }

  /** GET /version — used for Test Connection. Returns the cluster version or `{ error }`. */
  public async getVersion() {
    return this.request('GET', '/api2/json/version');
  }

  /** GET /nodes — list of cluster nodes. Returns an array or `{ error }`. */
  public async getNodes() {
    const res = await this.request('GET', '/api2/json/nodes');

    if (res.error) {
      return res;
    }

    return res.data || [];
  }

  /** GET /nodes/{node}/qemu — all VMs on a node; template-flagged entries are clone sources. */
  public async getTemplates(node: string) {
    const res = await this.request('GET', `/api2/json/nodes/${ node }/qemu`);

    if (res.error) {
      return res;
    }

    const all = res.data || [];
    const templates = all.filter((v: any) => v.template === 1);

    return this.toOptions(templates, 'vmid', 'name');
  }

  /** GET /nodes/{node}/storage — storage pools available on the node. */
  public async getStorage(node: string) {
    const res = await this.request('GET', `/api2/json/nodes/${ node }/storage`);

    if (res.error) {
      return res;
    }

    return this.toOptions(res.data || [], 'storage', 'storage');
  }

  /** GET /nodes/{node}/network — NIC entries; we keep only bridges (`type === 'bridge'`). */
  public async getBridges(node: string) {
    const res = await this.request('GET', `/api2/json/nodes/${ node }/network`);

    if (res.error) {
      return res;
    }

    const all = res.data || [];
    const bridges = all.filter((n: any) => n.type === 'bridge' || n.bridge_ports);

    return this.toOptions(bridges, 'iface', 'iface');
  }

  /** GET /storage — cluster-wide storage list (used in extra-disk storage dropdown). */
  public async getAllStorage() {
    const res = await this.request('GET', '/api2/json/storage');

    if (res.error) {
      return res;
    }

    return this.toOptions(res.data || [], 'storage', 'storage');
  }

  private async request(method: string, path: string): Promise<any> {
    const url = `${ this.proxyBase }${ path }`;

    try {
      const res = await this.$dispatch('management/request', {
        url,
        headers:               this.authHeader(),
        method,
        redirectUnauthorized: false,
      }, { root: true });

      // PVE wraps everything in `data`; the proxy leaves it alone.
      return res;
    } catch (e: any) {
      console.error('PVE API request failed', url, e); // eslint-disable-line no-console

      return { error: e };
    }
  }

  private toOptions(list: any[], valueKey: string, labelKey: string) {
    const sorted = (list || [])
      .slice()
      .sort((a: any, b: any) => String(a[labelKey] ?? a[valueKey]).localeCompare(String(b[labelKey] ?? b[valueKey])));

    return sorted.map((item: any) => ({
      label: item[labelKey] ?? item[valueKey],
      value: item,
    }));
  }
}