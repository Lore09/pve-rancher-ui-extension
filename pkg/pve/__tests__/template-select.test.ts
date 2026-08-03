import {
  discoveredTags, matchingTemplates, parseTagList, tagsMatch, templateTagError, templateTags,
} from '../template-select';

const templates = [
  { vmid: 9000, name: 'debian13-rancher', tags: 'rancher-node;debian13' },
  { vmid: 9001, name: 'leap-micro', tags: 'leap;rancher' },
  { vmid: 9002, name: 'untagged' },
];

describe('parseTagList', () => {
  it('lowercases, trims and dedupes', () => {
    expect(parseTagList(' Rancher , NODE ,rancher')).toEqual(['rancher', 'node']);
  });

  it('drops empty fields', () => {
    expect(parseTagList(',,rancher,,')).toEqual(['rancher']);
    expect(parseTagList('')).toEqual([]);
  });
});

describe('templateTags', () => {
  it('splits PVE semicolon-separated tags', () => {
    expect(templateTags({ tags: 'rancher-node;debian13' })).toEqual(['rancher-node', 'debian13']);
  });

  it('also accepts commas, which PVE takes on input', () => {
    expect(templateTags({ tags: 'a,b' })).toEqual(['a', 'b']);
  });

  it('treats an untagged template as having no tags', () => {
    expect(templateTags({})).toEqual([]);
  });
});

describe('tagsMatch', () => {
  it('subset ignores extra tags on the template', () => {
    expect(tagsMatch(['rancher', 'debian13'], ['rancher'], 'subset')).toBe(true);
  });

  it('subset requires every wanted tag', () => {
    expect(tagsMatch(['rancher'], ['rancher', 'gpu'], 'subset')).toBe(false);
  });

  it('exact rejects extra tags', () => {
    expect(tagsMatch(['rancher', 'debian13'], ['rancher'], 'exact')).toBe(false);
    expect(tagsMatch(['rancher', 'gpu'], ['gpu', 'rancher'], 'exact')).toBe(true);
  });

  it('never matches an empty selection', () => {
    expect(tagsMatch(['rancher'], [], 'subset')).toBe(false);
  });
});

describe('matchingTemplates', () => {
  it('finds the one template carrying the tag', () => {
    expect(matchingTemplates(templates, 'rancher-node', 'subset').map((t) => t.vmid)).toEqual([9000]);
  });

  it('returns every candidate when a tag is ambiguous', () => {
    expect(matchingTemplates([templates[0], { vmid: 9003, tags: 'rancher-node' }], 'rancher-node', 'subset')).toHaveLength(2);
  });
});

describe('discoveredTags', () => {
  it('collects distinct tags, sorted', () => {
    expect(discoveredTags(templates)).toEqual(['debian13', 'leap', 'rancher', 'rancher-node']);
  });
});

describe('templateTagError', () => {
  it('accepts a tag matching exactly one template', () => {
    expect(templateTagError('rancher-node', 'subset', templates)).toBe('');
  });

  it('requires a tag', () => {
    expect(templateTagError('', 'subset', templates)).toContain('at least one tag');
  });

  it('rejects an invalid tag before looking anything up', () => {
    expect(templateTagError('Not A Tag!', 'subset', templates)).toContain('not a valid PVE tag');
  });

  it('reports no match', () => {
    expect(templateTagError('nosuchtag', 'subset', templates)).toContain('No template');
  });

  it('reports ambiguity naming every candidate', () => {
    const err = templateTagError('rancher-node', 'subset', [templates[0], { vmid: 9003, name: 'dup', tags: 'rancher-node' }]);

    expect(err).toContain('9000');
    expect(err).toContain('9003');
  });

  it('only format-checks when the API is unreachable', () => {
    // The driver still resolves the tag for real at create time; refusing to
    // save a pool we cannot verify would make degraded mode unusable.
    expect(templateTagError('nosuchtag', 'subset', null)).toBe('');
    expect(templateTagError('Not A Tag!', 'subset', null)).toContain('not a valid PVE tag');
  });

  it('applies the exact policy', () => {
    expect(templateTagError('rancher-node', 'exact', templates)).toContain('No template');
    expect(templateTagError('rancher-node,debian13', 'exact', templates)).toBe('');
  });
});
