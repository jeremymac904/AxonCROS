# LendingPad and Encompass: mortgage-team platform research

Research date: November 11, 2026. Status: public-source orientation and draft training plan. No account, sandbox, user role, lender connection, video playback, or live loan was tested. Three English video transcripts were retrieved, as identified below. The sources below describe products and documented examples; they do not establish the current configuration or authority in any particular broker's system. Recheck the exact vendor page, release, tenant permissions, lender guidance, and company procedures before use.

## Evidence and interpretation

- **Written documentation reviewed:** the vendor text at the cited pages was read for the specific statements below. Some LendingPad material is older and may differ from a current tenant.
- **Video links and transcripts:** the vendor's training index associates a link with a topic. The research tool could not fetch the YouTube video players; Zoom links returned generic pages rather than playable content. Three English transcripts were separately retrieved through vidIQ as detailed below. No video was visually watched, and other video contents were not verified. Link availability and accuracy must be checked independently.
- **Catalog entry only:** ICE describes courses and learning objectives publicly. The courses were not opened or completed. ICE's [subscription video library](https://education.elliemae.com/videos) redirected to sign-in in this research session.
- **Implementation:** these notes do not train or deploy a bot, give it access, or demonstrate reliable operation. They are an indexed learning and validation backlog.

## LendingPad training catalog

