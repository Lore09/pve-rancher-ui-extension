import {
  IP_MODES, ipBaseError, gatewayError, nameserversError, spanError, poolCapacity,
  requiredFieldsError, dnsCloudInitError,
} from '../ip-config';

describe('IP_MODES', () => {
  it('offers exactly dhcp and static', () => {
    expect(IP_MODES.map((m) => m.value)).toEqual(['dhcp', 'static']);
  });
});

describe('ipBaseError', () => {
  it('accepts an IPv4 CIDR', () => {
    expect(ipBaseError('10.10.20.10/24')).toBe('');
  });

  it('rejects a bare address with no prefix', () => {
    expect(ipBaseError('10.10.20.10')).toContain('prefix');
  });

  it('rejects a prefix with no usable hosts', () => {
    expect(ipBaseError('10.10.20.10/31')).toContain('/30');
  });

  it('rejects a malformed octet', () => {
    expect(ipBaseError('10.10.20.999/24')).not.toBe('');
  });

  it('rejects IPv6', () => {
    expect(ipBaseError('2001:db8::10/64')).toContain('IPv4');
  });

  it('treats empty as no error so the field can start blank', () => {
    expect(ipBaseError('')).toBe('');
  });
});

describe('gatewayError', () => {
  it('accepts a gateway inside the subnet', () => {
    expect(gatewayError('10.10.20.1', '10.10.20.10/24')).toBe('');
  });

  it('rejects a gateway outside the subnet', () => {
    expect(gatewayError('10.10.99.1', '10.10.20.10/24')).toContain('subnet');
  });

  it('rejects a malformed gateway', () => {
    expect(gatewayError('nope', '10.10.20.10/24')).not.toBe('');
  });

  it('stays silent while the base is still incomplete', () => {
    expect(gatewayError('10.10.20.1', '')).toBe('');
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
});

describe('spanError', () => {
  it('accepts a range that fits the subnet', () => {
    expect(spanError('10.10.20.10/24', '200-299')).toBe('');
  });

  // Accepted on purpose: VMIDs are handed out lowest-free-first, so machines
  // cluster at the bottom of the range and the subnet only has to hold the
  // machines that exist at once. The driver reports per-machine exhaustion.
  it('accepts a VMID range wider than the subnet', () => {
    expect(spanError('10.10.20.200/24', '200-299')).toBe('');
  });

  it('accepts a /30 base with a wide VMID range', () => {
    expect(spanError('10.10.20.9/30', '200-299')).toBe('');
  });

  it('rejects a base that is the network address', () => {
    expect(spanError('10.10.20.0/24', '200-299')).toContain('network address');
  });

  it('rejects a base that is the broadcast address', () => {
    expect(spanError('10.10.20.255/24', '200-299')).toContain('broadcast address');
  });

  it('stays silent when the range is not set yet', () => {
    expect(spanError('10.10.20.10/24', '')).toBe('');
  });
});

// The driver rejects each of these in PreCreateCheck; catching them on the form
// is the whole point of this mirror, so every rule gets a case here.
describe('requiredFieldsError', () => {
  it('says nothing in dhcp mode, whatever else is empty', () => {
    expect(requiredFieldsError('dhcp', '', '', '', false)).toBe('');
  });

  it('rejects static mode with no base address', () => {
    expect(requiredFieldsError('static', '', '10.10.20.1', '200-299', true)).toContain('base address');
  });

  it('rejects static mode with no gateway', () => {
    expect(requiredFieldsError('static', '10.10.20.10/24', '', '200-299', true)).toContain('gateway');
  });

  it('rejects static mode with cloud-init off', () => {
    expect(requiredFieldsError('static', '10.10.20.10/24', '10.10.20.1', '200-299', false)).toContain('cloud-init');
  });

  it('rejects static mode with no VMID range', () => {
    expect(requiredFieldsError('static', '10.10.20.10/24', '10.10.20.1', '', true)).toContain('VMID range');
  });

  it('accepts a complete static config', () => {
    expect(requiredFieldsError('static', '10.10.20.10/24', '10.10.20.1', '200-299', true)).toBe('');
  });

  // Order matters: the form should report the same first problem the driver
  // would, and the driver checks the base before the gateway.
  it('reports the base before the gateway when both are missing', () => {
    expect(requiredFieldsError('static', '', '', '', true)).toContain('base address');
  });

  // Cloud-init is checked before the VMID range in validateAddressing.
  it('reports cloud-init before the VMID range when both are wrong', () => {
    expect(requiredFieldsError('static', '10.10.20.10/24', '10.10.20.1', '', false)).toContain('cloud-init');
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

// Go's netip.ParseAddr is stricter than a character-class test, and anything it
// rejects fails at provision time instead of on the form.
describe('address strictness matches Go', () => {
  it.each([
    ['2001:db8:::1'],
    ['::::'],
    ['1:2:3:4:5:6:7:8:9'],
    ['12345::1'],
    ['1:2:3:4:5:6:7'],
  ])('rejects the malformed IPv6 resolver %s', (input) => {
    expect(nameserversError(input)).toContain('not a valid IP address');
  });

  it.each([
    ['::'],
    ['::1'],
    ['2606:4700:4700::1111'],
    ['1:2:3:4:5:6:7:8'],
  ])('accepts the well-formed IPv6 resolver %s', (input) => {
    expect(nameserversError(input)).toBe('');
  });

  it('rejects an octet with a leading zero', () => {
    expect(ipBaseError('010.10.20.10/24')).toContain('IPv4 address with a prefix');
  });

  it('rejects a leading zero in a gateway octet', () => {
    expect(gatewayError('10.10.20.01', '10.10.20.10/24')).toContain('IPv4 address');
  });

  it('still accepts a bare zero octet', () => {
    expect(ipBaseError('10.0.20.10/24')).toBe('');
  });
});

describe('poolCapacity', () => {
  it('counts the addresses from the base to the end of the subnet', () => {
    // .9 on a /30 (.8-.11) leaves .9 and .10 usable before the .11 broadcast.
    expect(poolCapacity('10.10.20.9/30')).toBe(2);
  });

  it('counts a full /24 from its first host', () => {
    expect(poolCapacity('10.10.20.1/24')).toBe(254);
  });

  it('shrinks as the base moves up the subnet', () => {
    expect(poolCapacity('10.10.20.250/24')).toBe(5);
  });

  it('returns 0 for an unparseable base rather than throwing', () => {
    expect(poolCapacity('')).toBe(0);
    expect(poolCapacity('nonsense')).toBe(0);
  });
});
