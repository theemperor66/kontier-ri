# Kontier RI — Program Plan v1 (from challenge entry to fundable prototype)
_Authored 2026-08-31. Owner: orchestrator agent. Sponsor: Zaid._

## 0. Program goals & success metrics
- G1 (Sep 3): WebMCP Challenge submission filed, top-10 target. Metric: submitted ≥6h before deadline; judges can reproduce every claim in <5 min.
- G2 (Sep 14): "multi-million prototype" demo. Metric: cold viewer reaches an audible "wow" ≤60s; demo runs on viewer-relevant data; zero dead air in a 5-min live run.
- G3 (Oct): Kontier-integrated alpha (private). Metric: RI canvas reads live Kontier workspace data behind auth.

## 1. Workstreams
| WS | Name | Outcome | Horizon |
|----|------|---------|---------|
| WS1 | Submission ops | Devpost filed, video live, R1 verified | Sep 1–3 |
| WS2 | Wow-pack | 100M-row scale proof + visible agent presence | Sep 1–2 (freeze Tue 18:00) |
| WS3 | Predictive pack | forecast tile, cohort matrix, what-if simulator | Sep 4–10 |
| WS4 | Data gravity | Stripe wizard; Postgres/MotherDuck/S3; Kontier adapter (private) | Sep 4–14 |
| WS5 | Collaboration | multiplayer cursors, comments, live share | Sep 10+ (spike first) |
| WS6 | Demo & GTM | human-VO video, landing polish, launch post | Sep 1–3 + ongoing |
| WS7 | Enterprise/trust | authz story, compliance-grade audit, SSO | Kontier-side, Oct |

## 2. Phase plan
### Phase 0 — TODAY (Mon Aug 31)
- P0.1 [user, 10 min, BLOCKING] R1 session: ChatGPT in-app browser on live URL; verify pill 32→35 on selection; one agent build loop. Records the last technical unknown. Fallback if dynamic tools misbehave: always-registered fallback flag (studio has the seam) — 2h fix window Tue morning.
- P0.2 [agent] Spawn WS2 workers (scale-proof, agent-presence). Additive-only rule: new code behind demo buttons/new tools; zero changes to existing tool contracts; clean-clone gate before every push.
- P0.3 [user, 5 min] Devpost account + join hackathon (de-risks form surprises).
### Phase 1 — Tue Sep 1 → freeze
- P1.1 [agent] Integrate WS2, adversarial audit round 3, regenerate hero/OG/demo page, e2e additions.
- P1.2 [agent] Stripe import wizard ONLY IF WS2 lands green by Tue 12:00 (else post-submission).
- P1.3 [user+agent, evening] Video final: user voice over draft2 beat structure + real ChatGPT screen capture for b1/b4; agent re-cuts (assemble.sh). Fallback: ship draft2 TTS as-is.
- P1.4 FEATURE FREEZE Tue 18:00. After freeze: docs/media/submission text only.
### Phase 2 — Wed Sep 2 (buffer) & Sep 3 (submission)
- P2.1 [agent] Full verification sweep (35+ tools live, cross-browser, cold-profile, README claims audit).
- P2.2 [user, 30 min, target Wed 12:00] YouTube upload (public) + Devpost form (all text pre-written in docs/SUBMISSION.md) + SUBMIT. Hard stop: never inside last 6h.
- P2.3 [agent] Post-submit: watchdog retired, tag v1.0 release, archive session artifacts.
### Phase 3 — Sep 4–14 (fundable-prototype sprint)
- P3.1 WS3 predictive pack (forecast ETS band; cohort retention heatmap; what-if slider tile w/ agent narration — CPQ domain edge).
- P3.2 WS4 Stripe wizard GA + one warehouse connector; Kontier adapter in private repo consuming the DataSource seam.
- P3.3 WS5 multiplayer spike (PartyKit/DO): go/no-go by Sep 12.
- P3.4 5 pilot users (design partners) on real data; capture testimonial clips.

## 3. Ownership (RACI-lite)
- Agent orchestrator: plan, worker supervision, integration, QA gates, docs, deploys — R/A on WS2/3/4 code.
- Workers (ephemeral): single-workstream execution, TTL-supervised, clean-clone verified.
- Zaid: R1 session, voice, Devpost/YouTube (legal identity), Vercel connect, pilot-user intros, prize decisions — A on WS1 human steps, C on scope calls.

## 4. Quality gates (unchanged, non-negotiable)
Clean-clone: pnpm -r build + 182+ unit + 9+ e2e green. Live-URL real-Chrome tool sweep. Visual QA (attach_image review, both themes). Zero regression to v1 doc loading (migration tests). Additive-only before freeze.

## 5. Risks
| Risk | L×I | Mitigation |
|---|---|---|
| ChatGPT browser dynamic-tool quirk found late | M×H | P0.1 TODAY; fallback flag ready |
| WS2 destabilizes pre-deadline | L×H | additive-only, gates, git revert rollback, freeze |
| 100M parquet hosting egress/latency | M×M | Cloudflare R2 (free egress) + 10M fallback file |
| Human steps slip to deadline hour | M×H | watchdog escalation <36h; submit target Wed 12:00 |
| Post-hackathon momentum loss | M×M | Phase 3 dated, pilots booked in advance |
| AGPL outside contributions complicate dual-license | L×M | CLA before accepting first external PR |

## 6. Open decisions (need sponsor)
- D1: video = human VO re-shoot vs ship TTS draft2 (decide Tue AM)
- D2: Vercel as primary URL vs keep GitHub Pages (decide before form)
- D3: Stripe wizard pre- vs post-deadline (auto-decided by P1.2 rule)
- D4: multiplayer in scope for Sep? (decide at P3.3 spike)
