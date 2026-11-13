'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { listToolsStdio, parseArgv, extractMessages, encodeNdjson } = require('../src/client');

const FIXTURE = path.join(__dirname, 'helpers', 'tiny-server.js');

describe('parseArgv', () => {
  it('splits a simple command', () => {
    assert.deepEqual(parseArgv('node server.js --stdio'), ['node', 'server.js', '--stdio']);
  });
  it('keeps quoted arguments together', () => {
    assert.deepEqual(parseArgv(`npx -y "my pack"`), ['npx', '-y', 'my pack']);
  });
});

describe('extractMessages', () => {
  it('parses newline-delimited JSON-RPC', () => {
    const buf = Buffer.concat([
      encodeNdjson({ jsonrpc: '2.0', id: 1, result: { ok: true } }),
      encodeNdjson({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ]);
    const { messages } = extractMessages(buf);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].id, 1);
  });
  it('parses Content-Length frames', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    const frame = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, 'utf8');
    const { messages } = extractMessages(frame);
    assert.equal(messages[0].id, 1);
  });
});

describe('listToolsStdio', () => {
  it('lists tools from the fixture server', async () => {
    const live = await listToolsStdio({
      argv: [process.execPath, FIXTURE],
      timeoutMs: 5000,
    });
    assert.equal(live.ok, true, live.error);
    assert.ok(live.ms > 0);
    assert.deepEqual(live.tools.map((t) => t.name), ['echo', 'ping']);
    assert.equal(live.tools[0].inputSchema.properties.text.type, 'string');
  });

  it('records a startup failure when the process exits', async () => {
    const live = await listToolsStdio({
      argv: [process.execPath, '-e', 'process.exit(1)'],
      timeoutMs: 5000,
    });
    assert.equal(live.ok, false);
    assert.match(live.error, /exited/i);
  });

  it('times out when the server never replies', async () => {
    const live = await listToolsStdio({
      argv: [process.execPath, '-e', 'setInterval(() => {}, 10000)'],
      timeoutMs: 400,
    });
    assert.equal(live.ok, false);
    assert.match(live.error, /Timed out after 400ms/);
    assert.ok(live.ms >= 400);
  });
});
