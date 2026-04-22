# Report Template

Use this exact structure. Fill in the bracketed sections. Delete any placeholder instructions after filling in.

```markdown
# Hereday.io — Weekly Report
**Week of [Monday, Month D]–[Sunday, Month D, YYYY]**

## Summary
[2-3 sentences. What's the one-line story of this week? What mattered most?]

---

## Product Development

### Shipped
[3-6 bullets grouped by theme. Lead with user/business outcome. Link PR or commit hash in parens at the end.
Example:
- Reduced onboarding time from 4 min to 90 sec by collapsing step 2 and 3 ([#142](...))
- Fixed timezone drift on scheduled sends affecting ~8% of users ([a3f9c12](...))]

### In flight
[Work that's open or partially done. Note % done if knowable. Flag anything blocked.]

### Blockers / risks
[Name them plainly. If none, write "None this week."]

---

## Business

### Metrics at a glance
| Metric | This week | Change |
|---|---|---|
| MRR | $[X] | [+/- $Y, Z%] |
| New subscriptions | [N] | [+/- vs last week] |
| Churned | [N] | [+/- vs last week] |
| Net new customers | [N] | — |
| Gross revenue (7d) | $[X] | — |

### Notes
[2-4 bullets on anything the raw numbers don't tell — cohort quirks, a big account signed, refund spike, campaign results, etc. If nothing notable, say "Numbers track with last week's trend."]

---

*Generated [Date]. Questions → [user name / email].*
```

## What NOT to include

- Individual commit messages verbatim (group and summarize instead)
- Lists of files changed
- Anything speculative about next week (that belongs in the email's schedule section, not the report)
- Apologies, hedges, or AI-style preamble ("I've put together...")
- Estimates of metrics that weren't provided — write `N/A` instead
