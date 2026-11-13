'use strict';

const TOKENIZER = 'cl100k_base';

function compactToolsPayload(tools) {
  const tl = [];
  for (const t of tools || []) {
    if (!t || typeof t !== 'object') continue;
    tl.push({
      name: t.name,
      description: t.description,
      inputSchema: Object.prototype.hasOwnProperty.call(t, 'inputSchema') ? t.inputSchema : t.input_schema,
    });
  }
  return JSON.stringify(tl);
}

function tokenEstimate(tools, encode) {
  const js = compactToolsPayload(tools);
  const n = encode(js).length;
  return {
    raw_character_count: js.length,
    raw_utf8_bytes: Buffer.byteLength(js, 'utf8'),
    token_count: n,
    estimate: `approx. ${n} tokens, cl100k estimate`,
    tokenizer: TOKENIZER,
    tool_count: (tools || []).filter((t) => t && typeof t === 'object' && t.name).length,
  };
}

function getEncode() {
  const { getEncoding } = require('js-tiktoken');
  const enc = getEncoding(TOKENIZER);
  return (s) => enc.encode(s);
}

module.exports = { TOKENIZER, compactToolsPayload, tokenEstimate, getEncode };
