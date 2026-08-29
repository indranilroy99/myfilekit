# MyFileKit — Commercial Assessment

An honest read of whether this is sellable, what it can charge for, and what it is missing.
Written against the repository as it stands (v4.1.0, 105 tools, MIT-licensed, public).

---

## 0. Two facts that constrain everything

Any monetization plan that ignores these will not survive contact with reality.

**The code is MIT-licensed and public.** Anyone may fork it, rebrand it, and sell it, with no obligation beyond keeping the copyright notice. Relicensing changes nothing about the code already published. So the product cannot be defended by *features* — every feature is copyable in an afternoon.

**Local-first means there is no server, and therefore no enforcement.** There is no account, no license check, no metering. Every gate shipped inside a 100%-client-side bundle is bypassable by opening devtools. A "Pro tier" that unlocks a feature flag in JavaScript is theatre.

The consequence is not "this can't be sold." It is: **you cannot sell the software. You sell what a fork cannot copy and a devtools console cannot bypass.**

---

## 1. Value proposition — where the real wedge is

The hook is not "free PDF tools." It is one sentence:

> **The file never leaves the machine.**

Smallpdf, iLovePDF, and Adobe's web tools all upload. Their own copy says so — Sejda: *"Files stay private. Automatically deleted after 2 hours."* Adobe: *"Your file will be securely handled by Adobe servers."* Both are asking for trust. MyFileKit does not have to ask, because there is no server to trust: `connect-src 'self'`, verified by an automated test, with zero external egress.

For most consumers this is a nice-to-have. For four groups it is a procurement requirement:

| Segment | Why upload is disqualifying |
|---|---|
| Law firms | Client confidentiality; privilege concerns over third-party custody |
| Finance / audit | Material non-public information cannot transit an unapproved processor |
| Healthcare | PHI leaving the boundary is a reportable event |
| Security / defence / gov | Air-gapped or egress-controlled networks; no SaaS allowed at all |

That is the wedge. **The product is not "a PDF toolkit." It is "the PDF toolkit you are allowed to use."**

The security tools sharpen it further: Sanitize PDF (strips active content), PDF Analyser (triage a suspicious file without opening it), Auto-Redact PII, digital signature verification. No cloud converter offers these, because their users are not thinking about threat models. Ours are.

**Positioning:** lead with the constraint, not the feature count. "105 tools" is a commodity claim. "Runs where the cloud isn't allowed" is not.

---

## 2. Monetization — what can actually be charged for

Ranked by defensibility, not by ease.

### Tier 1 — Distribution (the strongest play)
A signed, notarized **desktop build** (Electron/Tauri wrapping the same code) with auto-update. This is what Sejda already monetizes: their web tool is free, "Sejda Desktop" is the paid product, and the pitch is literally *"the files never leave your computer"* — the exact claim we make natively in the browser.

What the customer pays for is not the code (MIT, forkable) but: a binary they can trust and deploy, code-signing, update infrastructure, and the fact that IT can approve one installer instead of a website.

### Tier 2 — Enterprise deployment
MSI/PKG packaging, MDM/Intune/Jamf profiles, offline/air-gapped installer, group policy for the optional features, an SBOM, and a signed attestation of the "no egress" claim. Regulated buyers pay for the paperwork as much as the software. A fork cannot hand them a signed SBOM and an indemnity.

### Tier 3 — The parts that genuinely need a server
These are already scoped in the repo as opt-in and off by default, which makes them the natural paid boundary because they are *inherently* hosted:
- **Multi-party e-signature** (`reference-backend/`, `docs/TIER3-OPTIONAL-BACKEND.md`) — routing an envelope between signers requires a server. Charge per envelope or per seat.
- **RFC-3161 timestamping** — a trusted timestamp requires a trusted third party by definition.
- Team template/preset sync.

This is the cleanest revenue: the customer cannot self-host it for free without running the infrastructure themselves, and the value metric is naturally metered.

