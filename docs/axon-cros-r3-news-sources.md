# Revision 3 news sources and Ideas

Reviewed and exercised November 12, 2026. This is a local implementation record, not a publisher license or a deployment claim. No new account, paid subscription, credential, model call or outreach was used in source checks.

## Working public adapters

The explicit live check (`bot-hq/server/scripts/axon-news-live-check.ts`) retrieved and parsed all six adapters below from their documented URLs. Its receipt is `../verification/axon-cros-r3-20261112/news-live-source-check.json` relative to the repository. The isolated regression suite is `node --import tsx server/scripts/axon-news-test.ts` from `bot-hq`; it substitutes every network response and uses a temporary database.

| Adapter | Verified mechanism | Meaning and limits |
| --- | --- | --- |
| Federal Reserve monetary policy | Published [RSS directory](https://www.federalreserve.gov/feeds/feeds.htm), `press_monetary.xml`; 15 release cards parsed | Official releases, not commercial mortgage commentary. Original links/publication times retained. [Board text is public domain unless marked otherwise](https://www.federalreserve.gov/disclaimer.htm); photos and full article pages are not scraped. |
| Federal Reserve banking/consumer policy | Same directory, `press_bcreg.xml`; 15 release cards parsed | Official regulatory/industry releases. Canonical duplicates collapse while retaining source attribution. |
| BLS CPI releases | [Published CPI feed](https://www.bls.gov/feed/cpi.rss); Atom entries parsed | The published `.rss` address currently delivers Atom. One earlier Python request returned HTTP 403; the actual Node adapter retrieves the published feed. Future access errors retain prior content and show a source error; no bypass route is used. [BLS reuse policy](https://www.bls.gov/bls/linksite.htm) permits its public-domain text with attribution. |
| BLS CPI-U | [Unregistered API v1](https://www.bls.gov/developers/api_FAQs.htm), series `CUUR0000SA0` | Monthly all-items US city-average index, not seasonally adjusted, base 1982–84=100. An index level is not a percent change. One daily request protects the shared unregistered API limit; publication timestamp is unknown rather than invented. |
| Treasury yield curve | [Documented daily XML endpoint](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed) | Latest dated 2-, 10-, 30-year nominal constant-maturity yields in percent. Daily Treasury yields are not live MBS prices or consumer mortgage rates. |
| FHFA local housing research | [Documented metro CSV](https://www.fhfa.gov/data/hpi/datasets), `hpi_at_metro.csv`;410 latest metro observations parsed | All-transactions HPI, quarterly, not seasonally adjusted. Jacksonville is matched by published CBSA 27260, not by incidental text. [FHFA explicitly permits HPI use with attribution](https://www.fhfa.gov/faqs/hpi). This is FHFA research, not Realtor.com news, a median sale price or an individual appraisal. |

## Requested sources awaiting exact rights/access

| Source | Implemented source state and remaining dependency |
| --- | --- |
| Mortgage News Daily | Its [RSS terms](https://www.mortgagenewsdaily.com/rss) require unchanged content and prohibit pages hidden from crawlers. Private-app ingestion and any AI use need an applicable written arrangement. It is listed but never fetched. |
| Bankrate editorial | [Terms](https://www.bankrate.com/terms/) restrict extraction and AI grounding. A permitted editorial delivery agreement/endpoint is absent. |
| Bankrate financial rates | [Developer portal](https://devportal.bankrate.com/) advertises financial-rate APIs; partner credentials, contract and usage scope are absent. A rates API is not editorial coverage. Separate source card. |
| Realtor.com research | [Data Library](https://www.realtor.com/research/data/) supplies geographic downloads and attribution guidance, while [general terms](https://www.realtor.com/terms-of-service/) restrict automated collection and AI use. The applicable app/AI rights require resolution before automated ingestion. |
| Realtor.com editorial | No permitted editorial contract/endpoint is configured. Corporate press releases, research, listings and lead APIs are distinct; no guessed RSS URL or scraper is used. |
| NEFAR reports | [Source rules](https://nefar.realtor/market-stats/) restrict commercial vendor/nonmember use. Membership and applicable app-use permission have not been established. |
| MBS Live | [Product documentation](https://www.mbslive.net/) describes a subscription service. App delivery/redistribution entitlement, endpoint and instrument specification are absent. No quote is invented or substituted with Treasury data. |

## Behavior and scope

First authenticated Feed visit returns cached data immediately and starts due public-source checks. Source cadence/cooldown and last-success/error are persisted; later checks run while the local app is running. Requests use fixed HTTPS endpoints, no redirects, 20-second deadlines, bounded response sizes, and no owner data, cookies or credentials. Source disablement prevents that owner's requested refreshes; the cache contains public material and can be shared across owners, while saves/preferences/ideas remain owner-scoped. Unknown users default to National. The installer may explicitly set Jeremy's preferences for the verified current owner.

Original publication time, observation period and fetch time are separate. Missing timestamps remain null. Geography uses national labels or explicit FHFA metro identifiers. An unsupported market retains its selection and receives an honest National fallback. Saved source IDs survive refresh. Source context sent to an assistant is a deliberate draft handoff, labeled untrusted reference data, and includes original URLs/dates; retrieval never calls a model automatically.

Ideas use deterministic local rules rather than claiming AI inference: saved interests, approved agent memory, canonical contacts/tracker items, open goals/Pipeline records, marketing items/cadence, and saved news. Each suggestion identifies its evidence and reason. Changed context updates suggested work; saved/dismissed/archived history persists. No contact, borrower activity or publication is fabricated. Goal/Tracking/Marketing conversion requires an explicit reviewed payload and records an idempotent owner/idea/destination receipt. Sending, publication and tracker completion are separate actions.

## Verification limits

The isolated suite covers source bounds/XML entity rejection, RSS and Atom, canonical deduplication, observation dates, partial failure/staleness, cooldown, geographic filtering, saved-owner isolation, context changes/dismissal, reviewed/idempotent conversions, mounted HTTP routes and restart persistence. It does not establish a commercial publisher license, Google/Apple authorization, real outreach, or deployed bots. Actual native UI acceptance and final installed version are recorded by the integration owner separately.
