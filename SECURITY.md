# Security and privacy

AxonCROS is a local, single-Mac owner workspace. Run the server only on loopback;
do not put the local API behind a public tunnel or reverse proxy. Local profile
and conversation separation is not a hosted multi-tenant security boundary.

The native app supplies a one-use launch token to its loopback server and uses
an HttpOnly session cookie. Mutation routes enforce origin and ownership. Store
configuration and data in the private application-support directory. Backups
contain private configuration/data and must stay private too. Never put keys,
OAuth credentials, cookies, user exports, contact files or borrower records in
issues, logs, screenshots, archives or Git history.

External access is explicit: a connector catalogue entry is not authorization.
Read/write scopes, account identity, review, revocation and failure recovery must
be tested for each provider. The local model endpoint is a user-operated service;
do not expose it to the network. Model output and imported/retrieved text are
untrusted. Local drafts do not authorize sending, publication or borrower use.

For a suspected vulnerability, contact the repository maintainer through an
existing private channel. If the public repository enables GitHub private
vulnerability reporting, use its Security → Report a vulnerability control.
Do not file a public issue containing a working exploit against a private
installation, credentials or personal data. A dedicated reporting address and
response SLA have not yet been established; do not invent one.

Before a public release, run the offline regression suite, dependency audit,
sanitized archive test and clean extraction build. Review binary artwork and
Git history separately if ever publishing more than the sanitized source
archive. No automated scanner is proof that a repository contains no private
information. Source packages omit private history by construction.

The current dependency override pins ExcelJS's `uuid` to patched version11.1.1.
It retains the CommonJS `v4` API used by ExcelJS. Do not apply a major ExcelJS
downgrade merely to silence an audit; keep the XLSX regression and lockfile check.

Developer ID signing/notarization and hosted borrower-system security are
separate release gates. Local ad-hoc signing is not a trusted public binary
distribution claim. Existing main Hermes installations are outside this app's
ownership and must not be modified by setup or tests.