### Tier 4 — Assurance
Support with an SLA, indemnification, and **certification we currently cannot self-claim**: the repo is honest that PDF/A output is "hardened toward PDF/A-2b, not veraPDF-certified" and accessibility is "not certified PDF/UA." Paying for a validated, certified pipeline (run veraPDF server-side, return a conformance certificate) turns an honest limitation into a product.

### What to charge on — the value metric
- **Seats** for desktop/enterprise. Predictable, matches how IT buys.
- **Per envelope** for e-sign. Matches cost and value.
- **Not** per-file or per-batch limits in the browser build. Unenforceable, and it would poison the free tier that generates the trust the paid tiers rely on.

### Will people pay?
Consumers: mostly no — the market price for "merge a PDF" is zero. **Do not build a consumer funnel.**
Regulated professionals: yes, and at a much higher price point than Smallpdf's ~$12/mo, because the alternative is not a cheaper converter — it is "we are not permitted to use any of these."

---

## 3. Gaps versus Adobe Acrobat

Honest inventory. We are strong on privacy-adjacent utilities and weak on document *authoring*.

**Critical, blocks daily-driver adoption**
1. **True in-place editing fidelity.** Our Edit PDF Text and Reflow Editor are documented as block-level and single-column-text-only. Acrobat reflows real layout with original fonts. This is the single biggest functional gap.
2. **Comment and review workflow.** Acrobat's shared review — threaded comments, statuses, reply — is why teams keep it. We have annotation, not collaboration.
3. **Forms.** We can fill and create basic forms; Acrobat does calculations, validation, JavaScript-free logic, and enterprise form data collection.
4. **OCR quality.** Tesseract is respectable, but Acrobat's OCR is materially better on poor scans, which is exactly the case that matters.

**Important, blocks enterprise procurement**
5. **Certified output.** PDF/A validity and PDF/UA conformance are self-checked, explicitly not certified. Legal/gov archiving requires the certificate, not the effort.
6. **Integrations.** SharePoint, Google Drive, DMS connectors. Deliberately out of scope so far — and defensible, given the privacy story — but it is a real procurement checkbox.
7. **Mobile / desktop apps.** Also deliberately out of scope. Sejda charges for exactly this.

**Nice to have**
8. Redaction *certification* (proof the content is gone, not just covered) for legal discovery.
9. Bates numbering with legal-grade audit output.
10. Accessibility remediation that a human can review and sign off in-app.

---

## 4. Prioritized plan

**Step 1 — Make the privacy claim provable and loud (weeks, not months).**
Right now the claim lives in a footer line. It should be the product's spine: a visible "no network activity" indicator, a one-click self-audit ("open devtools, watch the network tab — nothing"), a published third-party review of the CSP and egress posture, and an SBOM. *Rationale: the wedge is trust; trust must be demonstrable, not asserted. This costs little and is the precondition for every paid tier.*

**Step 2 — Ship the signed desktop build and the enterprise packaging.**
Same codebase, wrapped, signed, notarized, auto-updating, with MSI/MDM artefacts and an offline installer. *Rationale: this is the first thing that is actually sellable — it is not copyable by a fork (they lack the signing identity and the update infrastructure), and it is what the target segments already buy from Sejda. It converts the MIT problem into a non-problem.*

**Step 3 — Close the editing gap, or explicitly refuse to.**
Either invest seriously in layout-preserving editing (large, hard, the main reason people keep Acrobat), or reposition away from "Acrobat replacement" toward **"the secure document workbench you run beside Acrobat."** *Rationale: half-competing on editing is the worst option — it invites the comparison we lose. Pick one. Given the codebase's real strengths (sanitize, analyse, redact, sign, verify, PDF/A, accessibility), the second framing is more honest and probably more valuable: nobody else is selling it.*

---

## 5. The uncomfortable summary

- As a **free open-source utility suite**, this is already strong and unusually well-engineered for the category (306 tests, zero dependency vulnerabilities, strict CSP, no telemetry).
- As a **product to sell today**, it is not there — not because of quality, but because MIT + client-only leaves nothing to charge for. Fix the *business* architecture, not the code.
- The fastest path from "excellent project" to "revenue" is **distribution and assurance**, not more tools. Tool 106 adds nothing a fork cannot copy by dinner.
