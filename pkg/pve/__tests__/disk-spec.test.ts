import {
  DiskRow, emptyRow, parseRow, rowError, serializeRow,
} from '../disk-spec';

describe('serializeRow', () => {
  it('renders a mounted disk', () => {
    const row: DiskRow = {
      size: 100, storage: 'local-lvm', fs: 'ext4', mount: '/var/lib/longhorn', backup: false, extra: [],
    };

    expect(serializeRow(row)).toBe('size=100,storage=local-lvm,fs=ext4,mount=/var/lib/longhorn,backup=0');
  });

  it('omits mount when fs is none', () => {
    const row: DiskRow = {
      size: 200, storage: 'local-lvm', fs: 'none', mount: '/ignored', backup: false, extra: [],
    };

    expect(serializeRow(row)).toBe('size=200,storage=local-lvm,fs=none,backup=0');
  });

  it('renders backup=1 when enabled', () => {
    const row: DiskRow = {
      size: 10, storage: 's', fs: 'xfs', mount: '/data', backup: true, extra: [],
    };

    expect(serializeRow(row)).toBe('size=10,storage=s,fs=xfs,mount=/data,backup=1');
  });

  it('preserves keys the form does not expose', () => {
    const row: DiskRow = {
      size: 10, storage: 's', fs: 'ext4', mount: '/data', backup: false, extra: ['label=mydata', 'device=scsi7'],
    };

    expect(serializeRow(row)).toBe('size=10,storage=s,fs=ext4,mount=/data,backup=0,label=mydata,device=scsi7');
  });
});

describe('parseRow', () => {
  it('round-trips a serialized row', () => {
    const row: DiskRow = {
      size: 100, storage: 'local-lvm', fs: 'ext4', mount: '/var/lib/longhorn', backup: true, extra: [],
    };

    expect(parseRow(serializeRow(row))).toEqual(row);
  });

  it('keeps unknown keys in extra so a hand-edited pool is not silently rewritten', () => {
    expect(parseRow('size=10,storage=s,fs=ext4,mount=/data,label=mydata')).toEqual({
      size: 10, storage: 's', fs: 'ext4', mount: '/data', backup: false, extra: ['label=mydata'],
    });
  });

  it('defaults fs to ext4 when absent', () => {
    expect(parseRow('size=10,storage=s,mount=/data').fs).toBe('ext4');
  });
});

describe('rowError', () => {
  const valid: DiskRow = {
    size: 10, storage: 's', fs: 'ext4', mount: '/data', backup: false, extra: [],
  };

  it('accepts a valid row', () => {
    expect(rowError(valid)).toBe('');
  });

  it('rejects a missing size', () => {
    expect(rowError({ ...valid, size: null })).toMatch(/size/i);
  });

  it('rejects a zero size', () => {
    expect(rowError({ ...valid, size: 0 })).toMatch(/size/i);
  });

  it('rejects a missing storage', () => {
    expect(rowError({ ...valid, storage: '' })).toMatch(/storage/i);
  });

  it('rejects a missing mount when a filesystem is set', () => {
    expect(rowError({ ...valid, mount: '' })).toMatch(/mount/i);
  });

  it('accepts a missing mount when fs is none', () => {
    expect(rowError({
      ...valid, fs: 'none', mount: '',
    })).toBe('');
  });

  it('rejects a relative mount path', () => {
    expect(rowError({ ...valid, mount: 'data' })).toMatch(/absolute/i);
  });

  it('rejects unsafe characters in the mount path', () => {
    expect(rowError({ ...valid, mount: '/data;rm -rf /' })).toMatch(/characters/i);
  });
});

describe('emptyRow', () => {
  it('starts as an ext4 disk with backups off', () => {
    expect(emptyRow()).toEqual({
      size: null, storage: '', fs: 'ext4', mount: '', backup: false, extra: [],
    });
  });
});
