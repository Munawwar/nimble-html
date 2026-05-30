# nimble-html VS Code tooling

This in-repo extension package bundles:

- tagged-template syntax highlighting for `html`, `svg`, and `mathml`
- the `nimble-html-typescript-plugin` server plugin for diagnostics and completions

The TextMate grammar files in `syntaxes/` are adapted from
`mjbvz/vscode-lit-html`, which is MIT licensed.

Local testing from the repo root:

- `npm run vscode:prepare`
- `npm run vscode:package`
- `npm run vscode:install`
- `npm run vscode:dev`

The existing fixture workspace at `tooling/test-fixtures/fixture-project` is the target
for manual diagnostics and completion checks.
