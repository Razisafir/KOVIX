LEGAL RISK ASSESSMENT: Construct AI Agent
==========================================

Prepared by: Legal Risk Analysis (Automated)
Date: 2026-01-20
Scope: Full codebase review — license conflicts, GDPR compliance, copyright,
       third-party attribution, API key exposure, data residency, user consent

OVERALL RISK SCORE: 68/100 (MEDIUM-HIGH)

┌─────────────────────────────────────────────────────────────────────────────┐
│ SUMMARY                                                                     │
│                                                                             │
│ • No GPL/AGPL/copyleft license conflicts detected in direct dependencies   │
│ • Significant GDPR compliance gaps — no privacy policy, no data deletion   │
│   mechanism, no explicit user consent for data collection                   │
│ • ALL source files lack copyright headers — copyright notice deficiency    │
│ • Third-party attribution incomplete — missing ~10 dependencies            │
│ • API key handling is generally secure (env vars, headers)                 │
│ • Proprietary license is legally weak — missing key protective clauses     │
│ • Screen recording consent mechanism is well implemented                   │
│ • All user data stored locally (good for data residency)                   │
└─────────────────────────────────────────────────────────────────────────────┘

===============================================================================
1. LICENSE CONFLICTS
===============================================================================

[PASS] No GPL/AGPL/copyleft conflicts found in direct dependencies.

All reviewed dependencies use permissive licenses compatible with proprietary
software:

  JavaScript/TypeScript (package.json):
    react@18.3.1              MIT        ✓
    react-dom@18.3.1          MIT        ✓
    react-router-dom@7.15.1   MIT        ✓
    zustand@5.0.14            MIT        ✓
    framer-motion@11.18.2     MIT        ✓
    lucide-react@0.460.0      ISC        ✓
    monaco-editor@0.52.2      MIT        ✓
    @monaco-editor/react@4.7.0 MIT      ✓
    tailwindcss@3.4.19        MIT        ✓
    @tauri-apps/api@2.11.0    Apache-2.0/MIT  ✓
    @tauri-apps/plugin-*      MIT/Apache-2.0  ✓
    vite@6.4.2                MIT        ✓
    typescript@5.9.3          Apache-2.0 ✓

  Rust (Cargo.toml):
    tauri@2                   Apache-2.0/MIT  ✓
    rusqlite@0.32             MIT        ✓
    serde@1                   MIT/Apache-2.0  ✓
    parking_lot@0.12          Apache-2.0/MIT  ✓
    chrono@0.4                MIT/Apache-2.0  ✓
    uuid@1.11                 Apache-2.0/MIT  ✓
    dirs@5.0                  MIT/Apache-2.0  ✓

  Python (requirements.txt):
    chromadb>=0.5.0           Apache-2.0 ✓
    sentence-transformers>=3.0.0 Apache-2.0 ✓
    fastapi>=0.115.0          MIT        ✓
    uvicorn>=0.32.0           BSD-3-Clause  ✓
    pydantic>=2.9.0           MIT        ✓
    openai>=1.55.0            Apache-2.0 ✓
    anthropic>=0.40.0         MIT        ✓
    google-generativeai>=0.8.0 Apache-2.0 ✓
    aiohttp>=3.11.0           Apache-2.0 ✓
    psutil>=6.0.0             BSD-3-Clause  ✓
    schedule>=1.2.0           MIT        ✓
    python-dotenv>=1.0.0      BSD-3-Clause  ✓
    astor>=0.8.1              BSD-3-Clause  ✓

[MEDIUM] Transitive dependency risk: sentence-transformers → torch
  Description: sentence-transformers depends on PyTorch (torch). While PyTorch
  itself uses a BSD-style license, its transitive dependency chain includes
  components with various licenses. A full transitive dependency audit has
  not been performed. Recommended before distribution.
  Affected: requirements.txt

[MEDIUM] framer-motion license not listed in THIRD_PARTY_LICENSES.md
  Description: framer-motion@11.18.2 is a runtime dependency but is absent
  from the third-party attribution file.
  Affected: THIRD_PARTY_LICENSES.md

