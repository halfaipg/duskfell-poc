const CLIMATE_ZONES = {
  W: "open-water",
  I: "permanent-snow",
  A: "alpine",
  T: "tundra",
  M: "marsh",
  R: "riparian",
  C: "crag",
  B: "boreal-woodland",
  Q: "temperate-rainforest",
  F: "temperate-woodland",
  G: "grassland",
  S: "dry-scrub",
  H: "heath",
};

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value, places = 5) => Number(value.toFixed(places));
const smoothstep = (low, high, value) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};

export function deriveClimateAuthority(bundle, recipe) {
  const { cols, rows } = bundle.dimensions;
  const climate = recipe.climate;
  const fields = bundle.fields;
  const waterDistance = distanceField(fields.water, (value) => value > 0.45);
  const extraFields = Object.fromEntries(
    ["precipitation", "humidity", "fogPotential", "windExposure", "growingSeason"].map((name) => [name, grid(rows, cols, 0)]),
  );
  Object.assign(fields, extraFields);

  for (let y = 0; y < rows; y += 1) {
    let airborneMoisture = climate.oceanMoisture;
    let priorElevation = tileElevation(bundle.heights, 0, y);
    for (let x = 0; x < cols; x += 1) {
      const elevation = clamp(tileElevation(bundle.heights, x, y));
      const slope = fields.slope[y][x];
      const latitude = rows <= 1 ? 0.5 : y / (rows - 1);
      const waterProximity = Math.exp(-waterDistance[y][x] / climate.waterHumidityRadiusTiles);
      const uplift = Math.max(0, elevation - priorElevation);
      const leeDrop = Math.max(0, priorElevation - elevation);
      const windExposure = clamp(elevation * 0.48 + slope * 0.42 + uplift * 0.34 - waterProximity * 0.08);
      const sourceTemperature = fields.temperature[y][x];
      const temperature = clamp(
        sourceTemperature * 0.24
        + climate.annualTemperature * 0.76
        - elevation * climate.elevationLapse
        - latitude * climate.latitudeCooling,
      );
      const precipitation = clamp(
        airborneMoisture * 0.48
        + fields.moisture[y][x] * 0.3
        + uplift * climate.orographicLift
        + waterProximity * 0.18
        - leeDrop * 0.2,
      );
      const moisture = clamp(
        precipitation * 0.56
        + waterProximity * 0.32
        + fields.moisture[y][x] * 0.18
        - slope * 0.12,
      );
      const humidity = clamp(
        moisture * 0.58
        + waterProximity * 0.24
        + (1 - temperature) * 0.18
        - windExposure * 0.12,
      );
      const fogPotential = clamp(
        smoothstep(climate.fogHumidityThreshold, 0.98, humidity)
        * (0.5 + waterProximity * 0.3 + (1 - elevation) * 0.2)
        * (1 - windExposure * 0.55),
      );
      const rockiness = clamp(fields.rockiness[y][x] * 0.78 + slope * 0.22);
      const snow = clamp(Math.max(
        fields.snow[y][x],
        smoothstep(recipe.terrain.snowline - 0.08, recipe.terrain.snowline + 0.05, elevation)
          * (1 - smoothstep(0.2, 0.48, temperature)),
      ) * (1 - fields.water[y][x]));
      const soil = clamp(0.9 - rockiness * 0.68 + moisture * 0.2 - slope * 0.15);
      const growingSeason = clamp(
        smoothstep(0.18, 0.64, temperature)
        * (1 - climate.seasonalAmplitude * 0.42)
        * (0.42 + moisture * 0.58),
      );
      const vegetation = clamp(
        growingSeason * soil * (0.32 + moisture * 0.82)
        * (1 - rockiness * 0.48)
        * (1 - snow),
      );

      fields.temperature[y][x] = round(temperature);
      fields.precipitation[y][x] = round(precipitation);
      fields.moisture[y][x] = round(moisture);
      fields.humidity[y][x] = round(humidity);
      fields.fogPotential[y][x] = round(fogPotential);
      fields.windExposure[y][x] = round(windExposure);
      fields.growingSeason[y][x] = round(growingSeason);
      fields.rockiness[y][x] = round(rockiness);
      fields.snow[y][x] = round(snow);
      fields.soil[y][x] = round(soil);
      fields.vegetation[y][x] = round(vegetation);

      updateBiomeWeights(bundle, x, y, waterDistance[y][x]);
      airborneMoisture = clamp(
        airborneMoisture
        + waterProximity * 0.075
        - precipitation * 0.065
        - uplift * 0.18,
        0.12,
        0.95,
      );
      priorElevation = elevation;
    }
  }

  const zoneRows = Array.from({ length: rows }, (_, y) => Array.from(
    { length: cols },
    (_, x) => climateZone(bundle, x, y, waterDistance[y][x]),
  ).join(""));
  return {
    schema: "duskfell-climate-authority-v1",
    algorithm: "orographic-water-balance-v1",
    prevailingWind: climate.prevailingWind,
    latitude: { southDegrees: climate.latitudeSouthDegrees, northDegrees: climate.latitudeNorthDegrees },
    zones: { classes: CLIMATE_ZONES, rows: zoneRows },
    seasonality: {
      calendarDays: 480,
      hemisphere: "north",
      annualTemperatureAmplitude: climate.seasonalAmplitude,
      seasons: [
        { id: "spring", startDay: 0, temperatureOffset: -0.03, precipitationMultiplier: 1.12, foliage: "leaf-out" },
        { id: "summer", startDay: 120, temperatureOffset: 0.16, precipitationMultiplier: 0.88, foliage: "full" },
        { id: "autumn", startDay: 240, temperatureOffset: -0.02, precipitationMultiplier: 1.06, foliage: "senescent" },
        { id: "winter", startDay: 360, temperatureOffset: -0.22, precipitationMultiplier: 0.96, foliage: "dormant" },
      ],
    },
    weatherBaseline: {
      fields: ["temperature", "precipitation", "humidity", "fogPotential", "windExposure"],
      runtimeStatus: "baseline-authority; dynamic fronts are not implemented",
    },
  };
}

