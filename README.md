# Drift Check by testedmcp

A GitHub Action from the testedmcp team. Maintainers add it to an MCP server repository so each push, pull request or release compares the server's current `tools/list` result with a baseline: a JSON file that records the tool list from an earlier test.

For a local (stdio) server, the Action starts the server, sends `initialize` and `tools/list` (newline-delimited JSON-RPC; replies framed with `Content-Length` headers are also read), and records whether the server started, how long that took, the tool names and input schemas, and a token estimate (tiktoken `cl100k_base` over compact JSON of each tool's name, description and inputSchema, the tokenizer [testedmcp.com](https://testedmcp.com/) uses for its published estimates). For a remote server, pass the endpoint URL instead of a start command; the Action sends the same two requests as HTTP POSTs and reads JSON or `text/event-stream` replies.

It lists tools only. It does not call them.

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

The job writes a GitHub Actions job summary. On a pull request, it can also post one comment and update that comment in place on later runs.

## Baselines

Set `baseline-url` to a baseline JSON file in your repository (a path, resolved from the job's working directory) or to an `https://` URL.

The Action's built-in default points at a per-listing baseline address on testedmcp.com. Those baseline files are not published yet, so a run without `baseline-url` currently fails when it fetches the baseline. Until they are published, set `baseline-url`.

A baseline is a JSON object with a `tools` array in the `tools/list` shape:

```json
{
  "tools": [
    {
      "name": "echo",
      "description": "Returns the text it was given.",
      "inputSchema": {
        "type": "object",
        "properties": { "text": { "type": "string" } },
        "required": ["text"]
      }
    }
  ]
}
```

Other top-level fields are ignored. A tool may carry `description_hash` (the SHA-256 hex digest of its description) instead of the description text. A working baseline and fixture server are in the companion repository [testedmcp/drift-check-ci](https://github.com/testedmcp/drift-check-ci).

## Add it to your workflow

Put this file in your own repository (for example `.github/workflows/drift-check.yml`). This Action repository has no workflow files of its own, which is a GitHub Marketplace requirement.

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
      - uses: testedmcp/drift-check@main
        with:
          slug: your-listing-slug
          command: npx -y your-package
          baseline-url: .github/drift-check/baseline.json
          fail-on: breaking
          comment: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Use the listing slug from the testedmcp page URL (`https://testedmcp.com/tools/<slug>/`). The slug names the listing in the summary and builds the default baseline address.

`command` is split into arguments the way a shell would split quoted words, then run directly, without a shell, so pipes, `&&` and `$VARIABLES` are not expanded. The server process gets only `PATH`, `HOME`, `LANG` and `TERM` from the job environment, so a server that needs an API key in its environment will not receive it.

For a remote server, set `command` to the endpoint URL (for example `https://example.com/mcp`). No authorization header is sent; an HTTP 401 or 403 reply is reported as a startup failure.

## Versioning

No release tag has been published yet, so use `testedmcp/drift-check@main`, or pin a full commit SHA from this repository for a fixed version. The bundled `dist/index.js` on `main` is built from `src/` and runs on the `node20` Actions runtime.

## Inputs

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `slug` | yes | | The testedmcp listing slug |
| `command` | yes | | Stdio start command, or a URL for a remote server |
| `fail-on` | no | `breaking` | `breaking`, `any`, or `none` |
| `comment` | no | `false` | Post or update one pull request comment |
| `baseline-url` | no | the testedmcp baseline for the slug (not published yet) | Baseline JSON URL or a local path |
| `timeout` | no | `45000` | Milliseconds to wait for `initialize` and `tools/list`, and for the baseline fetch |

`fail-on: breaking` fails the job only on breaking differences, including a startup failure. `any` also fails on non-breaking differences. `none` still writes the summary and outputs but does not fail the job for differences. A baseline that cannot be fetched or parsed, or an invalid input, fails the job whatever `fail-on` says.

## Outputs

| Output | Meaning |
| --- | --- |
| `started` | `true` if the server completed `initialize` and `tools/list`, otherwise `false` |
| `breaking` | Number of breaking differences, including a startup failure |
| `non-breaking` | Number of non-breaking differences |

## Permissions

The comment step runs only on `pull_request` events. It needs `GITHUB_TOKEN` (or `GH_TOKEN`) in the step environment and `pull-requests: write`. No testedmcp credentials are required, and none should be added to your repository.

## Build and test (this repository)

Install with `npm ci --ignore-scripts`. Bundle the Action with `npm run build` (ncc writes `dist/index.js` and `dist/licenses.txt`; both are committed because GitHub runs `dist/index.js` directly). Run unit tests with `npm test` (`node --test`).

## Licence

MIT. Copyright the testedmcp team.

Questions: [support@testedmcp.com](mailto:support@testedmcp.com).
