# World Visual Approvals

Approval files in this directory are deliberate human decisions, not generated
artifacts. Create a pending hash-bound template with:

```sh
npm run worldgen:approval -- \
  --package worlds/generated/WORLD_ID \
  --output worlds/approvals/WORLD_ID.json
```

The reviewer must inspect the package in the browser workshop at gameplay scale,
then edit the template to record the decision, identity, timestamp, three
acceptance booleans, and notes. Promotion revalidates the package and refuses
any hash drift. Do not approve structural diagnostics or art that violates the
Terrain Constitution.
