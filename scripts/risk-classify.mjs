#!/usr/bin/env node
/**
 * risk-classify.mjs — Law 7 Tier-C classifier for pull requests.
 *
 * WHAT IT DOES
 *   Classifies a PR's changed files (path + added lines) into the Law 7 risk
 *   categories: money, auth, pii, security, prod-data. Any hit makes the PR
 *   Tier C: it gets the `tier-c` label plus one `risk:<category>` label per
 *   hit, and the `tier-c-gate` commit status stays red until the repo owner
 *   applies `tier-c-approved` to the CURRENT head (the workflow strips that
 *   label on every push, so approval never carries over to new code).
 *
 * WHY
 *   An AGENTS.md "stop and ask a human" list is prose. This makes the human
 *   merge gate machine-checked, and over-matches on purpose: a false positive
 *   costs the owner one label; a false negative ships an unreviewed money or
 *   auth change.
 *
 * TRUST
 *   Runs from the default branch via pull_request_target and never checks out
 *   or executes PR code. File names and patches are hostile DATA, only matched
 *   against regexes here.
 *
 * USAGE
 *   node scripts/risk-classify.mjs --repo OWNER/REPO --pr N --owner LOGIN
 *        --event-action ACTION [--github-output FILE]
 *   node scripts/risk-classify.mjs --fixture files.json   # offline, prints JSON
 *   Needs GH_TOKEN (pull-requests/issues write, statuses write) for --repo mode.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CATEGORIES = ["money", "auth", "pii", "security", "prod-data"];

/** Path rules: any changed (or removed/renamed-from) path matching → category. */
export const PATH_RULES = {
  money: [/(^|\/)(pay(ment)?s?|billing|checkout|invoices?|pricing|prices?|subscriptions?|refunds?|stripe|cart|orders?)(\/|\.|-|_|$)/i],
  auth: [
    /(^|\/)(auth|login|logout|signin|sign-in|signup|sign-up|session|sessions|permissions?|rbac|acl|oauth|sso)(\/|\.|-|_|$)/i,
    /^(src\/)?(middleware|proxy)\.(t|j)sx?$/,
  ],
  pii: [/(^|\/)(contact|register|profile|users?|accounts?|newsletter|consent|privacy|cookies?|analytics|tracking)(\/|\.|-|_|$)/i],
  security: [
    /^\.github\//,
    /^scripts\//,
    /^config\//,
    /^\.agents\//,
    /^next\.config\.(t|j|mj)s$/,
    /^vercel\.json$/,
    /(^|\/)\.env/,
    /(^|\/)route\.(t|j)sx?$/,
    /^AGENTS\.md$/,
  ],
  "prod-data": [
    /(^|\/)(prisma|migrations?|drizzle|supabase|db|database)(\/|$)/i,
    /(^|\/)schema\.(prisma|sql)$/i,
    /\.sql$/i,
    /(^|\/)seeds?(\.|\/)/i,
  ],
};

