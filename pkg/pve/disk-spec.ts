/**
 * Row <-> string conversion for the `pve-data-disk` machine-config field.
 *
 * Rancher builds the machine-config schema from the driver's GetCreateFlags(),
 * so a list of disks can only travel as an array of strings. This module owns
 * that grammar on the browser side; the Go parser in pkg/driver/diskspec.go is
 * authoritative, and any grammar change must be made in both places.
 */

export type DiskFs = 'ext4' | 'xfs' | 'none';

export interface DiskRow {
  size: number | null;
  storage: string;
  fs: DiskFs;
  mount: string;
  backup: boolean;
  /** Keys the form does not expose (label, device, discard, iothread), kept verbatim. */
  extra: string[];
}

export const FS_OPTIONS: DiskFs[] = ['ext4', 'xfs', 'none'];

/** Must stay identical to safeShellValue in pkg/driver/diskspec.go. */
const SAFE_VALUE = /^[A-Za-z0-9._/-]+$/;

/**
 * Mirrors forbiddenMounts in pkg/driver/diskspec.go. Mounting a freshly
 * formatted disk over any of these shadows the running system.
 */
const FORBIDDEN_MOUNTS = [
  '/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib64',
  '/proc', '/root', '/run', '/sbin', '/sys', '/usr', '/var',
];

/** Mirrors forbiddenMountTrees in pkg/driver/diskspec.go. */
const FORBIDDEN_MOUNT_TREES = [
  '/bin/', '/boot/', '/dev/', '/etc/', '/lib/', '/lib64/',
  '/proc/', '/sbin/', '/sys/', '/usr/',
];

/** Mirrors normalizeMount in pkg/driver/diskspec.go. */
export function normalizeMount(path: string): string {
  let out = (path || '').trim();

  while (out.includes('//')) {
    out = out.replace(/\/\//g, '/');
  }

  return out === '/' ? out : out.replace(/\/+$/, '');
}

const FORM_KEYS = ['size', 'storage', 'fs', 'mount', 'backup'];

export function emptyRow(): DiskRow {
  return {
    size: null, storage: '', fs: 'ext4', mount: '', backup: false, extra: [],
  };
}

export function serializeRow(row: DiskRow): string {
  const parts = [
    `size=${ row.size ?? 0 }`,
    `storage=${ row.storage }`,
    `fs=${ row.fs }`,
  ];

  if (row.fs !== 'none') {
    parts.push(`mount=${ row.mount }`);
  }

  parts.push(`backup=${ row.backup ? 1 : 0 }`);

  return parts.concat(row.extra).join(',');
}

export function parseRow(entry: string): DiskRow {
  const row = emptyRow();

  (entry || '').split(',').forEach((pair) => {
    const trimmed = pair.trim();

    if (!trimmed) {
      return;
    }

    const idx = trimmed.indexOf('=');
    const key = idx === -1 ? trimmed : trimmed.slice(0, idx).trim();
    const value = idx === -1 ? '' : trimmed.slice(idx + 1).trim();

    if (!FORM_KEYS.includes(key)) {
      row.extra.push(trimmed);

      return;
    }

    switch (key) {
    case 'size':
      row.size = Number(value) || null;
      break;
    case 'storage':
      row.storage = value;
      break;
    case 'fs':
      row.fs = (FS_OPTIONS as string[]).includes(value) ? value as DiskFs : 'ext4';
      break;
    case 'mount':
      row.mount = value;
      break;
    case 'backup':
      row.backup = value === '1';
      break;
    }
  });

  return row;
}

/** Returns a human-readable problem with the row, or '' when it is valid. */
export function rowError(row: DiskRow): string {
  if (!row.size || row.size <= 0) {
    return 'Size must be a positive number of GB';
  }

  if (!row.storage) {
    return 'Storage is required';
  }

  if (row.fs === 'none') {
    return '';
  }

  if (!row.mount) {
    return 'Mount path is required unless the filesystem is "none"';
  }

  if (!row.mount.startsWith('/')) {
    return 'Mount path must be absolute';
  }

  if (!SAFE_VALUE.test(row.mount)) {
    return 'Mount path may only contain the characters A-Z a-z 0-9 . _ / -';
  }

  const mount = normalizeMount(row.mount);

  if (mount.split('/').includes('..')) {
    return "Mount path must not contain '..' segments";
  }

  if (FORBIDDEN_MOUNTS.includes(mount)) {
    return `${ mount } is a system directory — mounting a data disk there would shadow the running system. Use a subdirectory, e.g. ${ mount === '/' ? '/data' : `${ mount }/data` }`;
  }

  const tree = FORBIDDEN_MOUNT_TREES.find((t) => mount.startsWith(t));

  if (tree) {
    return `${ mount } is inside the system directory ${ tree.replace(/\/$/, '') }, which a data disk must not occupy`;
  }

  return '';
}

/**
 * Cross-row checks the per-row validator cannot see: the same mount point twice,
 * or one disk mounted inside another (legal in Linux, but the result depends on
 * mount order and can silently hide the inner disk). Mirrors
 * checkDataDiskCollisions in pkg/driver/diskspec.go.
 */
export function rowsError(rows: DiskRow[]): string {
  const mounts: string[] = [];

  for (const row of rows) {
    if (row.fs === 'none' || !row.mount) {
      continue;
    }

    const mount = normalizeMount(row.mount);

    if (mounts.includes(mount)) {
      return `Two data disks are both mounted at ${ mount }`;
    }

    const nested = mounts.find((m) => mount.startsWith(`${ m }/`) || m.startsWith(`${ mount }/`));

    if (nested) {
      return `Data disks at ${ mount } and ${ nested } are nested; mounting one inside another depends on mount order and can hide the inner one`;
    }

    mounts.push(mount);
  }

  return '';
}
