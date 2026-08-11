/**
 * Row <-> string conversion and validation for the `pve-extra-config` and
 * `pve-cicustom` machine-config fields.
 *
 * The Go implementation in pkg/driver/extraconfig.go is authoritative; this
 * module exists so the form rejects what the driver would reject, before a
 * machine pool is saved and a clone is rolled back. Any rule change must be
 * made in both places.
 */

export interface ExtraConfigRow {
  key: string;
  value: string;
}

/** Mirrors extraConfigKeyPattern in pkg/driver/extraconfig.go. */
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Mirrors ciCustomVolumePattern in pkg/driver/extraconfig.go. */
const CICUSTOM_VOLUME = /^[A-Za-z0-9._-]+:snippets\/[A-Za-z0-9._/-]+$/;

/** Mirrors ciCustomTypes in pkg/driver/extraconfig.go. */
const CICUSTOM_TYPES = ['meta', 'network', 'user', 'vendor'];

export function emptyRow(): ExtraConfigRow {
  return { key: '', value: '' };
}

export function serializeRow(row: ExtraConfigRow): string {
  return `${ (row.key || '').trim() }=${ (row.value || '').trim() }`;
}

/**
 * One entry is one key, split on its first `=` only: PVE config values are
 * themselves comma- and equals-separated property strings (`startup=order=1,up=30`),
 * so everything after the first separator belongs to the value.
 */
export function parseRow(entry: string): ExtraConfigRow {
  const trimmed = (entry || '').trim();
  const idx = trimmed.indexOf('=');

  if (idx === -1) {
    return { key: trimmed, value: '' };
  }

  return {
    key:   trimmed.slice(0, idx).trim().toLowerCase(),
    value: trimmed.slice(idx + 1).trim(),
  };
}

/**
 * The PVE config keys the driver writes itself, mapped to the field that owns
 * each one. Mirrors Driver.reservedConfigKeys in pkg/driver/driver.go, including
 * its conditionals: a key the driver is not writing for *this* configuration is
 * fair game, and reserving it unconditionally would refuse a safe entry.
 */
export function reservedKeys(value: any = {}): Record<string, string> {
  const reserved: Record<string, string> = {
    agent:       'the driver itself (the guest agent is required for IP discovery)',
    name:        'VM Name Prefix',
    cores:       'CPU Cores',
    sockets:     'CPU Sockets',
    memory:      'Memory',
    onboot:      'Start on boot',
    tags:        'Tags',
    description: 'Description',
    // Cloud-init is always on, so these are unconditional here even though the
    // Go side gates them on the same flag.
    ipconfig0:    'Addressing',
    nameserver:   'DNS servers',
    searchdomain: 'DNS search domain',
    ciuser:       'VM User',
    sshkeys:      'VM User',
    cicustom:     'Cloud-init Snippets',
  };

  if (value?.netBridge) {
    reserved[(value.netDevice || 'net0').trim().toLowerCase()] = 'Network Bridge';
  }

  if (Number(value?.bootDiskSize) > 0) {
    reserved[(value.bootDiskDevice || 'scsi0').trim().toLowerCase()] = 'Boot Disk Size';
  }

  (value?.dataDisk || []).forEach((entry: string) => {
    const device = /(?:^|,)\s*device=([^,]+)/.exec(entry || '')?.[1]?.trim().toLowerCase();

    if (device) {
      reserved[device] = `the data disk pinned to ${ device }`;
    }
  });

  return reserved;
}

/** Returns a human-readable problem with the row, or '' when it is valid. */
export function rowError(row: ExtraConfigRow, reserved: Record<string, string> = {}): string {
  const key = (row.key || '').trim().toLowerCase();
  const value = (row.value || '').trim();

  if (!key && !value) {
    return 'Key is required';
  }

  if (!KEY_PATTERN.test(key)) {
    return `"${ key }" is not a valid PVE config key — use lowercase letters, digits and underscores, e.g. cpu, numa, hostpci0`;
  }

  if (!value) {
    return `${ key } has no value. PVE cannot express "unset" here, so remove the row instead`;
  }

  if (/[\r\n]/.test(value)) {
    return `${ key } must be a single line`;
  }

  if (reserved[key]) {
    return `${ key } is set by the driver from ${ reserved[key] } — setting it here would be undone, or would break the driver's own use of it`;
  }

  return '';
}

/** Cross-row check: PVE keeps one value per key, so only the last would apply. */
export function rowsError(rows: ExtraConfigRow[]): string {
  const seen: string[] = [];

  for (const row of rows) {
    const key = (row.key || '').trim().toLowerCase();

    if (!key) {
      continue;
    }

    if (seen.includes(key)) {
      return `${ key } is set more than once`;
    }

    seen.push(key);
  }

  return '';
}

/**
 * Validates the `cicustom` property string. staticIP reports whether the driver
 * is generating ipconfig0 itself, which a `network=` snippet would replace.
 */
export function cicustomError(raw: string, staticIP: boolean): string {
  const trimmed = (raw || '').trim();

  if (!trimmed) {
    return '';
  }

  const seen: string[] = [];

  for (const part of trimmed.split(',')) {
    const entry = part.trim();

    if (!entry) {
      continue;
    }

    const idx = entry.indexOf('=');
    const type = idx === -1 ? '' : entry.slice(0, idx).trim().toLowerCase();
    const volume = idx === -1 ? '' : entry.slice(idx + 1).trim();

    if (!type || !volume) {
      return `"${ entry }" is not a type=volume pair, e.g. vendor=local:snippets/rancher.yaml`;
    }

    if (!CICUSTOM_TYPES.includes(type)) {
      return `"${ type }" is not one of ${ CICUSTOM_TYPES.join(', ') }`;
    }

    if (seen.includes(type)) {
      return `${ type } is set twice — PVE takes one snippet per type`;
    }

    seen.push(type);

    if (!CICUSTOM_VOLUME.test(volume)) {
      return `"${ volume }" must be <storage>:snippets/<file>, e.g. local:snippets/rancher.yaml. PVE only reads cicustom from a storage with the snippets content type enabled`;
    }
  }

  // PVE generates user-data *or* takes yours, never both, and the generated one
  // is what carries the SSH key the driver and Rancher log in with. That key is
  // minted per machine, so no pre-written snippet can contain it.
  if (seen.includes('user')) {
    return 'user= replaces the cloud-init user-data PVE generates, which is the only thing carrying the SSH key the driver and Rancher log in with — and that key is generated per machine, so no snippet can contain it. Use vendor= instead: PVE generates no vendor-data, so yours is merged rather than substituted';
  }

  if (seen.includes('network') && staticIP) {
    return 'network= replaces the network configuration PVE renders from ipconfig0, which is how static addressing assigns each machine its address. Drop the network snippet, or switch Addressing to DHCP and let the snippet own it';
  }

  return '';
}
