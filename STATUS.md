# Status

## Achieved

- Added type-level hole parsing in [html.d.ts](./html.d.ts).
- The declaration typing now distinguishes these hole kinds:
  - regular attributes like `value=${...}`
  - property holes like `.value=${...}`
  - boolean attribute holes like `?checked=${...}`
  - event holes like `@click=${...}`
  - child/content holes like `${...}` inside element content
- The typing uses DOM maps where possible:
  - attribute/property lookup is based on the relevant DOM element type
  - event handler typing uses `GlobalEventHandlersEventMap` when available
- `force(...)` is accepted for typed holes.
- Added type tests in [test/typecheck.ts](./test/typecheck.ts) covering:
  - success cases
  - `@ts-expect-error` failure cases
  - attr, `.prop`, `?boolAttr`, and `@event`
- Verified commands:
  - `npm run typecheck:api`
  - `npm run build`

## Not Achieved

- The exact direct tagged-template negative case is still not enforceable with current released TypeScript:

```ts
html`<input value=${'ok'} checked=${true} />`
// @ts-expect-error input.value should be string
html`<input value=${123} />`
```

- The positive direct tagged-template smoke case works in tests, but the negative direct tagged-template case does not become a type error from declarations alone.
- I verified this limitation locally against:
  - `typescript@5.9.2`
  - `typescript@5.9.3`
  - `typescript@next`
- I also verified that this is not just a `.d.ts` limitation:
  - a real `.ts` implementation signature using
    `function tag<const T extends readonly string[]>(strings: TemplateStringsArray & T, ...)`
    still infers `readonly string[]` instead of the literal segment tuple for
    direct tagged-template calls.
- I also verified that a direct tagged-template call cannot satisfy even a
  concrete `strings.raw` tuple parameter such as:
  - `TemplateStringsArray & { raw: ['<input value=', ' />'] }`
  - TypeScript still treats the call-site argument as `TemplateStringsArray`
    with `raw: readonly string[]`, so the structural match fails.

## Why It Is Blocked

- TypeScript does not currently expose tagged-template string segments as an inferable literal tuple for a plain `html(strings: TemplateStringsArray, ...values)` API.
- That means the library can type holes correctly once the template parts are known, but the compiler does not provide enough type information for direct `html\`...\`` declarations to discriminate hole context precisely.
- Tuple-backed `TemplateStringsArray` test calls do validate the hole typing logic end to end, and those are what the current negative tests rely on.

## Comparison With `typed-html-templates`

- The important difference is the call shape, not the hole parser itself.
- `typed-html-templates` gets its strongest checked failures through tuple-preserving helper forms such as:
  - `template(['<input value=', ' />'] as const)`
  - `html(...template(...))`
- Those helper forms preserve the template parts as a literal tuple, which gives TypeScript enough information to map each hole to the correct expected value type.
- Its direct tagged-template coverage is mostly positive/smoke coverage.
- A direct repro of the negative case in that repo:

```ts
html`<input value=${'ok'} checked=${true} />`
// @ts-expect-error input.value should be string
html`<input value=${123} />`
```

produced `Unused '@ts-expect-error' directive`, which means the direct negative tagged-template case was not rejected there either.

- So the reference repo does not demonstrate a declaration-only solution for the exact direct negative tagged-template requirement either.

## Current Evidence In Repo

- Main declaration work: [html.d.ts](./html.d.ts)
- Type tests: [test/typecheck.ts](./test/typecheck.ts)
- Current test coverage includes:
  - `value=` success and failure
  - `checked=` success and failure
  - `.value=` and `.checked=` success and failure
  - `?checked=` success and failure
  - `@click=` success and failure
  - `@input=` event type failure

## Practical Summary

- The hole type model is implemented.
- The dedicated type tests pass.
- The remaining gap is specifically the direct negative tagged-template case, which appears blocked by TypeScript rather than by the `nimble-html` declarations.

## Completion Audit

### Requested deliverables

- Direct tagged-template success case:
  - Required: `html\`<input value=${'ok'} checked=${true} />\``
  - Evidence: covered as a direct smoke case in [test/typecheck.ts](./test/typecheck.ts).
  - Status: achieved

- Direct tagged-template negative case:
  - Required:
    `// @ts-expect-error`
    `html\`<input value=${123} />\``
  - Evidence:
    - attempted through declaration typing in [html.d.ts](./html.d.ts)
    - compiler probes documented above
    - no declaration-only implementation found that makes this a direct type error
  - Status: not achieved

- Type safety for regular attr holes:
  - Required: type-check attr holes like `value=${...}` and `checked=${...}`
  - Evidence: covered in [test/typecheck.ts](./test/typecheck.ts)
  - Status: achieved

- Type safety for `.prop` holes:
  - Required: type-check property holes like `.value=${...}`
  - Evidence: covered in [test/typecheck.ts](./test/typecheck.ts)
  - Status: achieved

- Type safety for `?boolAttr` holes:
  - Required: type-check boolean attribute holes like `?checked=${...}`
  - Evidence: covered in [test/typecheck.ts](./test/typecheck.ts)
  - Status: achieved

- Type safety for `@event` holes:
  - Required: type-check event holes like `@click=${...}`
  - Evidence: covered in [test/typecheck.ts](./test/typecheck.ts)
  - Status: achieved

- Type tests with success and error cases:
  - Required: include succeeding and error cases where possible
  - Evidence: [test/typecheck.ts](./test/typecheck.ts) contains positive cases and multiple `@ts-expect-error` cases
  - Status: achieved

- No compiler/transformer approach:
  - Required: no compiler or transform step to rewrite tagged templates
  - Evidence: implementation is declaration-only typing in [html.d.ts](./html.d.ts); no transform pipeline was added
  - Status: achieved

- No `html.X` cheat:
  - Required: do not replace the requested syntax with alternate public API like `html.X`
  - Evidence: the exported API remains `html`, `svg`, `mathml`; no `html.X` API was introduced
  - Status: achieved

### Verified commands

- `npm run typecheck:api`
  - Status: passes

- `npm run build`
  - Status: passes

### Final audit result

- The repo now has working hole typing logic and type tests for attr, `.prop`, `?boolAttr`, and `@event`.
- The explicit remaining unsatisfied requirement is the direct negative tagged-template error case.
- Because that requirement is not met, the overall original goal is not yet complete.