function updateBiomeWeights(bundle, x, y, waterDistance) {
  const field = bundle.fields;
  const water = field.water[y][x];
  const snow = field.snow[y][x];
  const wetland = clamp(
    (1 - water)
    * smoothstep(0.64, 0.9, field.moisture[y][x])
    * (1 - smoothstep(0.32, 0.68, field.slope[y][x]))
    * (waterDistance < 4 ? 1 : 0.58),
  );
  const rock = clamp(field.rockiness[y][x] * (1 - wetland * 0.4));
  const meadow = clamp(
    field.vegetation[y][x]
    * smoothstep(0.28, 0.62, field.moisture[y][x])
    * (1 - wetland * 0.72)
    * (1 - rock * 0.66),
  );
  const loam = clamp(
    field.soil[y][x]
    * (1 - smoothstep(0.55, 0.84, field.moisture[y][x]))
    * (0.5 + field.temperature[y][x] * 0.5)
    * (1 - rock * 0.52),
  );
  const weights = normalizeWeights({
    meadow: meadow * (1 - water) * (1 - snow),
    loam: loam * (1 - water) * (1 - snow),
    rock: rock * (1 - water) * (1 - snow),
    snow: snow * (1 - water),
    wetland: wetland * (1 - water) * (1 - snow),
    water,
  });
  for (const [biome, value] of Object.entries(weights)) bundle.biomeWeights[biome][y][x] = value;
}

function climateZone(bundle, x, y, waterDistance) {
  const field = bundle.fields;
  if (field.water[y][x] > 0.45) return "W";
  if (field.snow[y][x] > 0.45) return "I";
  if (field.rockiness[y][x] > 0.68 && field.temperature[y][x] < 0.42) return "A";
  if (field.temperature[y][x] < 0.25 && field.vegetation[y][x] < 0.3) return "T";
  if (field.moisture[y][x] > 0.74 && field.slope[y][x] < 0.38) return "M";
  if (waterDistance <= 2 && field.moisture[y][x] > 0.48) return "R";
  if (field.rockiness[y][x] > 0.66 || field.slope[y][x] > 0.68) return "C";
  if (field.humidity[y][x] > 0.68 && field.vegetation[y][x] > 0.38 && field.temperature[y][x] > 0.3) return "Q";
  if (field.temperature[y][x] >= 0.22 && field.temperature[y][x] < 0.5 && field.vegetation[y][x] > 0.2) return "B";
  if (field.vegetation[y][x] > 0.48 && field.soil[y][x] > 0.4) return "F";
  if (field.moisture[y][x] < 0.33 && field.temperature[y][x] > 0.48) return "S";
  if (field.vegetation[y][x] > 0.3) return "G";
  return "H";
}

function tileElevation(heights, x, y) {
  return (heights[y][x] + heights[y][x + 1] + heights[y + 1][x] + heights[y + 1][x + 1]) * 0.25;
}

function distanceField(values, matches) {
  const rows = values.length;
  const cols = values[0].length;
  const distances = grid(rows, cols, Number.POSITIVE_INFINITY);
  const queue = [];
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    if (!matches(values[y][x])) continue;
    distances[y][x] = 0;
    queue.push({ x, y });
  }
  for (let head = 0; head < queue.length; head += 1) {
    const point = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = point.x + dx;
      const y = point.y + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows || distances[y][x] <= distances[point.y][point.x] + 1) continue;
      distances[y][x] = distances[point.y][point.x] + 1;
      queue.push({ x, y });
    }
  }
  return distances;
}

function normalizeWeights(input) {
  const entries = Object.entries(input);
  const total = entries.reduce((sum, [, value]) => sum + Math.max(0, value), 0) || 1;
  const result = Object.fromEntries(entries.map(([key, value]) => [key, round(Math.max(0, value) / total)]));
  const winner = entries.reduce((best, [key, value]) => value > best[1] ? [key, value] : best, entries[0])[0];
  result[winner] = round(result[winner] + 1 - Object.values(result).reduce((sum, value) => sum + value, 0));
  return result;
}

function grid(rows, cols, value) {
  return Array.from({ length: rows }, () => Array(cols).fill(value));
}
