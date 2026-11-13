'use strict';

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PROTOCOL = '2025-06-18';
const CLIENT_INFO = { name: 'drift-check-by-testedmcp', version: '0.1.0' };

function parseArgv(command) {
  const s = String(command || '').trim();
  if (!s) return [];
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; }
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function isUrl(command) {
  return /^https?:\/\//i.test(String(command || '').trim());
}

function encodeNdjson(obj) {
  return Buffer.from(JSON.stringify(obj) + '\n', 'utf8');
}

/** Split a stdout buffer into JSON-RPC messages (newline-delimited or Content-Length frames). */
function extractMessages(buf) {
  const messages = [];
  let rest = Buffer.from(buf);
  while (rest.length) {
    const head = rest.toString('utf8', 0, Math.min(rest.length, 80));
    const cl = /^Content-Length:\s*(\d+)\r?\n/i.exec(head);
    if (cl) {
      const headerEnd = rest.indexOf('\r\n\r\n') >= 0 ? rest.indexOf('\r\n\r\n') + 4
        : (rest.indexOf('\n\n') >= 0 ? rest.indexOf('\n\n') + 2 : -1);
      if (headerEnd < 0) break;
      const len = parseInt(cl[1], 10);
      if (rest.length < headerEnd + len) break;
      const body = rest.subarray(headerEnd, headerEnd + len).toString('utf8');
      try { messages.push(JSON.parse(body)); } catch { /* ignore incomplete or log noise */ }
      rest = rest.subarray(headerEnd + len);
      continue;
    }
    const nl = rest.indexOf(0x0a);
    if (nl < 0) break;
    const line = rest.subarray(0, nl).toString('utf8').replace(/\r$/, '').trim();
    rest = rest.subarray(nl + 1);
    if (!line || line[0] !== '{') continue;
    try { messages.push(JSON.parse(line)); } catch { /* skip non-JSON */ }
  }
  return { messages, rest };
}

function request(method, params, id) {
  const msg = { jsonrpc: '2.0' };
  if (id != null) msg.id = id;
  msg.method = method;
  if (params !== undefined) msg.params = params;
  return msg;
}

function listToolsStdio({ argv, timeoutMs = 45000, spawnFn = spawn, env = process.env } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const result = { ok: false, ms: 0, tools: [], error: '', serverInfo: null, protocol: null };
    if (!argv || !argv.length) {
      result.error = 'No start command was given.';
      return resolve(result);
    }
    let proc;
    try {
      proc = spawnFn(argv[0], argv.slice(1), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: env.PATH, HOME: env.HOME, LANG: env.LANG, TERM: env.TERM || 'dumb' },
      });
    } catch (err) {
      result.error = err.message || String(err);
      result.ms = Date.now() - started;
      return resolve(result);
    }

    let stdout = Buffer.alloc(0);
    let settled = false;
    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      result.ms = Date.now() - started;
      Object.assign(result, extra || {});
      try { proc.stdin.end(); } catch { /* already closed */ }
      try { proc.kill('SIGKILL'); } catch { /* already exited */ }
      resolve(result);
    };

    const timer = setTimeout(() => finish({ error: `Timed out after ${timeoutMs}ms` }), timeoutMs);

    proc.on('error', (err) => finish({ error: err.message || String(err) }));
    if (proc.stdin) proc.stdin.on('error', () => { /* ignore EPIPE after we close the process */ });
    proc.stderr.on('data', () => { /* keep the pipe draining; do not treat stderr as a result */ });
    proc.stderr.on('error', () => {});
    proc.stdout.on('error', () => {});
    proc.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      const { messages } = extractMessages(stdout);
      for (const m of messages) {
        if (m.id === 1) {
          if (m.error) return finish({ error: m.error.message || JSON.stringify(m.error) });
          result.serverInfo = (m.result && m.result.serverInfo) || null;
          result.protocol = (m.result && m.result.protocolVersion) || null;
          try {
            proc.stdin.write(encodeNdjson(request('notifications/initialized')));
            proc.stdin.write(encodeNdjson(request('tools/list', {}, 2)));
          } catch (err) {
            return finish({ error: err.message || String(err) });
          }
        }
        if (m.id === 2) {
          if (m.error) return finish({ error: m.error.message || JSON.stringify(m.error) });
          const tools = (m.result && m.result.tools) || [];
          return finish({ ok: true, tools: Array.isArray(tools) ? tools : [] });
        }
      }
    });
    proc.on('exit', (code, signal) => {
      if (settled) return;
      finish({ error: signal ? `Process ended (${signal})` : `Process exited with code ${code}` });
    });

    try {
      proc.stdin.write(encodeNdjson(request('initialize', {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      }, 1)));
    } catch (err) {
      finish({ error: err.message || String(err) });
    }
  });
}

