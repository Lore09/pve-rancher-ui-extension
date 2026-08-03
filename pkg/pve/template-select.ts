/**
 * Tag-based template selection for the `pve-template-tag` machine-config field.
 *
 * The driver resolves the tag against the live cluster at create time and
 * refuses to provision unless exactly one template matches. That check is
 * mirrored here so the operator sees the problem while editing the pool, not
 * as a machine that fails to provision an hour later — pkg/proxmox/client.go
 * (FindTemplateByTags) in the driver repo is authoritative, and any change to
 * the matching rules must be made in both places.
 */

export type TemplateMatch = 'subset' | 'exact';

export const TEMPLATE_MATCHES: TemplateMatch[] = ['subset', 'exact'];

/** How the template is named: by its VMID, or by a tag it carries. */
export type TemplateSource = 'vmid' | 'tag';

/** Mirrors pveTagPattern in pkg/driver/tags.go. */
const TAG_PATTERN = /^[a-z0-9_][a-z0-9_+.-]*$/;

/**
 * Splits a comma-separated tag list into lowercase, deduped tags, exactly as
 * normalizeTagList does in the driver.
 */
export function parseTagList(raw: string): string[] {
  const out: string[] = [];

  (raw || '').split(',').forEach((field) => {
    const tag = field.trim().toLowerCase();

    if (tag !== '' && !out.includes(tag)) {
      out.push(tag);
    }
  });

  return out;
}

/**
 * Tags carried by one template, from the PVE `tags` field. PVE stores them
 * semicolon-separated but accepts commas, so both are split.
 */
export function templateTags(tmpl: any): string[] {
  return String(tmpl?.tags || '')
    .split(/[;,]/)
    .map((t: string) => t.trim().toLowerCase())
    .filter((t: string) => t !== '');
}

/** Mirrors tagsMatch in pkg/proxmox/client.go. */
export function tagsMatch(have: string[], want: string[], match: TemplateMatch): boolean {
  if (want.length === 0) {
    return false;
  }

  if (!want.every((w) => have.includes(w))) {
    return false;
  }

  if (match === 'exact') {
    return new Set(have).size === want.length;
  }

  return true;
}

/** Every discovered template whose tags satisfy the given selection. */
export function matchingTemplates(templates: any[], raw: string, match: TemplateMatch): any[] {
  const want = parseTagList(raw);

  return (templates || []).filter((tmpl) => tagsMatch(templateTags(tmpl), want, match));
}

/** Every distinct tag seen across the discovered templates, for the dropdown. */
export function discoveredTags(templates: any[]): string[] {
  const seen: string[] = [];

  (templates || []).forEach((tmpl) => {
    templateTags(tmpl).forEach((tag) => {
      if (!seen.includes(tag)) {
        seen.push(tag);
      }
    });
  });

  return seen.sort();
}

/**
 * The blocking problem with the current tag selection, or '' when it is usable.
 *
 * `templates` is the discovered template list; pass null when the PVE API could
 * not be reached, which downgrades this to a format check — the driver will
 * still do the real resolution, and refusing to save a pool we simply cannot
 * verify would leave no way to configure one in degraded mode.
 */
export function templateTagError(raw: string, match: TemplateMatch, templates: any[] | null): string {
  const tags = parseTagList(raw);

  if (tags.length === 0) {
    return 'Enter at least one tag, or select the template by VMID instead.';
  }

  const bad = tags.find((tag) => !TAG_PATTERN.test(tag));

  if (bad) {
    return `"${ bad }" is not a valid PVE tag: use lowercase letters, digits, and _ + . -, starting with a letter, digit or underscore.`;
  }

  if (templates === null) {
    return '';
  }

  const found = matchingTemplates(templates, raw, match);

  if (found.length === 1) {
    return '';
  }

  if (found.length === 0) {
    return `No template on this node carries ${ tags.length > 1 ? 'all of these tags' : 'this tag' }. Tag the template in Proxmox VE, or select it by VMID.`;
  }

  // Ambiguity is fatal to the driver rather than resolved by picking one:
  // two templates sharing a tag is a half-finished image rollout, and
  // choosing either would build half the machine pool from each image.
  const names = found.map((t) => `${ t.vmid } (${ t.name || 'unnamed' })`).join(', ');

  return `${ found.length } templates match: ${ names }. Exactly one must carry the tag — remove it from the others, or select by VMID.`;
}
