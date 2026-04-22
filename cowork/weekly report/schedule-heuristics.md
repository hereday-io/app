# Co-work Schedule Heuristics

How to propose next week's co-work schedule from this week's signals.

## Inputs to use

1. **Open/in-flight PRs** — likely to need pairing or review time
2. **Commit themes** — if three commits mention "auth flow", that's an active area worth a block
3. **Blockers from the report** — schedule a sync specifically to unblock
4. **Metrics anomalies** — a churn spike or MRR dip warrants a business-focused block
5. **User's stated priorities** if they mention any in the chat

## Output format

Propose 3-5 co-work blocks for the coming week (Mon–Fri). Each block has:

- **Day + time window** (suggest 90-min blocks; founders are busy)
- **Focus** (one line)
- **Deliverable** (what should exist at end of block)

Default times if user hasn't said otherwise: Tue 10–11:30, Wed 14–15:30, Thu 10–11:30. Ask if you're unsure about their timezone — hereday.io has founders in different regions potentially.

## Example

```
Proposed co-work — week of Apr 20

- **Mon 10:00–11:30** — Review and merge the pending auth refactor PR (#148). Goal: ship to staging by EOD.
- **Tue 14:00–15:30** — Churn deep-dive. 3 customers churned this week; pull exit survey data and decide on one retention experiment.
- **Thu 10:00–11:30** — Pricing page redesign kickoff. Block out copy + layout, handoff to design Friday.
```

## Rules

- Don't propose more than 5 blocks. Founders won't honor a packed schedule.
- Every block must tie to something concrete from this week — no filler "sync meetings."
- If the week was quiet, propose fewer blocks. Two good blocks > five vague ones.
- Don't schedule on weekends unless user explicitly works weekends.
