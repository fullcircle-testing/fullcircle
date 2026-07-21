---
name: fullcircle-external-communications-inventory
description: Inventory app external communications for FullCircle e2e testing. Use when adding or reviewing e2e tests, integrating third-party SDKs/APIs/OAuth/webhooks, scanning imports/direct URLs/fetch clients, adding injectable seams, or deciding what provider sessions and fixtures must be recorded before browser assertions.
---

# FullCircle External Communications Inventory

## Rule

Treat every third-party boundary as a FullCircle session candidate before writing browser assertions. Do not let e2e tests depend on live providers unless the test is explicitly marked as an optional real-provider smoke test.

## Workflow

1. **Inventory boundaries first.** Run the scanner, then manually inspect likely service code:
   ```bash
   python3 skills/fullcircle-external-communications-inventory/scripts/inventory_external_communications.py <app-root> --out fullcircle-external-inventory.md
   ```
   Also search for direct clients not caught by the scanner: `fetch(`, `axios`, `new Stripe`, `OAuth`, `webhook`, `process.env`, and provider domains.
2. **Classify each boundary.** Use `references/provider-patterns.md` for the classification checklist. Mark each item as:
   - typed FullCircle provider;
   - generic session replay fixture;
   - local injectable fake/seam;
   - sink/disable in e2e;
   - optional real-provider smoke only.
3. **Add seams before tests.** If production code imports an SDK/client directly, introduce a small app-owned adapter or config seam so tests can point the provider base URL, webhook target, OAuth issuer, or storage endpoint at FullCircle.
4. **Record or author sessions.** For each provider, create/commit a `session.fullcircle.json` or typed provider fixture. Include redaction rules for auth, cookies, tokens, API keys, and PII.
5. **Write e2e assertions last.** Start FullCircle, install provider fixtures/replay sessions, seed/snapshot DB state, drive the browser, deliver webhooks if needed, then assert UI + DB diff + request diagnostics.

## Acceptance checklist

Before calling an e2e test complete:

- Every external SDK/API/OAuth/webhook/storage/analytics boundary appears in the inventory.
- Each non-sink boundary has an explicit FullCircle strategy and owner file.
- External provider calls are controlled by the test, not by sandbox account state.
- OAuth login used for ordinary auth is handled by app auth helpers when possible; reserve mock OAuth providers for flows that are truly under test.
- Webhooks are delivered by FullCircle fixtures with valid/invalid/missing signature cases as relevant.
- DB snapshots/diffs capture important rows inserted, updated, or deleted by the journey.
- The test is deterministic in CI and does not require live third-party credentials unless labeled optional smoke.
