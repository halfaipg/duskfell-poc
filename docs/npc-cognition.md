# NPC Cognition

Duskfell's first NPC slice keeps the simulation authoritative and treats an LLM as an optional dialogue writer, not a game actor.

## Runtime Flow

1. NPC identity, position, persona, drives, color, and canned lines are loaded from `server/data/world.json` and validated at startup.
2. A player's existing overhead `say` message is independently rate limited, then enters the simulation as a typed `ActorIntent::Say`.
3. Only the nearest NPC within 180 world units receives an `ActorSpoke` event.
4. The cognition engine produces one schema-validated `say` intent. Conversations are isolated by NPC and player, and jobs for one NPC are serialized.
5. The host converts the model output into the same typed actor intent used by player speech. The simulation rechecks NPC identity, player identity, proximity, text sanitation, and length before placing the reply in authoritative snapshots.
6. Missing credentials, a full queue, timeout, rate limit, invalid output, or unavailable provider selects the NPC's next deterministic canned line and submits it through that same intent boundary.

Raw dialogue is not written to the durable gameplay journal. Engine transcripts are bounded, expire in memory, and are isolated per NPC/player pair. When a network provider is configured, the nearby player's display name and dialogue are sent to that operator-selected provider to generate the reply.

## Configuration

The default `ANIMUS_PROVIDER=auto` enables network cognition only when `ANIMUS_API_KEY` is present. Without a key the server remains fully playable and uses canned NPC dialogue.

```sh
# Deterministic local/CI behavior with no network
ANIMUS_PROVIDER=mock cargo run -p sundermere-server

# OpenAI-compatible provider
ANIMUS_PROVIDER=openai-compatible \
ANIMUS_BASE_URL=https://api.example.invalid \
ANIMUS_API_KEY=replace-me \
ANIMUS_MODEL=model-id \
cargo run -p sundermere-server
```

Operational bounds are configurable with `ANIMUS_MAX_CONCURRENT_JOBS`, `ANIMUS_QUEUE_CAPACITY`, `ANIMUS_REQUESTS_PER_MINUTE`, `ANIMUS_INTERACTIVE_TIMEOUT_MS`, and `ANIMUS_MAX_REPLY_TOKENS`. Player speech uses the separate `WS_SAY_BURST` and `WS_SAY_REFILL_PER_SECOND` limiter. Set `ANIMUS_ENABLED=false` to force canned-only behavior.

## Trust Boundary

The server registers only the `say` verb. Model responses cannot move an NPC, mutate inventory, form parties, schedule work, journal dialogue, or touch settlement. They also have no privileged mutation method: player speech, model speech, and canned fallback converge on `SimWorld::apply_actor_intent`. Provider URLs must use HTTP(S) and cannot embed credentials. Each real provider attempt spends request budget, response streams are byte bounded, and delayed replies are discarded when the player has left range.

Party/follow behavior, persistent memory, autonomous schedules, streaming dialogue UI, and NPC movement are intentionally deferred. Add those as separate server-authoritative systems with their own validation and tests; do not widen the dialogue intent as a shortcut.
