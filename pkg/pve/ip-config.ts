// Client-side mirror of pkg/driver/ipconfig.go. Keeping the rules here means a
// bad address is caught on the form rather than after a VM has been cloned.
// When the Go rules change, change these too.

export const IP_MODES = [
  { value: 'dhcp', labelKey: 'driver.pve.machine.ipModes.dhcp' },
  { value: 'static', labelKey: 'driver.pve.machine.ipModes.static' },
];

const MIN_PREFIX_BITS = 30;

function parseIPv4(addr: string): number | null {
  const parts = addr.trim().split('.');

  if (parts.length !== 4) {
    return null;
  }

  let value = 0;

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    // Go's netip.ParseAddr rejects leading zeros, so "010.10.20.10" would pass
    // the form and then fail in PreCreateCheck. "0" itself is fine.
    if (part.length > 1 && part.startsWith('0')) {
      return null;
    }
    const n = Number(part);

    if (n > 255) {
      return null;
    }
    value = value * 256 + n;
  }

  return value;
}

interface Prefix {
  addr: number;
  bits: number;
}

function parsePrefix(base: string): Prefix | null {
  const [addrPart, bitsPart, ...rest] = base.trim().split('/');

  if (rest.length > 0 || bitsPart === undefined) {
    return null;
  }
  if (!/^\d{1,2}$/.test(bitsPart)) {
    return null;
  }
  const bits = Number(bitsPart);
  const addr = parseIPv4(addrPart);

  if (addr === null || bits > 32) {
    return null;
  }

  return { addr, bits };
}

function networkOf(p: Prefix): number {
  // >>> 0 keeps the result unsigned; JS bitwise ops are signed 32-bit.
  const mask = p.bits === 0 ? 0 : (0xFFFFFFFF << (32 - p.bits)) >>> 0;

  return (p.addr & mask) >>> 0;
}

function broadcastOf(p: Prefix): number {
  const hosts = p.bits === 32 ? 0 : 2 ** (32 - p.bits) - 1;

  return networkOf(p) + hosts;
}

function contains(p: Prefix, addr: number): boolean {
  return addr >= networkOf(p) && addr <= broadcastOf(p);
}

const MIN_PREFIX = 8;

