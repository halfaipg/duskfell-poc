import {
  GENERATED_WAYFARER_NAME_RE,
  ITEM_ICON_FRAMES,
  PLAYER_ARCHETYPE_LABELS,
  PLAYER_CARD_PORTRAITS,
} from "./player-config.js";

export function renderHud({ ui, snapshot, smoothedFps, terrainDebugMode }) {
  if (!ui.hud) return;
  if (!snapshot) {
    ui.hud.textContent = `FPS ${Math.round(smoothedFps)} / connecting`;
    return;
  }
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  ui.hud.textContent = `FPS ${Math.round(smoothedFps)} / Players ${players.length} / Tick ${snapshot.tick}${
    terrainDebugMode ? ` / Terrain ${terrainDebugMode}` : ""
  }`;
}

export function renderPanel({ ui, snapshot, playerId, sprites, playerSpriteFor }) {
  if (!snapshot) return;
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  const me = players.find((player) => player.id === playerId);
  const itemDataUrls = sprites.items?.dataUrls ?? [];
  renderPlayerCard(ui, me, me ? playerSpriteFor(me) : sprites.player);

  const settlement = snapshot.settlement;
  ui.chainMode.textContent = settlement.chainEnabled ? "chain enabled" : "dry-run";
  ui.pendingJobs.textContent = String(settlement.pendingJobs);
  ui.confirmedJobs.textContent = String(settlement.confirmedJobs);
  ui.latestReceipt.textContent = settlement.latestReceipt
    ? `${settlement.latestReceipt.assetId} (${settlement.latestReceipt.status})`
    : "-";

  renderDeedPanel(ui, me?.demoDeeds ?? [], itemDataUrls);
  renderInventoryPanel(ui, me?.inventory ?? null, itemDataUrls);
  renderPartyStatus(ui, snapshot, playerId);
}

function renderPartyStatus(ui, snapshot, playerId) {
  if (!ui.partyStatus) return;
  const npcs = Array.isArray(snapshot.npcs) ? snapshot.npcs : [];
  const companion = npcs.find((npc) => npc.partyPlayerId === playerId);
  ui.partyStatus.textContent = companion
    ? `Traveling with ${companion.name}`
    : "Traveling alone";
  ui.partyStatus.classList.toggle("party-active", Boolean(companion));
}

export function playerDisplayName(player, sprite) {
  const name = player.name || "Wayfarer";
  const generatedName = GENERATED_WAYFARER_NAME_RE.exec(name);
  const archetype = sprite ? sprite.label ?? PLAYER_ARCHETYPE_LABELS[sprite.id] : null;
  if (!generatedName || !archetype) return name;
  return `${archetype}-${generatedName[1]}`;
}

export function inventoryItemCount(inventory) {
  return inventory.items.reduce((total, item) => total + item.quantity, 0);
}

function renderPlayerCard(ui, player, sprite) {
  const label = sprite?.label ?? PLAYER_ARCHETYPE_LABELS[sprite?.id] ?? "Wayfarer";
  const displayName = player ? playerDisplayName(player, sprite) : "Wayfarer";
  const portrait = playerCardPortraitFor(sprite);

  if (ui.playerCardName) {
    ui.playerCardName.textContent = displayName;
  }
  if (ui.playerCardArchetype) {
    ui.playerCardArchetype.textContent = `${label} base paperdoll`;
  }
  if (ui.playerCardPortrait && portrait && ui.playerCardPortrait.getAttribute("src") !== portrait) {
    ui.playerCardPortrait.src = portrait;
  }
}

function playerCardPortraitFor(sprite) {
  if (!sprite) return PLAYER_CARD_PORTRAITS["duskfell-paperdoll-wayfarer"];
  return (
    PLAYER_CARD_PORTRAITS[sprite.id] ??
    PLAYER_CARD_PORTRAITS[sprite.baseSheetId] ??
    PLAYER_CARD_PORTRAITS["duskfell-paperdoll-wayfarer"]
  );
}

function renderDeedPanel(ui, deeds, itemDataUrls) {
  const container = ui.deedStatus;
  if (!container) return;
  container.replaceChildren();

  if (!deeds.length) {
    const empty = document.createElement("div");
    empty.className = "inventory-empty";
    empty.textContent = "Walk to the Title Office and press E to claim a dry-run deed.";
    container.append(empty);
    return;
  }

  for (const deed of deeds) {
    const row = document.createElement("div");
    row.className = "deed-row";

    const icon = document.createElement("img");
    icon.className = "deed-icon";
    icon.alt = "";
    icon.decoding = "async";
    const iconUrl = itemIconUrl("deed", itemDataUrls);
    if (iconUrl) icon.src = iconUrl;

    const label = document.createElement("span");
    label.className = "deed-label";
    label.textContent = deed;

    row.append(icon, label);
    container.append(row);
  }
}

function renderInventoryPanel(ui, inventory, itemDataUrls) {
  const container = ui.resourceStatus;
  if (!container) return;
  container.replaceChildren();

  if (!inventory) {
    const empty = document.createElement("div");
    empty.className = "inventory-empty";
    empty.textContent = "Gather wood and ore, then craft at the Field Forge.";
    container.append(empty);
    return;
  }

  if (!inventory.items.length) {
    const empty = document.createElement("div");
    empty.className = "inventory-empty";
    empty.textContent = `Empty (${inventory.capacitySlots} slots)`;
    container.append(empty);
    return;
  }

  for (const item of inventory.items) {
    const row = document.createElement("div");
    row.className = "inventory-stack";

    const icon = document.createElement("img");
    icon.className = "inventory-icon";
    icon.alt = "";
    icon.decoding = "async";
    const iconUrl = itemIconUrl(item.itemId, itemDataUrls);
    if (iconUrl) {
      icon.src = iconUrl;
    }

    const labelWrap = document.createElement("div");
    labelWrap.className = "inventory-stack-body";

    const label = document.createElement("span");
    label.className = "inventory-label";
    label.textContent = item.label;
    labelWrap.append(label);

    if (item.lifecycle) {
      const lifecycle = document.createElement("div");
      lifecycle.className = `inventory-lifecycle${item.lifecycle.compostable ? " is-compostable" : ""}`;

      const meter = document.createElement("span");
      meter.className = "inventory-decay-meter";
      meter.style.setProperty("--decay", String(item.lifecycle.decay));

      const meta = document.createElement("span");
      meta.className = "inventory-lifecycle-text";
      meta.textContent = inventoryLifecycleText(item.lifecycle);

      lifecycle.append(meter, meta);
      labelWrap.append(lifecycle);
    }

    const count = document.createElement("span");
    count.className = "inventory-count";
    count.textContent = String(item.quantity);

    row.append(icon, labelWrap, count);
    container.append(row);
  }

  const capacity = document.createElement("div");
  capacity.className = "inventory-capacity";
  capacity.textContent = `${inventory.items.length}/${inventory.capacitySlots} slots`;
  container.append(capacity);
}

function itemIconUrl(itemId, itemDataUrls) {
  const frame = ITEM_ICON_FRAMES[itemId];
  if (frame == null) return null;
  return itemDataUrls[frame] ?? null;
}

function inventoryLifecycleText(lifecycle) {
  const age = lifecycle.ageYears > 0 ? `${lifecycle.ageYears}y` : "new";
  return `${lifecycle.stage} ${age}`;
}