The official [Getting Started guide](https://kb.lendingpad.com/getting-started-in-lendingpad) organizes material for originators, processors, administrators, underwriters and closers, while the [training page](https://lendingpad.com/training/) describes free live origination and processing courses. The training page lists closing and underwriting recordings as well. Vendor labels and links are recorded below; playback remains unverified. Three transcripts were examined as noted below.

| Topic as identified by vendor | Direct video | Evidence status |
| --- | --- | --- |
| Loan Estimate cost details; AUS; Fannie Mae 3.2 or MISMO 3.4 download | [Loan workflow video](https://www.youtube.com/watch?v=DZVM3OyDd1k) | Vendor index; English transcript reviewed for the timed portions below; no visual verification. Download coverage is index-only. |
| File review; critical dates, milestones and assignment | [File review and milestones](https://www.youtube.com/watch?v=8JhK7x_c0bs) | Vendor index; not watched. |
| Document management | [Document management](https://www.youtube.com/watch?v=t9ZL7GqRHx4) | Vendor index; transcript reviewed, no visual verification. |
| Forms and eSign | [Forms and eSign](https://www.youtube.com/watch?v=jvp9u4yBKnQ) | Vendor index; transcript reviewed, no visual verification. |
| Title order | [Title](https://www.youtube.com/watch?v=TqpajEoPCfU) | Vendor index; not watched. |
| Appraisal order | [Appraisal](https://www.youtube.com/watch?v=quyyaTr6zXM) | Vendor index; not watched. |
| Hazard insurance order | [Hazard insurance](https://www.youtube.com/watch?v=ZnoKtUMueRc) | Vendor index; not watched. |
| Closing course | [Closing](https://youtu.be/mp2d1F2kkUw) | Vendor training page labels this closing; not watched. |
| Underwriting course | [Underwriting](https://youtu.be/XwvuQ8dCpx8) | Vendor training page labels this underwriting; not watched. |
| Link documents and underwriting conditions | [Condition linking video](https://share.vidyard.com/watch/sz2GnmGLMxC2yp9kZ7jEj2) | Linked from a written vendor article; video could not be fetched. |

### LendingPad AUS video: transcript notes, not a visually verified procedure

The English transcript for the [vendor-indexed loan workflow video](https://www.youtube.com/watch?v=DZVM3OyDd1k) was retrieved through vidIQ on November 11, 2026; the caption track kind was not provided. The transcript contains recognition errors, including a transcription of “AUS” as “a us.” Timings and spoken content are research notes, not visual confirmation or a current tenant procedure:

- **0:17–2:12:** The transcript covers review of borrower and loan application information and disclosure cost details.
- **2:28–3:33:** It describes an AUS request from Actions > System Actions > AUS, including Fannie/Freddie, request type, provider/report ID and sending. Availability and wording may differ by release, integration, and permission. Do not send a request without the required authorization and a safe test setup.
- **3:33–4:39:** It describes a success response and finding views in AUS or documents. An observed provider response must be verified in the actual system; transcript text is not proof of a successful request.

### Additional LendingPad transcript notes

The English transcripts for the following vendor-indexed videos were retrieved through vidIQ on November 11, 2026. Caption-track type was not supplied; timestamps are approximate and transcription can be inaccurate. Neither video was visually watched or tested in a tenant.

**[Document management](https://www.youtube.com/watch?v=t9ZL7GqRHx4):** 0:16–2:11 describes opening a file and adding a document, including bucket, effective date and confirmation; 2:42–9:11 describes page operations such as copy, move, delete and reorder; 10:21–12:32 describes merging and warns that example sources disappear or are deleted after merging. Treat merging and deletion as potentially destructive: preserve originals and do not perform either without verified recovery and authorization.

**[Forms and eSign](https://www.youtube.com/watch?v=jvp9u4yBKnQ):** 0:15–2:45 discusses forms, settings and packages; 3:01–9:14 custom templates and conditions; 12:26–17:36 previewing, activating eSign, sending a request, status and a downloaded signed copy. A historical fee mentioned in the transcript is not evidence of current pricing. Obtain human approval and check tenant and lender rules before sending or making setup changes.

The vendor's course descriptions say origination covers applications, document collection, status coordination and AUS; processing covers preparation for internal or outside underwriting, conditions, document and task management, closing scheduling and disclosures. Closing covers data, fees, CD preparation and doc-vendor information. These are stated course scopes, not reviewed instructional content. Live sessions and recordings can require registration or a current login. [Source](https://lendingpad.com/training/)

## LendingPad: documented behaviors and boundaries

1. **Intake, channel and lender:** The getting-started guide describes assigning an application-taken date to move a file from Leads to Pipeline, and says selecting a lender changes its origination source to broker in the described workflow. Default behavior may treat an unselected lender as a banked loan. Verify this against the actual edition and reporting configuration before taking any action. Never use that status change as proof of legal application timing or lender acceptance. [Source](https://kb.lendingpad.com/getting-started-in-lendingpad)
2. **Documents and conditions:** LendingPad's written [document-upload article](https://kb.lendingpad.com/how-to-upload-documents) describes uploading in the Documents area and optionally labeling, indexing and linking a condition. Its older [condition-linking guide](https://kb.lendingpad.com/how-to-link-documents-and-underwriting-conditions) describes selecting one or more underwriting conditions while adding a document; the underwriter can view the linkage in the UW / Conditions panel. Linking is not proof the document satisfies the condition, that it reached an external lender, or that the lender cleared it.
3. **Fees and disclosure review:** In the account-executive view, the [Disclosure tab guide](https://kb.lendingpad.com/disclosure-tab-for-account-executives) describes fee worksheet, LE, CD, cushion, compliance and amortization previews and says sections and edit permissions vary by loan type and role. LendingPad's [fee FAQ](https://kb.lendingpad.com/faq-why-lendingpad-does-not-need-closing-costs-or-transaction-templates) says its broker edition can populate lender fees where information exists, while company-level settings can supply other fees. Defaults must be reconciled to the current lender fee sheet, pricing, title and provider quotes; presence of a calculated fee or PDF does not establish its accuracy or issuance.
4. **Services and submission:** The [Actions tab guide](https://kb.lendingpad.com/actions-tab-for-account-managers) says actions must be enabled by an administrator and documents options including service requests, AUS and internal submit-to-processing or submit-to-underwriting. It describes specific integrations, including Mercury Network for an appraisal, in the context of that configuration. Internal routing to an underwriting department is not evidence of delivery to a wholesale lender. Determine the correct lender channel, permitted provider, fee, payment and acceptance confirmation before any order or external submission.
5. **Controls and edition:** The [getting-started guide](https://kb.lendingpad.com/getting-started-in-lendingpad) says company administrators can restrict screens by role and file status, and warns that broker-to-hybrid/NDC transitions change responsibilities, including disclosure and closing functions. Its advice to run sample loans supports testing the actual setup. Do not assume broker, lender, hybrid and NDC editions share authority or screens.

## ICE Encompass training catalog

ICE says its [training video library](https://mortgagetech.ice.com/education) is part of an Encompass subscription. Access to the linked library redirected to a sign-in service during research; the titles and video contents behind it were not verified. The [ICE course catalog](https://shop.ice.com/cat/EDU_PENC.html) separately describes paid persona-based courses with video demonstrations. Access and current price must be checked before purchase.

| ICE catalog course | Vendor-described coverage | Verification |
| --- | --- | --- |
| Getting Started | Pipeline, borrowers, milestone worksheet, eFolder, alerts and messages | Catalog description read; course not accessed. |
| Originator | Application, credit and other services, eConsent, initial disclosures, pricing and locks, changed circumstances, eFolder and communications | Catalog description read; course not accessed. |
| Processor | Essential processing duties | Catalog description read; course not accessed. |
| Disclosure Desk | Initial LEs and changed-circumstance redisclosures and tracking | Catalog description read; course not accessed. |
| Closer and Funder | Pre-closing CD, fee variance, audit and tracking, settlement package, conditions, UCD and funding | Catalog description read; course not accessed. |
| Underwriter | Data validation, decisions, document manager and underwriting conditions | Catalog description read; course not accessed. |

The catalog contains functions for lender personnel as well as broker personnel. A course's coverage does not confer permission to perform any function. ICE describes desktop and web interfaces coexisting with configuration and workflow differences; the specific version and persona must be established before applying any screen instructions. [ICE training description](https://mortgagetech.ice.com/experience/training)

## Encompass: documented behaviors and boundaries

- **Requesting documents and services:** ICE's [Consumer Connect document-request guide](https://help.icemortgagetechnology.com/documentation/consumer-connect/Content/consumer-connect/managing_documents/Request_Documents.htm) describes requests from the eFolder Documents or condition tabs where the administrator grants permission. It distinguishes borrower documents from settlement services, describes resulting expected/ordered statuses, and says the request is reflected in the loan log. An order status is not proof of provider acceptance or completion.
- **Initial disclosures:** ICE's [Consumer Connect initial-disclosures guide](https://help.icemortgagetechnology.com/documentation/consumer-connect/Content/consumer-connect/managing_documents/Send_eDisclosure_Documents.htm) describes borrower-pair selection, package and plan-code rules, audit, ordering, preview and sending in its documented configuration. It says administrators determine whether users select packages and may restrict changes to the documents. Generating or previewing a package does not prove issuance, receipt, eConsent, or compliance. Obtain the lender/broker's written allocation of responsibility and actual delivery evidence. A wholesale lender may be the issuing party even if a broker sees a disclosure feature.
- **Web versus desktop and conditions:** ICE's [25.1 release notes](https://help.icemortgagetechnology.com/documentation/encompass/Content/encompass/release_notes/25-1/RNBP/index.htm) describe a desktop eFolder link to web conditions only when enhanced conditions exist and the user has the relevant web persona permission. This is version-specific; standard and enhanced conditions and their status permissions must be identified in the actual tenant.
- **Borrower portal and integrations:** ICE's [document overview](https://help.icemortgagetechnology.com/documentation/consumer-connect/Content/consumer-connect/managing_documents/Documents_Overview.htm) discusses Consumer Connect authentication and eSigning. Verify whether that product and the relevant document, disclosure, credit, pricing and service integrations are actually enabled; do not generalize its instructions to another borrower portal or loan product.

## Role handoffs for this team

These are desired responsibilities, not statements that the bots have authorization, integration, or a validated platform procedure.

| Bot | LendingPad and Encompass orientation | Human handoff / evidence |
| --- | --- | --- |
| Team leader | Track system, tenant, loan identity, role assignments, deadlines, next owner and blockers across the LOS and wholesale portal. Detect conflicting statuses and duplicate or unconfirmed actions. | Obtain the licensed professional's decisions; distinguish draft, sent, received, reviewed, accepted and cleared. Maintain an audit trail. |
| Loan officer assistant | Review application completeness and data against source documents, organize missing information and candidate scenarios; prepare questions and explain status for LO review. Identify credit, AUS, pricing and lender-specific needs without issuing credit decisions. | LO verifies accuracy, borrower authorization, eligibility and appropriate communications before external effects. |
| Processing assistant | Assemble checklist, classify documents, identify inconsistencies, map conditions to supporting materials, prepare lender submission and orders, reconcile fees and closing figures, and track status. | Processor or designated professional validates, submits or authorizes each material action; lender alone determines its own conditions, decisions and acceptance. |
| Email assistant | Prepare borrower, title, insurance, lender and agent follow-ups with minimum necessary information; associate draft and verified response with the right loan. | Human approves recipients, secure channel and content before sending unless separately authorized controls exist. No assumption that a draft, notification or LOS task was delivered. |
| Marketing assistant | Prepare permission-aware educational and referral material using approved sources and company policies. | Compliance and marketing review content and campaigns; do not expose borrower information or initiate newsletters from platform training alone. |

## Tenant-specific discovery before any implementation

1. Obtain a nonproduction or explicitly authorized training tenant, synthetic loan, exact product/edition and release, desktop versus web interface, user personas, role matrix and any company custom fields, forms, business rules, milestones and audit controls.
2. Determine whether the brokerage is acting as broker, lender or hybrid/NDC for the exercise and which party owns LE/CD preparation, issuance, redisclosure, fees, appraisal and closing workflow for each wholesale lender. Written company/lender procedures govern the actual assignment.
3. Inventory activated document, portal, eSign, credit, AUS, pricing, lender transfer, vendor order, notifications and email integrations, including whether actions are real, billable or external and what receipts or status events they return.
4. Identify access boundaries and permitted computer automation. Test with least-privilege accounts and no shared credentials. Production and customer data require the organization's approved security, access and vendor arrangements.
5. Verify the relevant official source and exact version, then confirm the observed UI and permissions in the sandbox. Treat a conflicting, missing, stale or ambiguous control as a stop for human review. Never bypass MFA, access controls or a failed approval.

## Synthetic end-to-end exercise: proposed, not executed

Use one invented purchase file with synthetic borrower and document data, a sandbox lender and test provider endpoints. Record for each step the tenant and release, acting role, authority, expected result, observed UI and redacted evidence, local and remote status, errors and reviewer disposition. Do not enter real borrower identifiers or transmit externally.

1. **Intake and reconciliation:** Create or open the synthetic application under the authorized test role. Compare 1003 data with fabricated pay stub, bank statement, ID and purchase contract; identify a deliberate mismatch and missing item. Expected: a cited exception and draft request assigned to a person; no invented document conclusion.
2. **Loan setup:** Confirm broker channel and selected test lender, program assumptions and source/version of pricing and fees. Review a preview against a known test fee sheet. Expected: itemized differences and no assertion that a disclosure was issued.
3. **Documentation and conditions:** Add a synthetic document where the sandbox permits; link it to a synthetic condition using the applicable documented workflow. Reopen and verify association. Expected: received/linked is kept distinct from reviewed/satisfied/cleared and from external lender receipt.
4. **AUS and submission:** With a mocked or approved test-only integration, prepare an AUS request and lender submission. Verify correct data, selected destination, required artifacts and explicit human approval before any triggering action. Capture a test response or mark this portion blocked if a safe endpoint is unavailable. Confirm lender acceptance separately from LOS routing.
5. **Disclosures and orders:** Prepare, preview and reconcile a synthetic LE; identify which organization must issue it. Prepare test-only title, insurance and appraisal requests, checking recipient, fees and authorization. Without a safe endpoint, stop at drafts. Record a delivery or order confirmation only if generated by the test service; never infer from clicking.
6. **Closing and follow-up:** Compare a synthetic early CD, fee worksheet, title statement and final figures; identify an intentional discrepancy and changed-circumstance question for review. Draft borrower and agent updates with approved destinations. Verify the actual authorized party and evidence for any CD delivery and timing; do not send or claim receipt in this exercise.
7. **Failure and audit:** Test missing permission, unavailable integration, conflicting borrower data, duplicate submission attempt and absent external receipt. Expected: halt, preserve evidence, assign a human, and avoid claiming successful completion. Confirm that sensitive synthetic artifacts and logs are handled according to the test environment's retention rules.

**Release gate:** Pass the above steps separately for each tenant, interface and role, with recorded evidence and explicit authorization for the specific action. Public instructions and video titles alone are insufficient to enable the bots to operate the LOS or lender portals.
