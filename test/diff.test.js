'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classify, shouldFail } = require('../src/diff');
const { descriptionHash } = require('../src/hash');

function tool(name, extra = {}) {
  return {
    name,
    description: extra.description || `The ${name} tool`,
    inputSchema: extra.inputSchema || {
      type: 'object',
      properties: { q: { type: 'string' } },
      required: extra.required || [],
    },
    ...('description_hash' in extra ? { description_hash: extra.description_hash } : {}),
  };
}

function baseline(tools) {
  return {
    slug: 'fixture',
    schema_version: 1,
    tools: tools.map((t) => ({
      name: t.name,
      inputSchema: t.inputSchema,
      description_hash: descriptionHash(t.description),
    })),
  };
}

describe('classify', () => {
  it('same baseline has no differences', () => {
    const tools = [tool('search', { required: ['q'] })];
    const result = classify({ baseline: baseline(tools), current: { tools } });
    assert.equal(result.same, true);
    assert.equal(result.breaking.length, 0);
    assert.equal(result.nonBreaking.length, 0);
  });

  it('tool added is non-breaking', () => {
    const oldTools = [tool('search')];
    const newTools = [tool('search'), tool('lookup')];
    const result = classify({ baseline: baseline(oldTools), current: { tools: newTools } });
    assert.equal(result.same, false);
    assert.deepEqual(result.breaking, []);
    assert.equal(result.nonBreaking.length, 1);
    assert.equal(result.nonBreaking[0].kind, 'tool_added');
    assert.equal(result.nonBreaking[0].tool, 'lookup');
  });

  it('tool removed is breaking', () => {
    const oldTools = [tool('search'), tool('lookup')];
    const newTools = [tool('search')];
    const result = classify({ baseline: baseline(oldTools), current: { tools: newTools } });
    assert.equal(result.breaking.length, 1);
    assert.equal(result.breaking[0].kind, 'tool_removed');
    assert.equal(result.breaking[0].tool, 'lookup');
    assert.equal(result.nonBreaking.length, 0);
  });

  it('required field added is breaking', () => {
    const oldTools = [tool('search', {
      inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: [] },
    })];
    const newTools = [tool('search', {
      inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    })];
    const result = classify({ baseline: baseline(oldTools), current: { tools: newTools } });
    assert.equal(result.breaking.length, 1);
    assert.equal(result.breaking[0].kind, 'required_field_added');
    assert.equal(result.breaking[0].field, 'q');
  });

  it('type change is breaking', () => {
    const oldTools = [tool('search', {
      inputSchema: { type: 'object', properties: { limit: { type: 'string' } } },
    })];
    const newTools = [tool('search', {
      inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    })];
    const result = classify({ baseline: baseline(oldTools), current: { tools: newTools } });
    assert.ok(result.breaking.some((c) => c.kind === 'type_changed' && c.field === 'limit' && c.from === 'string' && c.to === 'number'));
  });

  it('startup failure is breaking', () => {
    const tools = [tool('search')];
    const result = classify({
      baseline: baseline(tools),
      current: { tools: [] },
      startupFailed: true,
      startupError: 'Process exited with code 1',
    });
    assert.equal(result.breaking.length, 1);
    assert.equal(result.breaking[0].kind, 'startup_failed');
    assert.match(result.breaking[0].detail, /exited/);
    assert.equal(result.nonBreaking.length, 0);
  });

  it('optional field added is non-breaking', () => {
    const oldTools = [tool('search', {
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    })];
    const newTools = [tool('search', {
      inputSchema: { type: 'object', properties: { q: { type: 'string' }, lang: { type: 'string' } } },
    })];
    const result = classify({ baseline: baseline(oldTools), current: { tools: newTools } });
    assert.equal(result.breaking.length, 0);
    assert.ok(result.nonBreaking.some((c) => c.kind === 'optional_field_added' && c.field === 'lang'));
  });

  it('description change is non-breaking', () => {
    const oldTools = [tool('search', { description: 'Find records' })];
    const newTools = [tool('search', { description: 'Find records, with filters' })];
    const result = classify({ baseline: baseline(oldTools), current: { tools: newTools } });
    assert.equal(result.breaking.length, 0);
    assert.equal(result.nonBreaking[0].kind, 'description_changed');
  });
});

describe('shouldFail', () => {
  const breaking = { breaking: [{ kind: 'tool_removed' }], nonBreaking: [], same: false };
  const nonBreaking = { breaking: [], nonBreaking: [{ kind: 'tool_added' }], same: false };
  const same = { breaking: [], nonBreaking: [], same: true };

  it('breaking fails only on breaking differences', () => {
    assert.equal(shouldFail('breaking', breaking), true);
    assert.equal(shouldFail('breaking', nonBreaking), false);
    assert.equal(shouldFail('breaking', same), false);
  });

  it('any fails on breaking or non-breaking', () => {
    assert.equal(shouldFail('any', breaking), true);
    assert.equal(shouldFail('any', nonBreaking), true);
    assert.equal(shouldFail('any', same), false);
  });

  it('none never fails on classified differences', () => {
    assert.equal(shouldFail('none', breaking), false);
    assert.equal(shouldFail('none', nonBreaking), false);
    assert.equal(shouldFail('none', same), false);
  });
});
