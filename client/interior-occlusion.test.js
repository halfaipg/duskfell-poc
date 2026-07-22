import assert from "node:assert/strict";
import test from "node:test";

import {
  interiorFloorAt,
  interiorHeightAt,
  interiorOccupancy,
  interiorPortalAt,
  interiorPortalHeightAt,
  interiorRoomAt,
} from "./interior-occlusion.js";

const space = {
  bounds: { minX: 100, maxX: 300, minY: 200, maxY: 420 },
  revealPadding: 16,
  floors: [
    { level: 0, label: "ground", z: 0 },
    { level: 1, label: "upper", z: 1.2 },
  ],
  portals: [
    {
      id: "south-stairs",
      kind: "stairs",
      fromFloor: 0,
      toFloor: 1,
      fromZ: 0,
      toZ: 1.2,
      axis: "y",
      bounds: { minX: 140, maxX: 180, minY: 360, maxY: 445 },
    },
  ],
  roof: {
    alpha: 0.84,
    revealedAlpha: 0.16,
  },
};

test("interior occupancy fades roof when player enters bounds", () => {
  const outside = interiorOccupancy(space, { x: 40, y: 260, z: 0 });
  assert.equal(outside.inside, false);
  assert.equal(outside.floor, null);
  assert.equal(outside.roofAlpha, 0.84);

  const inside = interiorOccupancy(space, { x: 150, y: 260, z: 0.2 });
  assert.equal(inside.inside, true);
  assert.equal(inside.floor.level, 0);
  assert.equal(inside.portal, null);
  assert.equal(inside.roofAlpha, 0.16);
});

test("interior occupancy honors reveal padding around the footprint", () => {
  const padded = interiorOccupancy(space, { x: 90, y: 260, z: 0 });
  assert.equal(padded.inside, true);

  const beyondPadding = interiorOccupancy(space, { x: 80, y: 260, z: 0 });
  assert.equal(beyondPadding.inside, false);
});

test("interior floor selection picks highest floor at or below player z", () => {
  assert.equal(interiorFloorAt(space, -0.4).level, 0);
  assert.equal(interiorFloorAt(space, 0.8).level, 0);
  assert.equal(interiorFloorAt(space, 1.2).level, 1);
  assert.equal(interiorFloorAt(space, 4).level, 1);
});

test("interior portal selection identifies stair connectors inside the space", () => {
  assert.equal(interiorPortalAt(space, { x: 150, y: 300 }), null);
  assert.equal(interiorPortalAt(space, { x: 160, y: 390 }).id, "south-stairs");

  const occupancy = interiorOccupancy(space, { x: 160, y: 390, z: 0.1 });
  assert.equal(occupancy.inside, true);
  assert.equal(occupancy.portal.id, "south-stairs");
  assert.equal(occupancy.portal.fromFloor, 0);
  assert.equal(occupancy.portal.toFloor, 1);
});

test("interior height samples floor z and interpolates stair portal z", () => {
  assert.deepEqual(interiorHeightAt(space, { x: 150, y: 260, z: 0.1 }), {
    z: 0,
    source: "floor",
    floor: space.floors[0],
  });
  assert.equal(interiorPortalHeightAt(space.portals[0], { x: 160, y: 360 }), 0);
  assert.equal(interiorPortalHeightAt(space.portals[0], { x: 160, y: 445 }), 1.2);
  const midpoint = interiorHeightAt(space, { x: 160, y: 402.5, z: 0.1 });
  assert.equal(midpoint.source, "portal");
  assert.equal(midpoint.portal.id, "south-stairs");
  assert.ok(midpoint.z > 0.59 && midpoint.z < 0.61);
});

test("room occupancy reveals only matching occluder groups", () => {
  const roomSpace = {
    ...space,
    rooms: [
      { id: "west", floorLevel: 0, bounds: { minX: 100, maxX: 200, minY: 200, maxY: 420 } },
      { id: "east", floorLevel: 0, bounds: { minX: 200, maxX: 300, minY: 200, maxY: 420 } },
    ],
    occluders: [
      { id: "west-roof", floorLevel: 1, roomIds: ["west"], bounds: { minX: 100, maxX: 200, minY: 200, maxY: 420 }, alpha: 0.84, revealedAlpha: 0.05 },
      { id: "east-roof", floorLevel: 1, roomIds: ["east"], bounds: { minX: 200, maxX: 300, minY: 200, maxY: 420 }, alpha: 0.84, revealedAlpha: 0.05 },
    ],
  };
  assert.equal(interiorRoomAt(roomSpace, { x: 150, y: 260, z: 0 }).id, "west");
  const occupancy = interiorOccupancy(roomSpace, { x: 150, y: 260, z: 0 });
  assert.deepEqual(occupancy.activeRoomIds, ["west"]);
  assert.equal(occupancy.occluders.find((entry) => entry.id === "west-roof").alpha, 0.05);
  assert.equal(occupancy.occluders.find((entry) => entry.id === "east-roof").alpha, 0.84);
});
