# Deployment and integration plan

## What exists

Installed Bot HQ is a Node server and web interface presented in a native Mac window. The source exposes a General settings panel with name, label, about, instructions and bot-specific skills. Instructions are appended to the context for that bot; the primary bot uses the existing Hermes persona, while managed bots have generated persona files. Each bot's skill bodies are included in that bot's prompt. There is no verified bulk-import feature. Individual prompts are text, not operating-system permissions or evidence of adherence.

The default server cap is four visible bots, and the Orgo computer screen lease itself has a four-screen maximum. Subagents also use screens. The desired five separate roles therefore do not currently fit on one Orgo computer. Provider values in the installed configuration are empty and the installation has no existing bot data. Setup and app-server health are not evidence that Orgo, Hermes, email, lender connectivity, data security, or five-role coordination works.

## Design choices requiring validation

1. **Five independent roles on another architecture.** Evaluate a runtime able to run at least five separate agents and allocate browser access only to roles that require it. Verify that it supports the requested lender flows, durable tasks, logging, technical controls and permitted integrations before selecting it.
2. **Extend Bot HQ.** Investigate separating agent execution from a screen lease, so a team leader or another role can work without an Orgo screen and an eligible agent acquires one when needed. This is a design hypothesis, not a supported feature: identity, session ownership, orchestration, concurrency, leases, remote Hermes routing, reconnects, handoff and cleanup require implementation and full tests. Do not raise `MAX_BOTS` and assume success.
3. **Four physical bots with five logical roles.** Combining roles can be a temporary compromise, but it reduces independence and can mix data permissions. Only use if the owner accepts the tradeoff and the platform can enforce appropriate access; it does not meet the requested five-bot architecture by itself.

A second Orgo computer or server is not established to work with this application. Validate multi-computer routing, operating costs, account access, message exchange, state isolation and shared scheduling before presenting it as an option.

## Proposed implementation order

1. Identify the jurisdictions, programs, specific lender/LOS/CRM/document tools, operating owner, provider contracts and delegated human authorities. Record supported and unsupported actions in an action matrix.
2. Resolve runtime design for five distinct roles and proof of durable handoffs. Inspect live versions and existing configuration before modifying any source, data, Hermes home or integrations. Preserve rollback and originals.
3. Establish private storage and approved model/service processing: data inventory, access per role/case, encryption, authentication/MFA, source-specific retention and deletion, least-privilege service accounts, tenant boundaries, logging/redaction, incident response, backups and vendor/contract approval. Do not expose borrower data to unapproved AI endpoints or to a shared screen/filesystem.
4. Implement **enforced** controls for each send, update, order, disclosure, upload, portal action and other external side effect. Approval must bind the action, target, material payload, authority and expiration; log the receipt and reconcile uncertain outcomes. Restrict raw shell, browsers, arbitrary network access and secret access so agents cannot bypass the control. “Ask first” in a prompt is insufficient.
5. Load and version the shared sources and role instructions. Maintain agency guide, agency bulletin and lender overlay effective dates, AUS version, transaction-specific evidence and source supersession. Never copy unverified borrower training files into a generic source corpus.
6. Populate five bot profiles using the actual runtime's supported settings. Route tasks with a named owner and ensure messages are acknowledged. Do not auto-enable routines; define quiet hours, consent, review and escalation first.
7. Complete [acceptance scenarios](05-acceptance-tests.md) and documented adversarial/permission tests with fabricated data. Correct failures and repeat affected checks. Then plan a separately approved, narrowly scoped pilot with named human oversight.
8. Only after the pilot and company approval, expand to authorized integrations and the specific actions approved by the business. Monitor errors, reconcile receipts, review performance and revoke access or roll back on failure.

## State and action record

Use an external durable case store, not chat text alone. Each case should record an opaque ID, authorized owner(s), program/lender and state, relevant source versions, event timestamps and timezone, current state, dependencies, deadlines, approvals, vendor status, exception history, next owner and receipt links. Restrict access by role and case. Use the minimum necessary identifiers; secrets and raw borrower files belong only in approved systems.

Suggested status vocabulary: `not_started`, `requested`, `received`, `under_review`, `needs_information`, `ready_for_human_review`, `approved_for_action`, `submitted`, `acknowledged`, `rejected`, `completed`, `blocked`. A draft, request, submission, acknowledgment, and completed outcome are distinct; a transfer of work is not acceptance until the recipient acknowledges it. Specific lender systems may require a different mapping.

## Setup worksheet

| Input | Current value |
|---|---|
| Licensed states, company and responsible people | To be provided |
| Wholesale lenders, products and overlays | To be provided |
| LOS/POS, CRM, document vault and email | To be provided |
| Verified Hermes gateway and provider | Not configured in Bot HQ |
| Orgo computer/account and app service credentials | Not configured in Bot HQ |
| Approved data processors, geographic/retention restrictions | To be provided |
| External action authority, allowed integrations and review owner | To be provided |
| Five-bot capacity and access enforcement | Not implemented or validated |
| Business hours, holidays, SLA and escalation contacts | To be provided |

This plan deliberately does not create a subscription, provision a computer, connect an account, alter Hermes, deploy bots, send messages, or upload personal information.
