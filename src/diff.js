'use strict';

const { descriptionHash } = require('./hash');

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function isObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/** Walk a JSON Schema and collect required property paths and type-at-path. */
function walkSchema(schema, path, required, types) {
  if (!isObject(schema)) return;
  if (Object.prototype.hasOwnProperty.call(schema, 'type')) {
    const typ = schema.type;
    types.set(path || '$', Array.isArray(typ) ? typ.slice().sort().join('|') : String(typ));
  }
  const props = schema.properties;
  if (isObject(props)) {
    for (const name of Object.keys(props)) {
      walkSchema(props[name], path ? `${path}.${name}` : name, required, types);
    }
  }
  if (isObject(schema.items)) {
    walkSchema(schema.items, path ? `${path}[]` : '[]', required, types);
  }
  if (isObject(schema.additionalProperties)) {
    walkSchema(schema.additionalProperties, path ? `${path}.*` : '*', required, types);
  }
  for (const req of asArray(schema.required)) {
    required.add(path ? `${path}.${req}` : String(req));
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[key])) {
      schema[key].forEach((sub, i) => walkSchema(sub, `${path || '$'}(${key}:${i})`, required, types));
    }
  }
}

function schemaIndex(inputSchema) {
  const required = new Set();
  const types = new Map();
  walkSchema(inputSchema || {}, '', required, types);
  return { required, types };
}

function toolMap(tools) {
  const map = new Map();
  for (const t of tools || []) {
    if (!t || typeof t !== 'object' || !t.name) continue;
    map.set(t.name, t);
  }
  return map;
}

function currentDescriptionHash(tool) {
  if (tool && tool.description_hash) return tool.description_hash;
  return descriptionHash(tool && tool.description);
}

/**
 * Diff a live tools/list result against a baseline.
 * startupFailed: the server did not complete initialize + tools/list.
 */
function classify({ baseline, current, startupFailed = false, startupError = '' } = {}) {
  const breaking = [];
  const nonBreaking = [];

  if (startupFailed) {
    breaking.push({
      kind: 'startup_failed',
      detail: startupError || 'The server did not complete initialize and tools/list.',
    });
    return { breaking, nonBreaking, same: false };
  }

  const before = toolMap((baseline && baseline.tools) || []);
  const after = toolMap((current && current.tools) || []);

  for (const [name, oldTool] of before) {
    if (!after.has(name)) {
      breaking.push({ kind: 'tool_removed', tool: name });
    }
  }
  for (const [name, newTool] of after) {
    if (!before.has(name)) {
      nonBreaking.push({ kind: 'tool_added', tool: name });
    }
  }

  for (const [name, oldTool] of before) {
    const newTool = after.get(name);
    if (!newTool) continue;
    const oldIdx = schemaIndex(oldTool.inputSchema);
    const newIdx = schemaIndex(newTool.inputSchema);

    for (const req of newIdx.required) {
      if (!oldIdx.required.has(req)) {
        breaking.push({ kind: 'required_field_added', tool: name, field: req });
      }
    }
for (const [p, typ] of newIdx.types) {
      if (oldIdx.types.has(p) && oldIdx.types.get(p) !== typ) {
        breaking.push({
          kind: 'type_changed',
          tool: name,
          field: p,
          from: oldIdx.types.get(p),
          to: typ,
        });
      }
    }
    for (const p of newIdx.types.keys()) {
      if (!oldIdx.types.has(p) && !newIdx.required.has(p) && p !== '$') {
        nonBreaking.push({ kind: 'optional_field_added', tool: name, field: p });
      }
    }

    const oldHash = currentDescriptionHash(oldTool);
    const newHash = currentDescriptionHash(newTool);
    if (oldHash !== newHash) {
      nonBreaking.push({ kind: 'description_changed', tool: name });
    }
  }

  return {
    breaking,
    nonBreaking,
    same: breaking.length === 0 && nonBreaking.length === 0,
  };
}

function shouldFail(failOn, result) {
  const mode = String(failOn || 'breaking').toLowerCase();
  if (mode === 'none') return false;
  if (mode === 'any') return result.breaking.length > 0 || result.nonBreaking.length > 0;
  return result.breaking.length > 0;
}

module.exports = { classify, shouldFail, schemaIndex, toolMap };
