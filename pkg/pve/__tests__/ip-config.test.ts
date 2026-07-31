import {
  IP_MODES, prefixError, ipStartError, ipEndError, poolError, gatewayError,
  nameserversError, requiredFieldsError, dnsCloudInitError, poolCapacity,
} from '../ip-config';

describe('IP_MODES', () => {
  it('offers exactly dhcp and static', () => {
    expect(IP_MODES.map((m) => m.value)).toEqual(['dhcp', 'static']);
  });
});

describe('prefixError', () => {
  it.each([['24'], ['/24'], ['16'], ['30'], ['8']])('accepts %s', (input) => {
    expect(prefixError(input)).toBe('');
  });

  it('rejects a prefix with no usable hosts', () => {
    expect(prefixError('31')).toContain('between 8 and 30');
  });

  it('rejects a prefix below /8', () => {
    expect(prefixError('4')).not.toBe('');
  });

  it('rejects a non-numeric prefix', () => {
    expect(prefixError('24bits')).not.toBe('');
  });

  // The whole reason the prefix is its own field.
  it('explains that it is the netmask and not the pool size', () => {
    expect(prefixError('31')).toContain('not the size of the pool');
  });

  it('treats empty as no error so the field can start blank', () => {
    expect(prefixError('')).toBe('');
  });
});

describe('ipStartError', () => {
  it('accepts an IPv4 address', () => {
    expect(ipStartError('192.168.15.150')).toBe('');
  });

  it('rejects a CIDR, since the prefix is a separate field', () => {
    expect(ipStartError('192.168.15.150/24')).not.toBe('');
  });

  it('rejects a malformed octet', () => {
    expect(ipStartError('192.168.15.999')).not.toBe('');
  });

  it('treats empty as no error', () => {
    expect(ipStartError('')).toBe('');
  });
});

describe('ipEndError', () => {
  it('accepts an end above the start', () => {
    expect(ipEndError('192.168.15.159', '192.168.15.150')).toBe('');
  });

  it('accepts an end equal to the start, a one-machine pool', () => {
    expect(ipEndError('192.168.15.150', '192.168.15.150')).toBe('');
  });

  it('rejects an end below the start', () => {
    expect(ipEndError('192.168.15.140', '192.168.15.150')).toContain('below the start');
  });

  it('stays silent while the start is still incomplete', () => {
    expect(ipEndError('192.168.15.159', '')).toBe('');
  });
});

describe('poolError', () => {
  it('accepts a pool inside one subnet', () => {
    expect(poolError('192.168.15.150', '192.168.15.159', '24')).toBe('');
  });

  // A /28 around .150 spans .144-.159, so a pool reaching .170 straddles two.
  it('rejects a pool whose ends are in different subnets', () => {
    expect(poolError('192.168.15.150', '192.168.15.170', '28')).toContain('same /28 subnet');
  });

  it('rejects a pool containing the network address', () => {
    expect(poolError('192.168.15.0', '192.168.15.10', '24')).toContain('network address');
  });

  it('rejects a pool containing the broadcast address', () => {
    expect(poolError('192.168.15.250', '192.168.15.255', '24')).toContain('broadcast address');
  });

  // The exact config that prompted the three-field design.
  it('rejects the /28 pool that ends on the subnet broadcast', () => {
    expect(poolError('192.168.15.150', '192.168.15.159', '28')).toContain('broadcast address');
  });

  it.each([
    ['', '192.168.15.159', '24'],
    ['192.168.15.150', '', '24'],
    ['192.168.15.150', '192.168.15.159', ''],
  ])('stays silent while a field is still blank (%s, %s, %s)', (a, b, c) => {
    expect(poolError(a, b, c)).toBe('');
  });
});

describe('gatewayError', () => {
  // The case that started this: outside the pool is fine, that is normal.
  it('accepts a gateway outside the pool but inside the subnet', () => {
    expect(gatewayError('192.168.15.1', '192.168.15.150', '24')).toBe('');
  });

  it('rejects a gateway outside the subnet', () => {
    expect(gatewayError('192.168.15.1', '192.168.15.150', '28')).toContain('outside the /28 subnet');
  });

  it('explains that outside the pool is allowed but outside the subnet is not', () => {
    expect(gatewayError('192.168.15.1', '192.168.15.150', '28')).toContain('outside the pool');
  });

  it('rejects a malformed gateway', () => {
    expect(gatewayError('nope', '192.168.15.150', '24')).not.toBe('');
  });

  it('stays silent while the start or prefix is incomplete', () => {
    expect(gatewayError('192.168.15.1', '', '24')).toBe('');
    expect(gatewayError('192.168.15.1', '192.168.15.150', '')).toBe('');
  });
});

