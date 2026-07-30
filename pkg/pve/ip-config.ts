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

export function ipBaseError(base: string): string {
  if (!base.trim()) {
    return '';
  }
  if (base.includes(':')) {
    return 'Must be IPv4. IPv6 addressing is not supported.';
  }
  const p = parsePrefix(base);

  if (!p) {
    return 'Must be an IPv4 address with a prefix, for example 10.10.20.10/24';
  }
  if (p.bits > MIN_PREFIX_BITS) {
    return 'Has no usable host addresses. Use /30 or larger.';
  }

  return '';
}

export function gatewayError(gw: string, base: string): string {
  if (!gw.trim()) {
    return '';
  }
  const addr = parseIPv4(gw);

  if (addr === null) {
    return 'Must be an IPv4 address, for example 10.10.20.1';
  }
  // Say nothing until the base is valid, or the user sees a spurious error
  // while still typing it.
  if (ipBaseError(base) !== '' || !base.trim()) {
    return '';
  }
  const p = parsePrefix(base);

  if (p && !contains(p, addr)) {
    return 'Is outside the subnet of the base address.';
  }

  return '';
}

/**
 * True for addresses Go's netip.ParseAddr would accept as IPv6. A bare
 * `[0-9a-fA-F:]+` test is not enough: it lets through `2001:db8:::1` and
 * `::::`, which pass the form and then fail in the driver.
 *
 * Zone ids and embedded IPv4 (`::ffff:10.0.0.1`) are out of scope here — the
 * field is a resolver list, and the driver has the final word either way.
 */
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
 * Format is not re-checked here — ipBaseError and gatewayError cover that.
 */
export function requiredFieldsError(
  mode: string,
  ipBase: string,
  gateway: string,
  vmidRange: string,
  cloudInit: boolean,
): string {
  if (mode !== 'static') {
    return '';
  }
  if (!ipBase.trim()) {
    return 'A base address is required when addressing is static.';
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

export function spanError(base: string, vmidRange: string): string {
  if (!base.trim() || !vmidRange.trim()) {
    return '';
  }
  if (ipBaseError(base) !== '') {
    return '';
  }
  const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(vmidRange);

  if (!match) {
    return '';
  }
  const lo = Number(match[1]);
  const hi = Number(match[2]);

  if (hi < lo) {
    return '';
  }
  const p = parsePrefix(base);

  if (!p) {
    return '';
  }
  // A VMID range wider than the subnet is NOT an error. VMIDs are handed out
  // lowest-free-first, so machines cluster at the bottom of the range and the
  // subnet only has to hold the machines that exist at once. Requiring full
  // coverage demanded a /25 to run three nodes with a 100-wide range.
  //
  // Only the base itself is checked here; per-machine capacity is enforced by
  // the driver, which reports it as pool exhaustion with a machine count.
  if (p.addr === networkOf(p)) {
    return 'Is the network address of its subnet and cannot be assigned to a machine. Use the next address.';
  }
  if (p.addr === broadcastOf(p)) {
    return 'Is the broadcast address of its subnet and cannot be assigned to a machine.';
  }

  return '';
}

/**
 * How many machines the subnet can address starting at the base. This is what
 * caps the pool, so the form surfaces it as information rather than an error.
 * Returns 0 when the base cannot be parsed.
 */
export function poolCapacity(base: string): number {
  if (!base.trim() || ipBaseError(base) !== '') {
    return 0;
  }
  const p = parsePrefix(base);

  if (!p) {
    return 0;
  }

  return Math.max(0, broadcastOf(p) - p.addr);
}