function httpRequest(url, body, timeoutMs, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL,
        'content-length': payload.length,
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, text });
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function parseRpcBody(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (trimmed[0] === '{') return JSON.parse(trimmed);
  // text/event-stream: last data: JSON line
  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^data:\s*(\{.*\})\s*$/.exec(lines[i]);
    if (m) return JSON.parse(m[1]);
  }
  throw new Error('Response was not JSON-RPC');
}

async function listToolsHttp({ url, timeoutMs = 45000, requestFn = httpRequest } = {}) {
  const started = Date.now();
  const result = { ok: false, ms: 0, tools: [], error: '', serverInfo: null, protocol: null };
  const done = (extra) => {
    result.ms = Date.now() - started;
    Object.assign(result, extra || {});
    return result;
  };
  try {
    const init = await requestFn(url, request('initialize', {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    }, 1), timeoutMs, {});
    if (init.status === 401 || init.status === 403) {
      return done({ error: `Remote endpoint returned HTTP ${init.status}` });
    }
    if (init.status >= 400) {
      return done({ error: `Remote endpoint returned HTTP ${init.status}` });
    }
    const initMsg = parseRpcBody(init.text);
    if (!initMsg || initMsg.error) {
      return done({ error: (initMsg && initMsg.error && initMsg.error.message) || 'Initialize failed' });
    }
    result.serverInfo = (initMsg.result && initMsg.result.serverInfo) || null;
    result.protocol = (initMsg.result && initMsg.result.protocolVersion) || null;
    const session = init.headers && (init.headers['mcp-session-id'] || init.headers['Mcp-Session-Id']);
    const hdrs = session ? { 'mcp-session-id': session } : {};
    try { await requestFn(url, request('notifications/initialized'), timeoutMs, hdrs); } catch { /* optional */ }
    const listed = await requestFn(url, request('tools/list', {}, 2), timeoutMs, hdrs);
    if (listed.status >= 400) {
      return done({ error: `tools/list returned HTTP ${listed.status}` });
    }
    const listMsg = parseRpcBody(listed.text);
    if (!listMsg || listMsg.error) {
      return done({ error: (listMsg && listMsg.error && listMsg.error.message) || 'tools/list failed' });
    }
    const tools = (listMsg.result && listMsg.result.tools) || [];
    return done({ ok: true, tools: Array.isArray(tools) ? tools : [] });
  } catch (err) {
    return done({ error: err.message || String(err) });
  }
}

async function listTools({ command, timeoutMs = 45000, spawnFn, requestFn } = {}) {
  if (isUrl(command)) {
    return listToolsHttp({ url: String(command).trim(), timeoutMs, requestFn });
  }
  return listToolsStdio({ argv: parseArgv(command), timeoutMs, spawnFn });
}

module.exports = {
  PROTOCOL, CLIENT_INFO, parseArgv, isUrl, encodeNdjson, extractMessages,
  request, listToolsStdio, listToolsHttp, listTools, httpRequest, parseRpcBody,
};