describe('nameserversError', () => {
  it.each([
    ['1.1.1.1'],
    ['1.1.1.1 8.8.8.8'],
    ['1.1.1.1,8.8.8.8'],
    ['1.1.1.1, 8.8.8.8'],
    ['2606:4700:4700::1111'],
    [''],
  ])('accepts %s', (input) => {
    expect(nameserversError(input)).toBe('');
  });

  it('rejects a hostname', () => {
    expect(nameserversError('dns.example.com')).toContain('dns.example.com');
  });

  // Go's netip.ParseAddr is stricter than a character-class test.
  it.each([['2001:db8:::1'], ['::::'], ['1:2:3:4:5:6:7:8:9'], ['12345::1']])(
    'rejects the malformed IPv6 resolver %s', (input) => {
      expect(nameserversError(input)).toContain('not a valid IP address');
    },
  );
});

// The driver rejects each of these in PreCreateCheck; catching them on the form
// is the point of this mirror, so every rule gets a case.
describe('requiredFieldsError', () => {
  const ok = ['static', '192.168.15.150', '192.168.15.159', '24', '192.168.15.1', '200-299', true] as const;

  it('says nothing in dhcp mode, whatever else is empty', () => {
    expect(requiredFieldsError('dhcp', '', '', '', '', '', false)).toBe('');
  });

  it('accepts a complete static config', () => {
    expect(requiredFieldsError(...ok)).toBe('');
  });

  it('rejects a missing start address', () => {
    expect(requiredFieldsError('static', '', '192.168.15.159', '24', '192.168.15.1', '200-299', true)).toContain('start address');
  });

  it('rejects a missing end address', () => {
    expect(requiredFieldsError('static', '192.168.15.150', '', '24', '192.168.15.1', '200-299', true)).toContain('end address');
  });

  it('rejects a missing prefix', () => {
    expect(requiredFieldsError('static', '192.168.15.150', '192.168.15.159', '', '192.168.15.1', '200-299', true)).toContain('subnet prefix');
  });

  it('rejects a missing gateway', () => {
    expect(requiredFieldsError('static', '192.168.15.150', '192.168.15.159', '24', '', '200-299', true)).toContain('gateway');
  });

  it('rejects cloud-init off', () => {
    expect(requiredFieldsError('static', '192.168.15.150', '192.168.15.159', '24', '192.168.15.1', '200-299', false)).toContain('cloud-init');
  });

  it('rejects a missing VMID range', () => {
    expect(requiredFieldsError('static', '192.168.15.150', '192.168.15.159', '24', '192.168.15.1', '', true)).toContain('VMID range');
  });

  // Order matters: the form must report the same first problem the driver does.
  it('reports the start address before the end when both are missing', () => {
    expect(requiredFieldsError('static', '', '', '', '', '', true)).toContain('start address');
  });
});

describe('dnsCloudInitError', () => {
  it('says nothing when cloud-init is on', () => {
    expect(dnsCloudInitError('1.1.1.1', 'example.com', true)).toBe('');
  });

  it('says nothing when neither field is set', () => {
    expect(dnsCloudInitError('', '', false)).toBe('');
  });

  it('rejects nameservers with cloud-init off', () => {
    expect(dnsCloudInitError('1.1.1.1', '', false)).toContain('cloud-init');
  });

  it('rejects a search domain with cloud-init off', () => {
    expect(dnsCloudInitError('', 'example.com', false)).toContain('cloud-init');
  });
});

describe('poolCapacity', () => {
  it('counts both ends inclusively', () => {
    expect(poolCapacity('192.168.15.150', '192.168.15.159')).toBe(10);
  });

  it('counts a single-address pool as one machine', () => {
    expect(poolCapacity('192.168.15.150', '192.168.15.150')).toBe(1);
  });

  it('counts across an octet boundary', () => {
    expect(poolCapacity('10.10.20.250', '10.10.21.4')).toBe(11);
  });

  it('returns 0 for an incomplete or inverted pool rather than throwing', () => {
    expect(poolCapacity('', '')).toBe(0);
    expect(poolCapacity('192.168.15.159', '192.168.15.150')).toBe(0);
  });
});
