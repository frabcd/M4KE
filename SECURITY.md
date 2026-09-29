# Security policy

## Scope and support

M4KE is a pre-release, local-first research prototype. Only the current reviewed
source candidate is maintained; no production support window or response-time
guarantee is declared. Passing automated checks does not establish security,
electrical safety, manufacturing suitability, or child-safety certification.

## Reporting a vulnerability

Do not post credentials, private model data, device addresses, user projects, or
working exploit details in a public issue. No dedicated public security mailbox
has been established for this local review candidate.

Contact the project maintainer through an existing private team channel first.
If the eventual published repository enables private vulnerability reporting,
use that channel. Otherwise ask for a private reporting contact without disclosing
the sensitive details publicly. Include the affected version, minimal reproduction,
impact, and redacted logs. Do not test other people's systems to demonstrate a bug.

## Deployment boundaries

- The application and inference endpoints are intended for loopback use on a
  trusted host. This is not a hardened multi-tenant service. Do not expose its API
  directly to the internet; a home browser should use a separately secured,
  authenticated connection managed by the operator.
- Model output and imported metadata are untrusted data. Qwen supplies bounded
  structured requests, not arbitrary code. Verification status belongs to host
  checks and cannot be overridden by model prose.
- Native CAD and optional slicer tools run with the application user's rights.
  Input restrictions and timeouts are not a complete operating-system sandbox.
  Use a dedicated, least-privileged account and reviewed local dependencies.
- Preserve source hashes, path restrictions, exact component identities and
  evidence lineage. Never silently rescale a supplier model or replace an absent
  asset with an unverified one.
- Printer selection and read-only status do not authorize uploading, heating,
  movement or printing. Output-disabled firmware and diagnostic exports must not
  be treated as commissioned hardware.

## Sensitive data and dependencies

Keep `.env`, runtime `data/`, dependency caches, raw inference logs, deployment
configuration, pairing details and teammate assets out of source releases.
`.gitignore` only prevents accidental addition of untracked files; it neither
removes tracked secrets nor audits history. Review the allowlisted source archive
and its manifest before any publication. If a secret is exposed, revoke or rotate
it first, then coordinate removal of the affected copies.

Use locked dependencies and separately review model / CAD / supplier / slicer
licenses. The source package intentionally does not include all runtime assets.
Do not weaken verification or download arbitrary replacements to make an offline
installation appear successful.

## Physical safety is separate

The current car benchmark has unresolved failures. A rendered model, numerical
PASS or successful installation is not permission to manufacture or energize it.
Resolve documented critical failures and perform an appropriate supervised
commissioning process before physical use. This project makes no safety
certification claim.