/** Parses --pve-ip-prefix, accepting either "24" or "/24". */
function parseBits(prefix: string): number | null {
  const t = prefix.trim().replace(/^\//, '');

  if (!/^\d{1,2}$/.test(t)) {
    return null;
  }
  const bits = Number(t);

  if (bits < MIN_PREFIX || bits > MIN_PREFIX_BITS) {
    return null;
  }

  return bits;
}

export function prefixError(prefix: string): string {
  if (!prefix.trim()) {
    return '';
  }
  if (parseBits(prefix) === null) {
    return `Must be a prefix length between ${ MIN_PREFIX } and ${ MIN_PREFIX_BITS }, for example 24. This is the netmask the machines get, not the size of the pool.`;
  }

  return '';
}

export function ipStartError(start: string): string {
  if (!start.trim()) {
    return '';
  }
  if (parseIPv4(start) === null) {
    return 'Must be an IPv4 address, for example 192.168.15.150';
  }

  return '';
}

export function ipEndError(end: string, start: string): string {
  if (!end.trim()) {
    return '';
  }
  const e = parseIPv4(end);

  if (e === null) {
    return 'Must be an IPv4 address, for example 192.168.15.159';
  }
  const st = parseIPv4(start);

  if (st !== null && e < st) {
    return 'Must not be below the start address.';
  }

  return '';
}

/**
 * Checks the pool as a whole: both ends in the same subnet, and neither end on
 * the subnet's network or broadcast address.
 */
export function poolError(start: string, end: string, prefix: string): string {
  const st = parseIPv4(start);
  const e = parseIPv4(end);
  const bits = parseBits(prefix);

  // Stay silent until all three are present and individually valid, or the user
  // sees a spurious pool error while still typing.
  if (st === null || e === null || bits === null || e < st) {
    return '';
  }
  const p: Prefix = { addr: st, bits };

  if (!contains(p, e)) {
    return `The start and end addresses are not in the same /${ bits } subnet. Widen the subnet prefix, or move one end of the pool.`;
  }
  if (st === networkOf(p) || e === networkOf(p)) {
    return 'The pool includes the network address of its subnet, which cannot be assigned to a machine.';
  }
  if (st === broadcastOf(p) || e === broadcastOf(p)) {
    return 'The pool includes the broadcast address of its subnet, which cannot be assigned to a machine.';
  }

  return '';
}

/**
 * The gateway belongs to the subnet, not the pool. It is normal for it to sit
 * outside the pool range; what breaks a node is a gateway outside the SUBNET,
 * because then there is no on-link route to it and the default route cannot be
 * installed.
 */
export function gatewayError(gw: string, start: string, prefix: string): string {
  if (!gw.trim()) {
    return '';
  }
  const addr = parseIPv4(gw);

  if (addr === null) {
    return 'Must be an IPv4 address, for example 192.168.15.1';
  }
  const st = parseIPv4(start);
  const bits = parseBits(prefix);

  if (st === null || bits === null) {
    return '';
  }
  if (!contains({ addr: st, bits }, addr)) {
    return `Is outside the /${ bits } subnet the machines get. The gateway may sit outside the pool, but it must be inside the subnet or the node has no route to it. Set the subnet prefix to the real network, often 24.`;
  }

  return '';
}

function isValidV6(entry: string): boolean {
  if (!entry.includes(':') || !/^[0-9a-fA-F:]+$/.test(entry)) {
    return false;
  }

  const halves = entry.split('::');

  // More than one "::" is ambiguous, so at most one split is allowed.
  if (halves.length > 2) {
    return false;
  }

  const groupsOf = (s: string): string[] | null => {
    if (s === '') {
      return [];
    }
    const parts = s.split(':');

    return parts.every((p) => /^[0-9a-fA-F]{1,4}$/.test(p)) ? parts : null;
  };

  const head = groupsOf(halves[0]);

  if (head === null) {
    return false;
  }

  if (halves.length === 1) {
    // No "::", so every one of the eight groups must be written out.
    return head.length === 8;
  }

  const tail = groupsOf(halves[1]);

  if (tail === null) {
    return false;
  }

  // "::" stands for at least one omitted group, so the written ones must not
  // already account for all eight.
  return head.length + tail.length < 8;
}

export function nameserversError(ns: string): string {
  const entries = ns.split(/[,\s]+/).filter((e) => e !== '');

  for (const entry of entries) {
    // IPv6 resolvers are fine on a v4-addressed node.
    const isV6 = isValidV6(entry);

    if (!isV6 && parseIPv4(entry) === null) {
      return `${ entry } is not a valid IP address.`;
    }
  }

  return '';
}

/**
 * Mirrors the static-mode presence checks in Driver.validateAddressing, in the
 * same order, so the form reports the same first problem the driver would.
 * Format is not re-checked here — the per-field validators cover that.
 */
export function requiredFieldsError(
  mode: string,
  ipStart: string,
  ipEnd: string,
  ipPrefix: string,
  gateway: string,
  vmidRange: string,
  cloudInit: boolean,
): string {
  if (mode !== 'static') {
    return '';
  }
  // Same order as validateAddressing in the driver, so the form names the same
  // first missing field the driver would.
  if (!ipStart.trim()) {
    return 'A start address is required when addressing is static.';
  }
  if (!ipEnd.trim()) {
    return 'An end address is required when addressing is static.';
  }
  if (!ipPrefix.trim()) {
    return 'A subnet prefix is required when addressing is static.';
  }
  if (!gateway.trim()) {
    return 'A gateway is required when addressing is static.';
  }
  if (!cloudInit) {
    return 'Static addressing needs cloud-init: the address is delivered through cloud-init ipconfig0.';
  }
  if (!vmidRange.trim()) {
    return 'Static addressing requires a VMID range: each machine address is derived from its position in that range.';
  }

  return '';
}

/**
 * PVE applies nameservers and the search domain as cloud-init options, so with
 * cloud-init off they are dropped. The driver rejects that; nothing on the form
 * clears these fields when cloud-init is turned off, so say so.
 */
export function dnsCloudInitError(nameservers: string, searchdomain: string, cloudInit: boolean): string {
  if (cloudInit) {
    return '';
  }
  if (!nameservers.trim() && !searchdomain.trim()) {
    return '';
  }

  return 'Nameservers and search domain need cloud-init: PVE applies them as cloud-init options, so without it they would be silently dropped.';
}

/**
 * How many machines the pool can address. This caps the machine pool, not the
 * VMID range: VMIDs are handed out lowest-free-first, so machines fill the pool
 * from its start upward. Returns 0 when the pool is not yet valid.
 */
export function poolCapacity(start: string, end: string): number {
  const st = parseIPv4(start);
  const e = parseIPv4(end);

  if (st === null || e === null || e < st) {
    return 0;
  }

  return e - st + 1;
}