/** Added-line rules: matched against "+" lines of the patch only. */
export const CONTENT_RULES = {
  money: [/\b(stripe|paypal|braintree|paddle|lemonsqueezy|adyen|square)\b/i, /\b(amount_cents|unit_amount|price_id|currency)\b/i],
  auth: [
    /\b(next-auth|@auth\/|@clerk\/|better-auth|lucia|supabase\.auth|jsonwebtoken|bcrypt|argon2|getServerSession)\b/i,
    /\bcookies\(\)\s*\.\s*(set|delete)\b/,
  ],
  pii: [
    /type=["'](email|tel)["']/i,
    /name=["'](email|phone|address|full_?name|dob)["']/i,
    /\b(gtag\(|posthog|mixpanel|@vercel\/analytics|@segment\/|hotjar|fbq\()/i,
  ],
  security: [
    /dangerouslySetInnerHTML/,
    /Content-Security-Policy|Access-Control-Allow-Origin/i,
    /\beval\s*\(|new Function\s*\(/,
    /\bchild_process\b/,
    /^\s*["']use server["']/,
  ],
  "prod-data": [
    /\bDATABASE_URL\b/,
    /@prisma\/client|drizzle-orm|@vercel\/postgres|@neondatabase\/|@supabase\/supabase-js|\bmongoose\b|\bkysely\b/,
    /\b(DROP|TRUNCATE|ALTER)\s+TABLE\b/i,
  ],
};

function addedLines(patch) {
  if (typeof patch !== "string") return [];
  return patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

/**
 * files: [{ filename, previous_filename?, patch? }] (GitHub PR files API shape)
 * Returns { tierC, categories: [...], reasons: { category: [string...] } }.
 */
export function classify(files) {
  const reasons = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
  for (const f of files ?? []) {
    const paths = [f?.filename, f?.previous_filename].filter((p) => typeof p === "string" && p);
    for (const cat of CATEGORIES) {
      for (const p of paths) {
        if (PATH_RULES[cat].some((re) => re.test(p))) {
          reasons[cat].push(`path ${p}`);
          break;
        }
      }
      const lines = addedLines(f?.patch);
      const hit = CONTENT_RULES[cat].find((re) => lines.some((l) => re.test(l)));
      if (hit) reasons[cat].push(`content ${f.filename} ~ ${hit.source.slice(0, 40)}`);
    }
  }
  const categories = CATEGORIES.filter((c) => reasons[c].length > 0);
  return { tierC: categories.length > 0, categories, reasons };
}

// ---------------------------------------------------------------- GitHub mode

const API = "https://api.github.com";

async function gh(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === "DELETE" && res.status === 404) return null;
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

async function paged(path) {
  const out = [];
  for (let page = 1; page <= 30; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const batch = await gh(`${path}${sep}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
  throw new Error(`pagination cap hit for ${path} — fail closed`);
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k.startsWith("--")) throw new Error(`unexpected arg ${k}`);
    a[k.slice(2)] = argv[i + 1];
  }
  return a;
}

async function runPr({ repo, pr, owner, eventAction, githubOutput }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new Error("bad --repo");
  if (!/^\d+$/.test(pr ?? "")) throw new Error("bad --pr");
  if (!owner) throw new Error("missing --owner");

  const pull = await gh(`/repos/${repo}/pulls/${pr}`);
  const head = pull.head.sha;
  const files = await paged(`/repos/${repo}/pulls/${pr}/files`);
  const result = classify(files);
  const unscanned = files.filter((f) => !f.patch && f.status !== "removed").map((f) => f.filename);

  const have = new Set(pull.labels.map((l) => l.name));
  const want = new Set(result.tierC ? ["tier-c", ...result.categories.map((c) => `risk:${c}`)] : []);
  const managed = ["tier-c", ...CATEGORIES.map((c) => `risk:${c}`)];

  // New code invalidates a prior owner approval.
  if (eventAction === "synchronize" && have.has("tier-c-approved")) {
    await gh(`/repos/${repo}/issues/${pr}/labels/tier-c-approved`, { method: "DELETE" });
    have.delete("tier-c-approved");
    console.log("risk-classify: new push — removed tier-c-approved (approval is per head)");
  }
  const toAdd = [...want].filter((l) => !have.has(l));
  if (toAdd.length) await gh(`/repos/${repo}/issues/${pr}/labels`, { method: "POST", body: { labels: toAdd } });
  for (const l of managed) {
    if (have.has(l) && !want.has(l)) await gh(`/repos/${repo}/issues/${pr}/labels/${encodeURIComponent(l)}`, { method: "DELETE" });
  }

  // Owner approval: tier-c-approved present AND its most recent `labeled`
  // event was performed by the owner. Anyone else applying it does not count.
  let approved = false;
  if (result.tierC && have.has("tier-c-approved")) {
    const events = await paged(`/repos/${repo}/issues/${pr}/events`);
    const last = events.filter((e) => e.event === "labeled" && e.label?.name === "tier-c-approved").at(-1);
    approved = !!last && last.actor?.login?.toLowerCase() === owner.toLowerCase();
    if (!approved) console.log(`risk-classify: tier-c-approved was applied by ${last?.actor?.login ?? "unknown"}, not the owner — ignored`);
  }

  let state, description;
  if (!result.tierC) {
    state = "success";
    description = unscanned.length ? `Not Tier C (paths only for ${unscanned.length} unscanned file(s))` : "Not Tier C";
  } else if (approved) {
    state = "success";
    description = `Tier C (${result.categories.join(", ")}) — owner approved this head`;
  } else {
    state = "failure";
    description = `Tier C (${result.categories.join(", ")}) — owner must apply tier-c-approved`;
  }
  await gh(`/repos/${repo}/statuses/${head}`, {
    method: "POST",
    body: { state, context: "tier-c-gate", description: description.slice(0, 140) },
  });

  console.log(JSON.stringify({ head, ...result, unscanned, state }, null, 2));
  if (githubOutput) appendFileSync(githubOutput, `tier_c=${result.tierC}\nstate=${state}\n`);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.fixture) {
    console.log(JSON.stringify(classify(JSON.parse(readFileSync(a.fixture, "utf8"))), null, 2));
    return;
  }
  await runPr({ repo: a.repo, pr: a.pr, owner: a.owner, eventAction: a["event-action"], githubOutput: a["github-output"] });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`risk-classify: ${e.message}`);
    process.exit(1);
  });
}
