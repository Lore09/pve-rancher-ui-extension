import {
  cicustomError, parseRow, reservedKeys, rowError, rowsError, serializeRow,
} from '../extra-config';

describe('parseRow / serializeRow', () => {
  it('splits on the first equals only', () => {
    expect(parseRow('startup=order=1,up=30')).toEqual({ key: 'startup', value: 'order=1,up=30' });
    expect(parseRow('hostpci0=0000:01:00,pcie=1')).toEqual({ key: 'hostpci0', value: '0000:01:00,pcie=1' });
  });

  it('lowercases the key and trims both halves', () => {
    expect(parseRow('  CPU = host ')).toEqual({ key: 'cpu', value: 'host' });
  });

  it('round-trips', () => {
    const entry = 'hostpci0=0000:01:00,pcie=1';

    expect(serializeRow(parseRow(entry))).toBe(entry);
  });
});

describe('rowError', () => {
  const reserved = { cores: 'CPU Cores' };

  it('accepts a plain option', () => {
    expect(rowError({ key: 'cpu', value: 'host' }, reserved)).toBe('');
  });

  it('rejects a key PVE would not recognise as a key', () => {
    expect(rowError({ key: 'CPU-Type', value: 'host' }, reserved)).toContain('not a valid PVE config key');
  });

  it('rejects an empty value', () => {
    expect(rowError({ key: 'cpu', value: '' }, reserved)).toContain('no value');
  });

  it('names the field that owns a reserved key', () => {
    expect(rowError({ key: 'cores', value: '8' }, reserved)).toContain('CPU Cores');
  });
});

describe('rowsError', () => {
  it('catches a key set twice', () => {
    expect(rowsError([{ key: 'cpu', value: 'host' }, { key: 'cpu', value: 'kvm64' }])).toContain('more than once');
  });

  it('ignores blank rows', () => {
    expect(rowsError([{ key: '', value: '' }, { key: '', value: '' }])).toBe('');
  });
});

describe('reservedKeys', () => {
  it('leaves the NIC and boot disk free when the driver is not writing them', () => {
    const reserved = reservedKeys({ bootDiskDevice: 'scsi0' });

    expect(reserved.net0).toBeUndefined();
    expect(reserved.scsi0).toBeUndefined();
    expect(reserved.cores).toBeDefined();
  });

  it('claims the configured NIC, boot disk and pinned data disks', () => {
    const reserved = reservedKeys({
      netBridge:      'vmbr1',
      netDevice:      'net1',
      bootDiskSize:   '40',
      bootDiskDevice: 'scsi0',
      dataDisk:       ['size=10,storage=local-lvm,device=scsi5', 'size=10,storage=local-lvm'],
    });

    expect(reserved.net1).toBe('Network Bridge');
    expect(reserved.net0).toBeUndefined();
    expect(reserved.scsi0).toBe('Boot Disk Size');
    expect(reserved.scsi5).toBeDefined();
  });
});

describe('cicustomError', () => {
  it('accepts a vendor snippet', () => {
    expect(cicustomError('vendor=local:snippets/rancher.yaml', true)).toBe('');
  });

  it('accepts several types', () => {
    expect(cicustomError('vendor=local:snippets/a.yaml,meta=cephfs:snippets/b.yml', false)).toBe('');
  });

  it('rejects user, which would drop the generated SSH key', () => {
    expect(cicustomError('user=local:snippets/u.yaml', false)).toContain('Use vendor=');
  });

  it('rejects a network snippet only under static addressing', () => {
    expect(cicustomError('network=local:snippets/n.yaml', false)).toBe('');
    expect(cicustomError('network=local:snippets/n.yaml', true)).toContain('ipconfig0');
  });

  it('requires the snippets content path', () => {
    expect(cicustomError('vendor=local:rancher.yaml', false)).toContain('snippets/');
    expect(cicustomError('vendor=/etc/rancher.yaml', false)).toContain('snippets/');
  });

  it('rejects an unknown type and a repeated one', () => {
    expect(cicustomError('boot=local:snippets/a.yaml', false)).toContain('is not one of');
    expect(cicustomError('vendor=local:snippets/a.yaml,vendor=local:snippets/b.yaml', false)).toContain('twice');
  });

  it('is empty for an empty value', () => {
    expect(cicustomError('', true)).toBe('');
  });
});
