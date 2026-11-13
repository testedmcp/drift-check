# Drift Check by testedmcp

A GitHub Action from the testedmcp team. Maintainers add it to an MCP server repository so each push, pull request or release is compared to the last tested result published on [testedmcp.com](https://testedmcp.com/).

It starts the server, sends `initialize` and `tools/list` over stdio (newline-delimited JSON-RPC), and records whether the server started, how long that took, the tool names and input schemas, and a token estimate using the same method as the site (tiktoken `cl100k_base` over compact JSON of name, description and inputSchema). For a remote server, pass the endpoint URL instead of a start command.

It does not call tools unless you later add that yourself. This version only lists tools.

## Differences it reports

**Breaking**

- a tool was removed
- a required field was added
- a field type changed
- the server failed to start or did not complete `initialize` and `tools/list`

**Non-breaking**

- a tool was added
- an optional field was added
- a description changed

The job writes a GitHub Actions job summary. On a pull request, you can have it post one comment and update that comment in place.

## Add it to your workflow

Put this file in your own repository (for example `.github/workflows/drift-check.yml`). The Action repository itself has no workflow files, which is a GitHub Marketplace requirement.

```yaml
name: Drift Check
on:
  push:
  pull_request:
  release:
    types: [published]

permissions:
  contents: read
  pull-requests: write

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: testedmcp/drift-check@v1
        with:
          slug: your-listing-slug
          command: npx -y your-package
          fail-on: breaking
          comment: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Use the listing slug from the testedmcp page URL (`https://testedmcp.com/tools/<slug>/`). The default baseline is `https://testedmcp.com/api/baseline/<slug>.json`.

For a remote server, set `command` to the endpoint URL (for example `https://example.com/mcp`).

An example workflow also lives in the companion repository `testedmcp/drift-check-ci`.

## Inputs

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `slug` | yes | | The testedmcp listing slug |
| `command` | yes | | Stdio start command, or a URL for a remote server |
| `fail-on` | no | `breaking` | `breaking`, `any`, or `none` |
| `comment` | no | `false` | Post or update one pull request comment |
| `baseline-url` | no | `https://testedmcp.com/api/baseline/<slug>.json` | Baseline JSON URL or a local path |
| `timeout` | no | `45000` | Milliseconds to wait for `initialize` and `tools/list` |

`fail-on: breaking` fails the job only on breaking differences. `any` also fails on non-breaking differences. `none` still reports the result but does not fail the job for those differences.

## Permissions

The comment step uses the repository's `GITHUB_TOKEN` with `contents: read` and `pull-requests: write`. No testedmcp credentials are required, and none should be added to your repository.

## Build and test (this repository)

Install with `npm ci --ignore-scripts`. Bundle the Action with `npm run build` (ncc writes a single `dist/index.js`). Run unit tests with `npm test` (`node --test`).

## Licence

MIT. Copyright the testedmcp team.

Questions: [support@testedmcp.com](mailto:support@testedmcp.com).
