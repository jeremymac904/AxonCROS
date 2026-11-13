# Wholesale Mortgage Bot Team — research and design package

**Status:** Draft profiles and operating design, researched November 11, 2026. No bots have been created and no provider, lender, email, or borrower system has been connected. This is a U.S. federal, platform-neutral baseline; state, product, wholesaler, employer policy, and system-specific requirements remain to be supplied and validated. This package is generic and contains no borrower information.

## November 12 local text implementation

All five profiles are available as selectable **draft text assistants** in the Mac app, each with separate conversation histories. Existing general conversations are preserved. They use one serial ChatGPT subscription gateway and have no tools, connected inboxes, live source retrieval or autonomous handoffs. This does not deploy the five-bot operating design below or resolve its full-mode screen capacity and access-control gaps. Use synthetic data only. See [local text mode](../bot-hq/docs/local-text-mode.md).

## Team

| Role | Owns | Hands off to |
|---|---|---|
| Team Leader | Intake routing, case state, exceptions, deadline coordination, quality and human escalation | Assigned specialist and human case owner |
| Loan Officer Assistant | Borrower discovery support, application completeness, preliminary scenario research, LO follow-up | Licensed LO; processor for documented handoff |
| Loan Processing Assistant | File evidence, submission readiness, conditions, third-party coordination, disclosure and closing support | LO, lender, title/insurance providers and closing team through approved channels |
| Marketing Assistant | Campaigns, referral-partner education, market content, compliance-ready drafts | Human marketing/compliance reviewer and Email Assistant |
| Email Assistant | Inbox triage, contact context, draft correspondence, follow-up tracking and approved newsletter operations | Appropriate specialist and authorized reviewer |

The team assists licensed people and the wholesale lender; it does not act as the creditor or underwriter. The loan officer remains accountable for advice and broker-side decisions; the lender retains its own underwriting, disclosure, appraisal, closing, and other legal obligations. A person with authority approves actions in accordance with company policy.

## Read in this order

1. [Team operating model](01-team-operating-model.md): ownership, handoffs and worked examples.
2. [Loan lifecycle and document review](02-loan-workflow.md): stages, evidence, roles, and exit criteria.
3. [Controls and source registry](03-controls-and-sources.md): legal starting points, source hierarchy, data access and approval requirements.
4. [Copy-ready role profiles](04-bot-profiles.md): five distinct configurations formatted for Bot HQ's existing settings fields.
5. [Acceptance scenarios](05-acceptance-tests.md): synthetic cases to prove the team can recognize risks and perform handoffs.
6. [Deployment and integration plan](06-deployment-plan.md): actual Bot HQ constraints, security gaps, rollout gates and decisions.
7. [Platform training research](07-platform-training/00-START-HERE.md): Loan Factory, ARIVE, LendingPad, Encompass, Sonar, UWM EASE and Rocket Pro materials and validation gaps.

## Current implementation reality

The local Bot HQ installation has no Orgo, Composio or xAI credentials configured and no existing bot data. Its current architecture supports **four screens/bots per Orgo computer**, while the requested team has five roles. Hidden subagents also consume screens. Changing a configuration number is not enough to make five independent bots work. A real five-bot team requires a tested architecture change or another verified deployment arrangement. Do not substitute four merged roles without the owner's decision.

Bot HQ's upstream README says bots share a computer and can reach one another's files; browser and shell actions are not gated by its approval cards. Its connected-app approval heuristics and prompt instructions do not provide a complete, independently verified permissions boundary. Accordingly, this package is a design and test specification, not an authorization to use live borrower information, access email, order services, send messages, change lender files, issue disclosures, or transmit financial information. A controlled implementation must enforce those boundaries outside the model and be tested before real data is used.

## Information needed for an operational configuration

- States in which the broker and individual originators are licensed; company licensing and branch disclosures.
- LOS/POS, CRM, email and document portal; approved provider contacts; lender portals and API access.
- Wholesale lenders and account-specific overlays, pricing, current broker agreement, portal procedures and division of responsibility for each disclosure and order.
- Initial products and transaction types; owner for conventional, FHA, VA, USDA, non-QM, first lien/other liens, purchase/refinance and exceptions.
- Approved models, processing and storage locations, contracts, security/privacy rules, retention, logging, customer consent, integrations and account permissions.
- Delegated authorities, communication approvals, escalation owners, hours and calendars; who is authorized to perform each action.
- Current source library and account access. Agency guidance does not replace an applicable wholesale lender's current written instructions or AUS findings. Conflicts or missing information require review.

The details above affect the design and its readiness; none were assumed from an existing customer file.
