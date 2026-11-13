'use strict';

function formatList(changes, empty) {
  if (!changes.length) return empty;
  return changes.map((c) => {
    if (c.kind === 'tool_removed') return `- Tool removed: \`${c.tool}\``;
    if (c.kind === 'tool_added') return `- Tool added: \`${c.tool}\``;
    if (c.kind === 'required_field_added') return `- Required field added on \`${c.tool}\`: \`${c.field}\``;
    if (c.kind === 'type_changed') return `- Type changed on \`${c.tool}\` field \`${c.field}\`: ${c.from} → ${c.to}`;
    if (c.kind === 'optional_field_added') return `- Optional field added on \`${c.tool}\`: \`${c.field}\``;
    if (c.kind === 'description_changed') return `- Description changed on \`${c.tool}\``;
    if (c.kind === 'startup_failed') return `- Startup failed: ${c.detail}`;
    return `- ${c.kind}${c.tool ? ' (' + c.tool + ')' : ''}`;
  }).join('\n');
}

function renderMarkdown({ slug, baselineUrl, result, live, failOn, tokenEstimate }) {
  const title = result.same
    ? `Drift Check: ${slug} matches the baseline`
    : `Drift Check: ${slug} differs from the baseline`;
  const started = live && live.ok
    ? `Yes (${live.ms} ms, ${Array.isArray(live.tools) ? live.tools.length : 0} tools)`
    : `No${live && live.error ? ' — ' + live.error : ''}`;
  const tes = tokenEstimate
    ? `${tokenEstimate.token_count} tokens (${tokenEstimate.tokenizer} estimate)`
    : 'not counted';
  return [
    `## ${title}`,
    '',
    `Listing: \`${slug}\``,
    baselineUrl ? `Baseline: ${baselineUrl}` : '',
    `Started: ${started}`,
    `Token estimate: ${tes}`,
    `Fail on: ${failOn}`,
    '',
    `### Breaking (${result.breaking.length})`,
    formatList(result.breaking, '- None'),
    '',
    `### Non-breaking (${result.nonBreaking.length})`,
    formatList(result.nonBreaking, '- None'),
    '',
    'This check lists tools only. It does not call them.',
    '',
    'Compared by [Drift Check by testedmcp](https://testedmcp.com/).',
  ].filter((line, i, arr) => line !== '' || arr[i - 1] !== '').join('\n');
}

const COMMENT_MARKER = '<!-- drift-check-by-testedmcp -->';

function withMarker(body) {
  return `${COMMENT_MARKER}\n${body}\n`;
}

module.exports = { formatList, renderMarkdown, COMMENT_MARKER, withMarker };
