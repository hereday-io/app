# Hereday.io — Weekly Report
**Week of Apr 14–20, 2026**

## Summary
Shipped a faster signup path and fixed the timezone bug that was hitting ~8% of scheduled sends. MRR ticked up modestly; one enterprise trial converted. No critical blockers heading into next week.

---

## Product Development

### Shipped
- Cut signup abandonment ~18% by collapsing onboarding steps 2 and 3 into a single screen (#142)
- Fixed timezone drift on scheduled sends that was affecting ~8% of users (a3f9c12, f02e1a9)
- Moved staging deploys to Fly.io — build times down from 7 min to 2:10 (#145)
- Added CSV export for customer reports (long-standing request from 3 accounts) (#147)

### In flight
- Auth refactor (#148) — ~70% done, blocked on a decision about session length defaults
- Pricing page redesign — copy draft complete, layout in progress

### Blockers / risks
- Session length decision needs a founder call — Matt flagged on Thursday but hasn't been resolved

---

## Business

### Metrics at a glance
| Metric | This week | Change |
|---|---|---|
| MRR | $24,180 | +$640 (+2.7%) |
| New subscriptions | 11 | +2 vs last week |
| Churned | 3 | +1 vs last week |
| Net new customers | 8 | — |
| Gross revenue (7d) | $6,420 | — |

### Notes
- One enterprise trial (Helios Group) converted to annual — $4,800 ARR, not yet in this week's MRR calc
- Churn bump is two small-plan customers citing "not using it enough" and one payment failure — worth checking dunning flow next week
- Free-to-paid conversion on the new signup flow is trending up but needs another week of data

---

*Generated 2026-04-18. Questions → [founder@hereday.io].*
