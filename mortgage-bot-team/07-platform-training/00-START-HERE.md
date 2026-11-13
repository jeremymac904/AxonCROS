# Platform training research — Loan Factory, ARIVE, LendingPad, Encompass, Sonar, UWM and Rocket Pro

**Research date:** November 11, 2026. This package documents publicly available training and identifies what remains to be learned in a permitted training environment. It does **not** mean a bot has been trained or deployed, that a video title proves its contents, or that an account-specific procedure works.

## Platform guides

1. [Loan Factory and ARIVE](01-loan-factory-arive.md): Loan Factory Academy, TERA/MOSO naming questions, ARIVE's vendor guidance and integrations, public webinar transcript, and role-based exercises.
2. [LendingPad and Encompass](02-lendingpad-encompass.md): vendor-linked videos and help articles, three timestamped LendingPad transcript summaries, Encompass role-based training and documentation, and account-specific checks.
3. [Sonar, UWM EASE and Rocket Pro](03-sonar-uwm-rocket.md): vendor training entry points, available workflow evidence, gated material, and tests for platform-specific permissions and statuses.
4. [Shared platform research skill](04-platform-skill.md): copy-ready instructions to help each future bot identify the right platform, source, action boundary, and receipt. This is a draft; it has not been loaded into a bot and prompt text does not enforce permissions.

## How to use this research

- A **vendor article or official course index** establishes only what its text says at the time reviewed. Vendor claims and marketing features are not independent proof of a feature being enabled in a particular brokerage.
- A **transcript-reviewed video** establishes what its spoken captions describe, with the date and approximate timestamp. Transcripts can contain errors, often omit on-screen details, and are not a live tenant test. We did not visually watch the videos. Training interfaces may change; no clip establishes that our bots can execute the workflow today.
- **Title/index only** means the course or video was identified, but its contents were not read or watched. Login-required lessons were not accessed. A training catalog does not establish completion.
- **Validated in tenant** requires a separate synthetic end-to-end test in that exact permitted version, role, lender integration and environment, with evidence and human review. No workflow has reached this status here.

## Immediate priorities for the team

The LO and processing assistants need platform-specific workflows for intake, URLA, document review, lender selection/pricing, AUS, lender submission, disclosures, conditions and closing. The email assistant needs approved message routing, secure document requests and receipts. The marketing assistant needs platform-specific CRM/campaign permissions and suppression checks. The team leader needs status reconciliation, deadlines, task ownership and confirmed handoffs across those systems.

Treat the brokerage LOS, the lender's portal, any document provider, and the actual underwriter/settlement system as separate systems of record unless the specific integration and transaction prove otherwise. For example, the public [ARIVE lender integration table](https://support.arive.com/support/solutions/articles/61000271226-which-wholesale-lenders-are-integrated-with-arive-) lists pricing, integrated submission and TPO loan sync for UWM and Rocket Pro TPO, but does not show integrated document submission for either in the table inspected. Verify current account configuration and each document receipt; do not infer it from the connection.

Before hands-on practice, identify which of these platforms the brokerage actually uses, the permitted test tenant and role, the relevant lender/provider, and the dates and versions of the training. Vendor and brokerage permission for automated computer access must be established. Use only synthetic data until the security, privacy and approval requirements in the existing [deployment plan](../06-deployment-plan.md) are met. No credentials, borrower files, live accounts, messages, applications, orders or disclosures were accessed or modified during this research.
