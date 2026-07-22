# Generated Worlds Agent Instructions

`worlds/recipes/` contains reviewed, versioned generator inputs. Generated
packages belong under `worlds/generated/` and are ignored until explicitly
reviewed and promoted.

- Recipes must pass `npm run worldgen:test` and preserve the Terrain
  Constitution.
- Do not hand-edit generated bundles, rasters, reports, or hashes.
- Generated packages are review artifacts, never live server authority.
- Recipe climate and chunk geometry are authority. Do not hand-tune generated
  biome rows, seasonal baselines, chunk aprons, or chunk hashes.
- Atlas recipes under `atlases/` own continent dimensions and region addressing.
  Region packages must stay bound to their atlas hashes and must not be moved to
  another coordinate by editing generated JSON.
- Promotion into `assets/terrain/worlds/` and `server/data/world.json` is a
  separate explicit operation with runtime verification and an intentional wipe.
