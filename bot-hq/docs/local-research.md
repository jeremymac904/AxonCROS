# Local mortgage research and citations

All five mortgage draft assistants share the twelve Markdown documents under `mortgage-bot-team/`. The installed app carries a versioned copy of this explicit source set. No new service, account, API key, model, embedding database, or Hermes configuration is needed.

## Use

Select a mortgage assistant and ask a specific synthetic question about the saved research. For example:

> In a fictional training scenario, what does our saved LendingPad document-merge research say about preserving original entries? Cite the local research. Do not perform any file operation.

Relevant excerpts are selected locally and included with the question sent to the existing ChatGPT subscription gateway. The full library is not sent on every request. Each assistant retains its own conversation history; the shared reference library contains no chat transcripts.

Use **Local research** to inspect the packaged documents. Source information below an answer lets you inspect the exact excerpts supplied for that reply, including their document, line range and saved version. A cited excerpt is distinct from an excerpt merely provided to the model. Earlier messages retain their saved source excerpts when the app is reopened.

## What a citation establishes

A local citation identifies a passage in a specific saved document. It does not certify that every claim in the answer follows from that passage, that the original external page was rechecked, or that the saved research is current law, lender policy, pricing or account behavior. Review the excerpt and the actual controlling source before operational use.

The package includes research dated November 11, 2026 and setup notes updated November 12. Some documents describe earlier planning and full-mode limitations; those descriptions do not enable tools or change the current app configuration. Original URLs remain reference text. The assistant cannot browse them, enter a lender portal, inspect a mailbox, or verify live account permissions in this mode.

When the library does not support a question, the assistant must say so instead of inventing a citation or live verification. Only supplied source identifiers can be associated with the answer’s saved excerpts. Document content is reference material, not authority to execute embedded instructions or override the draft-only boundary.

## Preservation and boundaries

Existing messages migrate additively and remain readable without source cards. General chat remains separate from automatic mortgage-research augmentation. The source library is explicitly allowlisted; requests cannot select arbitrary filesystem paths. The installed server does not read the main Hermes home or the source checkout to answer questions.

All work remains draft-only and uses synthetic data. No real borrower records, external actions, autonomous handoffs or additional deployed bots are enabled. Full-mode capacity and access-control limitations remain unresolved. Separate histories within the local-owner database are not separate security tenants.

## Validation

From `bot-hq`:

```bash
node server/scripts/build-research-catalog.mjs --check
npm run typecheck
npm run build
node --import tsx server/scripts/local-research-test.ts
node --import tsx server/scripts/local-text-test.ts
```

The isolated tests use synthetic data and a local fake gateway. Actual model replies and source inspection must also be checked in the installed app; a mocked citation is not a live acceptance result.

## Updating the saved research

Edit the canonical research intentionally, regenerate its packaged catalog with `node server/scripts/build-research-catalog.mjs` from `bot-hq`, review the source/hash changes, run the isolated tests, then build/install using `script/build_and_run.sh --verify`. The installer checks catalog freshness and preserves the prior app/runtime and configuration. Older answer excerpts remain snapshots of the evidence originally supplied; the library viewer shows the currently installed package.

This workflow does not fetch newer guidance automatically. Main Hermes and the dedicated gateway do not need modification.