===============================================================================
2. GDPR / DATA PROTECTION COMPLIANCE
===============================================================================

[CRITICAL] No privacy policy or data processing notice
  Description: The application collects and stores user conversations, code
  changes (with diffs), user preferences, and project state persistently.
  However, there is no privacy policy, no data processing notice, and no
  GDPR Article 13/14 information provision. Users are not informed about
  what data is collected, why, or their rights.
  Affected: OnboardingModal.tsx, onboarding.html, entire application
  GDPR Basis: Art. 13, Art. 14 — Information to be provided

[CRITICAL] No explicit consent for data collection in onboarding
  Description: The onboarding flow (OnboardingModal.tsx, onboarding.html)
  collects project path, goal, LLM provider choice, and theme preference.
  It does NOT include any step for the user to consent to data collection,
  storage of conversations, or processing by cloud LLM providers. There is
  no checkbox for Terms of Service, Privacy Policy, or data processing consent.
  Affected: src/renderer/components/OnboardingModal.tsx, demo/onboarding.html
  GDPR Basis: Art. 6(1)(a) — Consent as legal basis

[HIGH] No data deletion / "right to be forgotten" mechanism
  Description: The SQLite database stores conversations, code events, and
  user preferences indefinitely. There is no UI feature, API endpoint, or
  documented procedure for users to delete their data. The vacuum_db()
  function only performs SQLite maintenance; it does not erase user data.
  Affected: src/main/src/db.rs, agent-backend/
  GDPR Basis: Art. 17 — Right to erasure

[HIGH] No data export / portability mechanism
  Description: Users cannot export or download their stored data
  (conversations, memories, preferences). GDPR Article 20 guarantees the
  right to data portability.
  Affected: src/main/src/db.rs
  GDPR Basis: Art. 20 — Right to data portability

[HIGH] User conversations transmitted to cloud LLM providers without
       explicit subprocessor disclosure
  Description: When using OpenAI, Anthropic, or Google providers, all user
  conversations (which may contain personal data, proprietary code, and
  business secrets) are transmitted to third-party AI services. The
  onboarding UI mentions "API key required" but does NOT disclose that:
  (a) all conversation content will be sent to the provider's servers;
  (b) the provider's terms of service and privacy policy apply;
  (c) data may be processed outside the user's jurisdiction.
  Affected: src/renderer/components/OnboardingModal.tsx, agent-backend/core/llm_service.py
  GDPR Basis: Art. 28 — Processors; Art. 46 — Transfers to third countries

[MEDIUM] Data stored locally without encryption at rest
  Description: The SQLite database (~/.local/share/construct/construct.db)
  stores all conversation history, code diffs, and preferences in plaintext.
  No encryption at rest is implemented. If the user's machine is compromised,
  all historical data is exposed.
  Affected: src/main/src/db.rs
  Note: Local-only storage is positive for data residency (Art. 44).

[LOW] anonymized_telemetry flag exists but telemetry implications unclear
  Description: agent-backend/memory/semantic.py line 122 references
  anonymized_telemetry=False but the scope and nature of any telemetry
  is not documented.
  Affected: agent-backend/memory/semantic.py

===============================================================================
3. COPYRIGHT
===============================================================================

[HIGH] ALL source files lack copyright headers
  Description: A comprehensive review of 50+ source files across Rust (.rs),
  TypeScript (.ts/.tsx), and Python (.py) found ZERO files with copyright
  notices or license headers. Every file examined had either no header,
  a plain docstring, or only a module description comment. This severely
  weakens copyright enforcement capability in infringement litigation.
  Affected files (representative sample):
    - src/main/src/db.rs            (docstring only, no copyright)
    - src/main/src/lib.rs           (no header)
    - src/main/src/main.rs          (no header)
    - src/renderer/App.tsx          (no header)
    - src/renderer/main.tsx         (no header)
    - agent-backend/core/llm_service.py  (docstring only, no copyright)
    - agent-backend/app.py          (docstring only, no copyright)
    - agent-backend/security/agentshield.py (docstring only, no copyright)
    - agent-backend/screen/screen_controller.py (docstring only, no copyright)
  Recommended header format:
    /*
     * Copyright (c) 2026 Construct AI. All Rights Reserved.
     * This file is proprietary and confidential.
     * Unauthorized copying, distribution, or use is strictly prohibited.
     * See LICENSE for full terms.
     */

