# token-launch-radar-kiko-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Nr1414-dev/token-launch-radar-kiko-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Nr1414-dev/token-launch-radar-kiko-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every pre-token protocol in the sealed DefiLlama snapshot by the implied value of a token it may one day issue — priced from the median market-cap-to-TVL multiples of live-token peers in its own category, adjusted for seven-day growth, age and chains — with a six-step farm plan, costs and times, for each protocol.

Version 3 of the model (this repository) changes two things against the first entry:

- **Guarded shrinkage (k=3).** A category's peer multiple is its median shrunk toward the global multiple: (n × median + 3 × global) / (n + 3). The guard: a raw category median outside 0.05–2.00× is treated as an artefact of one or two extreme peers, not a price — those rows keep the global multiple. This halves the board's fragility to the single global number without importing one-peer noise.
- **Confidence (display only).** Each row carries a confidence score in [0, 1] — peer support, data completeness, and size — shown beside its price. Confidence never changes a rank or an implied value. The detail view also names the multiple's source, the peer count, and the reason in plain words.

The farm plans vary by capital tier, category, seven-day trend, chain count, age band and watchlist status. Their cost and time figures are stated assumptions (capital tiers by TVL, gas $2–8 per transaction, 5–15 minutes per action), not snapshot data: the snapshot carries no gas price per chain and no points-page information, so no step claims either.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=mzt460aw&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
