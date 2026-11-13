'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const core = require('@actions/core');
const github = require('@actions/github');
const { listTools } = require('./client');
const { classify, shouldFail } = require('./diff');
const { tokenEstimate, getEncode } = require('./tokens');
const { renderMarkdown, COMMENT_MARKER, withMarker } = require('./summary');

function truthy(v) {
  return /^(true|1|yes)$/i.test(String(v || '').trim());
}

function defaultBaselineUrl(slug) {
  return `https://testedmcp.com/api/baseline/${encodeURIComponent(slug)}.json`;
}

function fetchUrl(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(url, { headers: { accept: 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) reject(new Error(`Baseline HTTP ${res.statusCode} from ${u.host}`));
        else resolve(text);
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Baseline fetch timed out after ${timeoutMs}ms`)); });
    req.on('error', reject);
  });
}

async function loadBaseline(spec, timeoutMs) {
  const s = String(spec || '').trim();
  if (!s) throw new Error('No baseline URL was given.');
  if (/^https?:\/\//i.test(s)) {
    return JSON.parse(await fetchUrl(s, timeoutMs));
  }
  const file = s.startsWith('file:') ? new URL(s).pathname : s;
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

async function upsertComment(octokit, body) {
  const { repo, payload } = github.context;
  const pr = payload.pull_request;
  if (!pr) return;
  const { data: comments } = await octokit.rest.issues.listComments({
    owner: repo.owner,
    repo: repo.repo,
    issue_number: pr.number,
    per_page: 100,
  });
  const existing = comments.find((c) => (c.body || '').includes(COMMENT_MARKER));
  const marked = withMarker(body);
  if (existing) {
    await octokit.rest.issues.updateComment({
      owner: repo.owner,
      repo: repo.repo,
      comment_id: existing.id,
      body: marked,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: pr.number,
      body: marked,
    });
  }
}

async function run() {
  const slug = core.getInput('slug', { required: true }).trim();
  const command = core.getInput('command', { required: true }).trim();
  const failOn = (core.getInput('fail-on') || 'breaking').trim().toLowerCase() || 'breaking';
  const comment = truthy(core.getInput('comment'));
  const timeoutMs = Number(core.getInput('timeout') || 45000);
  const baselineUrl = (core.getInput('baseline-url') || '').trim() || defaultBaselineUrl(slug);

  if (!['breaking', 'any', 'none'].includes(failOn)) {
    throw new Error(`fail-on must be breaking, any, or none (got ${failOn})`);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeout must be a positive number of milliseconds');
  }

  const baseline = await loadBaseline(baselineUrl, timeoutMs);
  const live = await listTools({ command, timeoutMs });
  const result = classify({
    baseline,
    current: live,
    startupFailed: !live.ok,
    startupError: live.error,
  });
  let tes = null;
  if (live.ok) {
    tes = tokenEstimate(live.tools, getEncode());
  }

  const md = renderMarkdown({ slug, baselineUrl, result, live, failOn, tokenEstimate: tes });
  await core.summary.addRaw(md, true).write();

  core.setOutput('started', live.ok ? 'true' : 'false');
  core.setOutput('breaking', String(result.breaking.length));
  core.setOutput('non-breaking', String(result.nonBreaking.length));

  if (comment && github.context.payload.pull_request) {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) throw new Error('comment is set, but no GITHUB_TOKEN is available');
    const octokit = github.getOctokit(token);
    await upsertComment(octokit, md);
  }

  if (shouldFail(failOn, result)) {
    const n = result.breaking.length + (failOn === 'any' ? result.nonBreaking.length : 0);
    core.setFailed(`Drift Check found ${n} difference${n === 1 ? '' : 's'} (fail-on: ${failOn}).`);
  }
}

if (require.main === module) {
  run().catch((err) => core.setFailed(err.message || String(err)));
}

module.exports = { run, loadBaseline, defaultBaselineUrl, truthy };