[MEDIUM] Proprietary license lacks standard protective clauses
  Description: The LICENSE file is unusually minimal for proprietary software.
  Missing standard provisions:
    - No warranty disclaimer ("AS IS" basis)
    - No limitation of liability clause
    - No governing law / jurisdiction clause
    - No termination conditions
    - No audit rights
    - No escrow provisions
    - No indemnification clause
  Affected: LICENSE
  Risk: In a dispute, the licensor has reduced legal protection.

[LOW] Copyright year "2026" may be future-dated
  Description: LICENSE and README.md state "Copyright (c) 2026". If the
  software is being used before the year 2026, this could create ambiguity
  about when the copyright term begins. Best practice: use the year of first
  publication or a range (e.g., 2025-2026).
  Affected: LICENSE, README.md

===============================================================================
4. THIRD-PARTY ATTRIBUTION
===============================================================================

[HIGH] THIRD_PARTY_LICENSES.md is incomplete — missing ~10 dependencies
  Description: The attribution file lists 19 packages, but the project has
  approximately 29+ direct dependencies. Missing entries include:
    - framer-motion (MIT) — runtime JS dependency
    - react-dom (MIT) — runtime JS dependency
    - @monaco-editor/react (MIT) — wrapper for Monaco
    - autoprefixer (MIT) — build tool
    - postcss (MIT) — build tool
    - @vitejs/plugin-react (MIT) — build tool
    - aiohttp (Apache-2.0) — Python HTTP client
    - python-dotenv (BSD-3-Clause) — Python config
    - astor (BSD-3-Clause) — Python AST
    - psutil (BSD-3-Clause) — Python system monitoring
    - schedule (MIT) — Python task scheduling
    - chrono (MIT/Apache-2.0) — Rust datetime library
    - serde + serde_json (MIT/Apache-2.0) — Rust serialization
    - dirs (MIT/Apache-2.0) — Rust directory utilities
  Affected: THIRD_PARTY_LICENSES.md

[MEDIUM] Third-party license texts not included
  Description: THIRD_PARTY_LICENSES.md states "Full license texts available
  upon request: legal@construct.ai". Best practice for desktop software
  distribution is to include full license texts inline or in a separate
  notices file, as some licenses (MIT, BSD, ISC) require the copyright
  notice to be distributed with the software.
  Affected: THIRD_PARTY_LICENSES.md
  License requirements: MIT § "The above copyright notice...shall be
  included in all copies or substantial portions"

[LOW] Monaco Editor loaded from CDN may have separate terms
  Description: README.md states "Monaco Editor — Full-featured code editor
  loaded from CDN". Loading from a CDN may involve separate terms of service
  and privacy implications not addressed in attribution.
  Affected: README.md

===============================================================================
5. SECURITY / API KEY EXPOSURE
===============================================================================

[PASS] API keys loaded from environment variables — secure pattern.
  Location: agent-backend/core/llm_service.py, lines 252-305
  API keys read via os.getenv() for OPENAI_API_KEY, ANTHROPIC_API_KEY,
  GOOGLE_API_KEY. No hardcoded keys in source code.

[PASS] Google API key sent via header, not URL parameter.
  Location: agent-backend/core/llm_service.py, lines 907-911, 1009-1011
  Comment explicitly notes: "SECURITY: API key is sent via x-goog-api-key
  header instead of URL query parameter to prevent logging by proxies."

[PASS] LLM call history stores metadata only (provider, model, timing,
  token counts), NOT conversation content.
  Location: agent-backend/core/llm_service.py, lines 1194-1204
  The _log_call() method appends LLMCallLog objects which contain only
  timing and token metadata. The actual message content is not logged.

