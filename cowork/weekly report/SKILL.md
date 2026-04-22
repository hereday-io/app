---
name: hereday-weekly-report
description: Generate the weekly top-level product and business report for hereday.io by pulling from git history, GitHub/GitLab PRs, and Stripe metrics, then draft an email to founders with a proposed co-work schedule for the coming week. Use this skill whenever the user asks for a "weekly report", "weekly update", "founder update", "hereday update", "what shipped this week", or mentions sending a status email to founders/co-founders. Trigger this even if hereday.io is not explicitly named — if the user is generating a weekly dev+business roundup from git and Stripe, this is the right skill. Always produce the markdown report FIRST for review before drafting any email.
---

# Hereday.io Weekly Report

Generate a weekly top-level report for hereday.io covering **dev progress** (from git commits and GitHub/GitLab PRs) and **business updates** (from Stripe metrics), then draft an email to founders including a proposed co-work schedule.

## Workflow

Follow these steps in order. Do not skip ahead.

### 1. Confirm scope before doing anything

Ask the user (unless already answered in the thread):

- Repo path(s) to scan and whether it's GitHub or GitLab
- The reporting window (default: last 7 days ending today)
- Where Stripe numbers should come from: pasted in chat, a file path (e.g. `stripe-weekly.csv`, `metrics.md`), or the Stripe MCP connector if connected
- Recipient founder names/emails for the email draft

Do not proceed until you have the repo path and Stripe source.

### 2. Pull dev progress

**Git log** (run from the repo path):

```bash
git log --since="7 days ago" --pretty=format:"%h|%an|%ad|%s" --date=short --no-merges
```

Also capture merged-branch summary:

```bash
git log --since="7 days ago" --merges --pretty=format:"%h|%s" --date=short
```

**PRs**: Prefer `gh` (GitHub) or `glab` (GitLab) CLI if available.

- GitHub: `gh pr list --state merged --search "merged:>=$(date -d '7 days ago' +%Y-%m-%d)" --json number,title,author,mergedAt,url`
- GitLab: `glab mr list --state merged --updated-after="$(date -d '7 days ago' +%Y-%m-%d)"`

If CLI isn't installed or auth fails, tell the user and ask whether to proceed with git log only or pause so they can authenticate.

Group commits/PRs into **themes** (features, fixes, infra, docs). Do not list every commit verbatim — summarize. Keep the commit hashes/PR links for reference though.

### 3. Pull business metrics

Load Stripe numbers from whichever source the user specified. You need, at minimum:

- MRR (current + week-over-week delta)
- New subscriptions this week
- Churned subscriptions this week
- Gross revenue this week
- Net new customers

If the Stripe MCP connector is connected, use it. Otherwise read the file the user pointed to, or use numbers they paste in.

**Never fabricate numbers.** If a metric isn't available, write `N/A — not provided` in the report. Do not estimate.

### 4. Generate the report

Write the report to `hereday-weekly-report-YYYY-MM-DD.md` in the current working directory, using the template in `references/report-template.md`.

The report has two top-level sections only: **Product Development** and **Business**. Keep it to one screen of reading — founders skim these. Target ~400-600 words total.

Read `references/report-template.md` now for the exact structure and tone.

### 5. Draft the co-work schedule and email

After the MD file is written:

1. Propose a co-work schedule for the upcoming week based on what's in flight (unfinished PRs, blockers mentioned in commits, recurring themes). See `references/schedule-heuristics.md` for how to construct this.
2. Draft an email to founders that:
   - Has a subject line like: `Hereday weekly — week of [Mon date]`
   - Summarizes the report in 3-5 bullets (not the full report)
   - Includes the proposed co-work schedule inline
   - Attaches/links the full MD report

Use the `message_compose_v1` tool to produce the email draft with 2 variants: one terse (bullets only) and one slightly fuller (short paragraphs). Let the user pick before sending.

### 6. Show, don't send

**Do not send the email.** Present the MD file via `present_files` and the email draft via `message_compose_v1`. The user reviews, edits, and sends themselves — or explicitly asks you to send it after review (which still requires their in-chat confirmation).

## Tone and style rules

- Write like a founder, not a PM. Direct, specific, no hedging filler.
- Lead each bullet with the outcome, not the activity. ("Cut signup abandonment 18%" not "Worked on signup flow.")
- No emoji in the report. The email can have a single subtle one in the greeting if the user prefers.
- Never pad. If a week was slow, say so — one honest line beats three vague ones.
- No AI-ese: avoid "leveraged", "delved into", "robust", "seamlessly", "exciting".

## Files in this skill

- `references/report-template.md` — the exact MD structure for the report
- `references/schedule-heuristics.md` — how to propose next week's co-work schedule
- `scripts/gather_git.sh` — helper to dump the past week's git activity in a clean format
