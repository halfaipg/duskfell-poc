const RESOURCE_NODE_IDS = [
  "north-grove",
  "east-ore",
  "old-shrine",
  "young-grove-sapling",
  "mossheart-grove-tree",
  "ancient-ironleaf-tree",
  "fallen-grove-log",
  "decaying-grove-stump",
  "hollow-grove-stump",
  "shrine-mycelium-bloom",
  "veilcap-runner",
  "stormroot-field-coil",
  "field-coil",
  "ancient-viaduct-ruin",
];

export function resourceNodeSummary(snapshot) {
  const summary = {};
  for (const id of RESOURCE_NODE_IDS) {
    const object = snapshot.objects.find((candidate) => candidate.id === id);
    const resource = object?.resources?.[0];
    summary[id] = resource
      ? {
          kind: resource.kind,
          amount: resource.amount,
          maxAmount: resource.maxAmount,
          stage: object.lifecycle?.stage ?? null,
        }
      : null;
  }
  return summary;
}

export function resourceNodesMatch(before, after) {
  for (const id of RESOURCE_NODE_IDS) {
    if (!before[id] || !after[id]) return false;
    if (before[id].kind !== after[id].kind) return false;
    if (before[id].amount !== after[id].amount) return false;
    if (before[id].maxAmount !== after[id].maxAmount) return false;
  }
  return true;
}