[LOW] API error responses may leak sensitive data in logs
  Description: In the Google provider implementations, API error responses
  are included in exception messages (text[:500]). If an error response
  contains sensitive data or the API key is reflected, it could be logged.
  Additionally, the error is logged at WARNING level in the complete()
  method, which may include the full exception message in log files.
  Affected:
    - agent-backend/core/llm_service.py:530-533 (fallback error logging)
    - agent-backend/core/llm_service.py:612-624 (streaming fallback logging)
    - agent-backend/core/llm_service.py:938-940 (Google error text)

[LOW] .env.example contains placeholder API keys that may trigger secret
  scanners and could be mistaken for real keys if copied without change.
  Affected: .env.example lines 38, 44
  Placeholders: sk-placeholder-replace-me, sk-ant-placeholder-replace-me
  Risk: Accidental commit of unmodified .env.example; false positives in
  security scanning tools.

[LOW] SQLite database stores conversation content in plaintext
  Description: The conversations table stores full message content without
  encryption. If the user's device is compromised, all historical conversation
  data is accessible. This is particularly concerning as conversations may
  contain proprietary source code, API keys, passwords, or business secrets.
  Affected: src/main/src/db.rs

===============================================================================
6. DATA RESIDENCY
===============================================================================

[PASS] All structured data stored locally on user's device.
  SQLite location: ~/.local/share/construct/construct.db (Linux)
                   ~/Library/Application Support/construct/construct.db (macOS)
                   %APPDATA%\construct\construct.db (Windows)
  ChromaDB location: ./resources/memory/vector (configurable)
  No cloud database or remote data storage for user data.

[WARNING] LLM provider data transfer
  When using cloud providers (OpenAI, Anthropic, Google), all conversation
  content is transmitted to the respective provider's servers. Data residency
  depends on the provider's infrastructure. No Data Processing Agreement (DPA)
  or Standard Contractual Clauses (SCCs) are referenced.
  Affected: agent-backend/core/llm_service.py
  GDPR: Art. 44-49 (Transfers of personal data to third countries)

===============================================================================
7. USER CONSENT
===============================================================================

[CRITICAL] Onboarding lacks any consent or Terms of Service acceptance
  Description: The 5-step onboarding flow (project, goal, LLM provider,
  theme, ready) has NO step for privacy policy acceptance, terms of service
  agreement, or data collection consent. Users begin using the application
  without being informed of data practices or agreeing to terms.
  Affected:
    - src/renderer/components/OnboardingModal.tsx (React component)
    - demo/onboarding.html (static mockup)

[PASS] Screen recording has explicit, granular consent mechanism
  Description: ScreenController implements a proper consent API with:
    - request_consent() — requests consent (does not auto-grant)
    - grant_consent() — explicit user action to grant
    - revoke_consent() — user can withdraw consent
    - _ensure_consent() — raises ConsentRequiredError if not granted
    - consentRequired toggle in UI (ScreenControl.tsx)
  This pattern should be replicated for other data processing activities.
  Affected:
    - agent-backend/screen/screen_controller.py:218-256
    - src/renderer/components/ScreenControl.tsx:124, 264-289

[MEDIUM] localStorage used without storage consent notice
  Description: OnboardingModal.tsx stores user preferences in localStorage
  (theme, LLM provider, project path, goal). Under EU cookie/localStorage
  laws (ePrivacy Directive), consent may be required for non-essential
  localStorage usage.
  Affected: src/renderer/components/OnboardingModal.tsx:47-51

===============================================================================
8. PATENT / IP RISKS
===============================================================================

[LOW] AI-generated code ownership claim
  Description: LEGAL.md and CONTRIBUTORS.md assert that "AI-generated code
  does not constitute a legal 'author' under copyright law" and that all
  AI outputs are "owned by the human operator." While this position is
  defensible under current US copyright practice (as of 2024-2025), it is
  an evolving legal area. Some jurisdictions may recognize different authorship
  standards. Consider adding explicit contractual assignment language in
  contributor agreements.
  Affected: LEGAL.md, CONTRIBUTORS.md

