<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Autonomous development contract

This repo is developed by both humans and coding agents. Any agent or harness
working here reads this section first and obeys it. It states repo facts, not
process doctrine — your harness supplies the process.

Machine-readable companion: `.agents/gate.json` (same commands, parseable).

### Shared agent memory

- **Read** root `MEMORY.md` at session start before mutating work.
- **Dual-write:** durable lessons go in `MEMORY.md`, not only in a local
  runtime store.
- **No CI loop for pure memory commits:** if a commit touches **only**
  `MEMORY.md` (or `memory/**`), do **not** run typecheck/lint/test/build and do
  **not** wait on product CI or review gates. Mixed memory + product code uses
  the normal green gate.
- **Append-only** by default; rebase/pull immediately before writing; on conflict
  in dated sections keep both sides. No secrets in memory files.

### Gate commands (the definition of "green" here)
```bash
npx next typegen   # generates PageProps/LayoutProps globals; tsc fails without it
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```
All of these must pass before any **product** commit, with **zero new failures versus the
branch point**. Pre-existing failures are recorded, not inherited and not hidden.
Pure memory-only commits are exempt (see Shared agent memory above).

CI enforces this in `.github/workflows/gibson-gate.yml` (job `gate`), plus
`test-integrity` (test count/skip ratchet graded by the merge-base copy of
`scripts/test-integrity.mjs`), `review-evidence` and `tier-c-gate`.

### Ground rules for machine contributors
1. **Never mutate the shared checkout.** One task = one branch = one git
   worktree of your own.
2. **Claim before you touch.** One `- Active-work claim: <slug>` line in an
   open PR body plus the `agent-claimed` label. Overlapping claim ⇒ stop and
   coordinate, never race.
3. **Never review or approve your own work.** An independent reviewer — a
   different vendor — inspects the exact committed head, read-only. Commits made
   under the owner's GitHub identity carry an `Agent-Vendor: <grok|codex|claude|devin>`
   trailer so `review-evidence` can tell who wrote them.
4. **Acceptance criteria are the contract**, verified by a sensor (test, script,
   check), never by assertion.
5. **Report failures verbatim.** Never mark done what you did not verify.
6. **Clean up:** remove the worktree, delete the branch, release the claim.

### Hot files (single claimant, own PR)
| File | Rule |
|---|---|
| package.json / package-lock.json | no casual deps; own commit |
| next.config.ts | security boundary (headers, flags) — Tier C |
| .github/workflows/**, scripts/**, config/**, .agents/** | gate machinery — Tier C, never weaken to get green |
| MEMORY.md | append-only lessons; pure updates skip CI |

### Framework warnings
- Next.js 16.4 with `cacheComponents` and `partialPrefetching` on. This is NOT
  the Next.js in your training data — read `node_modules/next/dist/docs/`
  before writing routes, caching, or data fetching (see the block above).
- `middleware.ts` is `proxy.ts` in this version.
- `LayoutProps`/`PageProps` are generated globals: run `npx next typegen`
  before `tsc` on a clean checkout.

### Deployment truth (verified 2026-10-31)
- Host/project: none connected yet.
- Production branch: none. Merge to `main` deploys nothing today.
- Preview deployments: off.
Update this section (with the date) the day a host is connected.

### Stop and ask a human for
Enforced by `.github/workflows/risk-classifier.yml`: matching PRs get `tier-c`
+ `risk:<category>` labels, and `tier-c-gate` stays red until the owner applies
`tier-c-approved` to the current head.
- Money: pricing, quote totals, checkout, payments, invoices (`**/pricing*`,
  `**/checkout/**`, payment SDKs)
- Auth and authorization boundaries: `proxy.ts`, `**/auth/**`, `**/login/**`,
  session/cookie writes
- PII / consent: contact/quote-request forms collecting email/phone/address,
  analytics and tracking scripts
- Security boundaries: `next.config.ts`, route handlers (`**/route.ts`), server
  actions (`"use server"`), CI workflows, gate scripts, `.env*`
- Destructive or irreversible data and schema operations: any database, schema,
  migration, or seed file (none exist yet)
- Secret values, public launches, legal commitments

### Commit and PR conventions
- Branch per task: `<type>/<slug>`; conventional-commit subjects.
- Agents never merge. A human merges after `gate`, `test-integrity`,
  `review-evidence` and `tier-c-gate` are green.
- Owner-attested cross-vendor review (for reviewers with no GitHub App here) is
  a PR comment by the owner:
  ```
  <!-- owner-attested-review:v1
  head-sha: <full head sha>
  reviewer-vendor: <grok|codex|claude|devin|human>
  result: pass
  -->
  ```
- Kill switch: an open issue labelled `gibson-halt` stops the fleet **only**
  where the loop runs with `gh` installed and authenticated. Otherwise create
  the `gibson/HALT` file in the Gibson state directory, or set `GIBSON_HALT=1`.
