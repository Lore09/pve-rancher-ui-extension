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

  return '';
}