[LOW] "AgentShield inspired by ECC's AgentShield" — potential naming
  Description: agent-backend/security/agentshield.py is described as
  "Security scanning inspired by ECC's AgentShield." If "AgentShield"
  is a trademarked product of ECC, there could be trademark confusion
  or dilution risk. The name "AgentShield" for the internal class may
  imply affiliation.
  Affected: agent-backend/security/agentshield.py

===============================================================================
RECOMMENDATIONS
===============================================================================

Priority: CRITICAL (address before any public release)
─────────────────────────────────────────────────────────────────────────────
1. Add a Privacy Policy and make it available in the onboarding flow.
   Include: what data is collected, why, retention period, user rights,
   subprocessor list (OpenAI, Anthropic, Google), contact info for DPO.

2. Add an explicit consent step to the onboarding flow requiring users to
   agree to the Privacy Policy and Terms of Service before using the app.
   Use an opt-in checkbox (not pre-checked) for GDPR compliance.

3. Implement a "Delete All Data" / "Right to be Forgotten" feature.
   Add a UI control (e.g., in Settings) that wipes the SQLite database
   and ChromaDB collections, with confirmation dialog.

Priority: HIGH (address within 30 days)
─────────────────────────────────────────────────────────────────────────────
4. Add copyright headers to ALL source files. Recommended format:
   /* Copyright (c) 2026 Construct AI. All Rights Reserved. */
   Automate via a pre-commit hook or lint rule.

5. Strengthen the proprietary LICENSE file with standard clauses:
   - Warranty disclaimer (AS IS)
   - Limitation of liability
   - Governing law and jurisdiction
   - Termination conditions
   - Indemnification

6. Complete THIRD_PARTY_LICENSES.md — add all missing dependencies and
   include full license texts (not just "available upon request").

7. Add a data export feature so users can download their stored data
   in a machine-readable format (e.g., JSON export of conversations).

8. In the LLM provider selection step, add explicit disclosure that
   conversation content will be sent to the selected provider's servers
   and link to the provider's privacy policy.

Priority: MEDIUM (address within 60 days)
─────────────────────────────────────────────────────────────────────────────
9. Implement SQLite encryption at rest (e.g., SQLCipher) for the
   conversations database to protect sensitive user data.

10. Add API key masking in logs — ensure that even error responses from
    LLM providers cannot leak API keys or conversation content.

11. Update .env.example placeholders to clearly non-real formats that
    won't trigger secret scanners (e.g., use YOUR_KEY_HERE instead of
    sk-placeholder-replace-me).

12. Add a data retention policy — auto-delete conversations older than
    a configurable period (e.g., 90 days default).

13. Consider trademark review of "AgentShield" class name to avoid
    confusion with ECC's product.

Priority: LOW (address when convenient)
─────────────────────────────────────────────────────────────────────────────
14. Update copyright year from "2026" to "2025-2026" or current year.

15. Add a CONTRIBUTING.md with clear CLA (Contributor License Agreement)
    requirements for external contributors.

16. Document the localStorage usage and add an ePrivacy consent notice
    for EU users.

17. Perform a full transitive dependency audit using a tool like
    `license-checker` (npm) + `cargo-license` + `pip-licenses` to ensure
    no GPL/AGPL exists anywhere in the dependency tree.

===============================================================================
APPENDIX: Risk Scoring Methodology
===============================================================================

Score: 68/100 (MEDIUM-HIGH)

Breakdown:
  License Conflicts:        90/100 (excellent — no copyleft conflicts)
  GDPR Compliance:          35/100 (critical gaps in consent, deletion, notices)
  Copyright:                40/100 (no headers, weak license)
  Third-Party Attribution:  55/100 (incomplete, missing texts)
  Security/Exposure:        75/100 (good key handling, minor log risks)
  Data Residency:           85/100 (local-only storage, LLM cloud transfer)
  User Consent:             45/100 (screen consent good, overall consent poor)

===============================================================================
END OF REPORT
===============================================================================
