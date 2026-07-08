import { isNonEmptyString, isObject } from "./validation.js";

const ALLOWED_APPROVAL_STATES = new Set(["placeholder", "review", "approved", "rejected"]);
const ALLOWED_PROVENANCE_METHODS = new Set([
  "ai-generated",
  "hand-authored",
  "commissioned",
  "deterministic-local",
]);
const ALLOWED_TOOL_REVIEW_STATUSES = new Set(["approved-internal", "approved-production"]);
const DISALLOWED_CLEAN_ROOM_PROMPT_TERMS =
  /\b(ultima|uo|britain|moongate|broadsword|ea)\b/i;
const DISALLOWED_PROJECTION_PROMPT_TERMS =
  /\b(isometric|dimetric|64\s*x\s*32|128\s*x\s*64|2\s*:\s*1|rpg[-\s]?maker\s+iso|classic\s+iso)\b/i;
const DISALLOWED_COMMERCIAL_STYLE_PROMPT_TERMS =
  /\b(zelda|stardew|diablo|runescape|tibia|albion online|world of warcraft|warcraft)\b/i;
const QUARANTINED_TOOL_TERMS = [
  {
    pattern: /\b(chargen|antumdeluge\/chargen)\b/i,
    reason: "third-party base-art provenance risk",
  },
  {
    pattern: /\b(sheet-agent|subhad2218\/sheet-agent)\b/i,
    reason: "mis-tagged spreadsheet agent, not a sprite generator",
  },
  {
    pattern: /\b(svg-symbol-sprite|svg-spritify|astro-svgs|ngx-sprite)\b/i,
    reason: "SVG/icon spriter, not a raster game sprite generator",
  },
  {
    pattern: /\b(maartengr\/sprite-generator)\b/i,
    reason: "no-license/stale reference implementation",
  },
];

export function validateProvenance(provenance, approval, prefix, errors) {
  if (!isObject(provenance)) {
    errors.push(`${prefix}.provenance must be an object`);
    return;
  }

  if (provenance.cleanRoom !== true) {
    errors.push(`${prefix}.provenance.cleanRoom must be true`);
  }
  for (const key of ["source", "createdAt", "license", "reviewer"]) {
    if (!isNonEmptyString(provenance[key])) {
      errors.push(`${prefix}.provenance.${key} must be a non-empty string`);
    }
  }

  if (!isNonEmptyString(provenance.prompt)) {
    errors.push(`${prefix}.provenance.prompt must be a non-empty string`);
  } else {
    validatePromptText(provenance.prompt, `${prefix}.provenance.prompt`, errors);
  }

  if (
    provenance.negativePrompt !== undefined &&
    !isNonEmptyString(provenance.negativePrompt)
  ) {
    errors.push(`${prefix}.provenance.negativePrompt must be a non-empty string when present`);
  }
  if (
    typeof provenance.negativePrompt === "string" &&
    DISALLOWED_CLEAN_ROOM_PROMPT_TERMS.test(provenance.negativePrompt)
  ) {
    errors.push(
      `${prefix}.provenance.negativePrompt contains disallowed UO-derived reference terms`,
    );
  }

  const isPlaceholder = isObject(approval) && approval.state === "placeholder";
  if (isPlaceholder) return;

  if (!ALLOWED_PROVENANCE_METHODS.has(provenance.method)) {
    errors.push(
      `${prefix}.provenance.method must be one of ${[...ALLOWED_PROVENANCE_METHODS].join(", ")} for non-placeholder sheets`,
    );
  }

  for (const key of ["tool", "toolVersion", "sourceHash", "termsSnapshot"]) {
    if (!isNonEmptyString(provenance[key])) {
      errors.push(`${prefix}.provenance.${key} must be a non-empty string for non-placeholder sheets`);
    }
  }
  validateToolIdentity(provenance, prefix, errors);
  validateToolReview(provenance.toolReview, prefix, errors);

  if (provenance.method === "ai-generated") {
    for (const key of ["model", "modelVersion", "seed"]) {
      if (!isNonEmptyString(provenance[key]) && typeof provenance[key] !== "number") {
        errors.push(`${prefix}.provenance.${key} is required for AI-generated sheets`);
      }
    }
  }
}

function validateToolIdentity(provenance, prefix, errors) {
  const identity = [
    provenance.tool,
    provenance.source,
    provenance.termsSnapshot,
    provenance.toolReview?.sourceUrl,
  ]
    .filter((value) => typeof value === "string")
    .join(" ");

  for (const { pattern, reason } of QUARANTINED_TOOL_TERMS) {
    if (pattern.test(identity)) {
      errors.push(`${prefix}.provenance.tool is quarantined: ${reason}`);
    }
  }
}

function validateToolReview(toolReview, prefix, errors) {
  if (!isObject(toolReview)) {
    errors.push(
      `${prefix}.provenance.toolReview must record the reviewed generator/tool status for non-placeholder sheets`,
    );
    return;
  }

  if (!ALLOWED_TOOL_REVIEW_STATUSES.has(toolReview.status)) {
    errors.push(
      `${prefix}.provenance.toolReview.status must be one of ${[...ALLOWED_TOOL_REVIEW_STATUSES].join(", ")}`,
    );
  }
  for (const key of ["reviewedAt", "reviewer", "sourceUrl", "risk"]) {
    if (!isNonEmptyString(toolReview[key])) {
      errors.push(`${prefix}.provenance.toolReview.${key} must be a non-empty string`);
    }
  }
  if (isNonEmptyString(toolReview.sourceUrl)) {
    try {
      const url = new URL(toolReview.sourceUrl);
      if (!["http:", "https:"].includes(url.protocol)) {
        errors.push(`${prefix}.provenance.toolReview.sourceUrl must be http or https`);
      }
    } catch {
      errors.push(`${prefix}.provenance.toolReview.sourceUrl must be a valid URL`);
    }
  }
}

function validatePromptText(prompt, prefix, errors) {
  if (DISALLOWED_CLEAN_ROOM_PROMPT_TERMS.test(prompt)) {
    errors.push(`${prefix} contains disallowed UO-derived reference terms`);
  }
  if (DISALLOWED_PROJECTION_PROMPT_TERMS.test(prompt)) {
    errors.push(
      `${prefix} contains projection drift terms; use positive military-plan-oblique 1:1 language and put rejected defaults in negativePrompt`,
    );
  }
  if (DISALLOWED_COMMERCIAL_STYLE_PROMPT_TERMS.test(prompt)) {
    errors.push(`${prefix} contains commercial game/style reference terms`);
  }
}

export function validateApproval(approval, prefix, errors) {
  if (!isObject(approval)) {
    errors.push(`${prefix}.approval must be an object`);
    return;
  }

  if (!ALLOWED_APPROVAL_STATES.has(approval.state)) {
    errors.push(`${prefix}.approval.state must be one of ${[...ALLOWED_APPROVAL_STATES].join(", ")}`);
  }
  if (approval.state === "approved") {
    if (!isNonEmptyString(approval.reviewer)) {
      errors.push(`${prefix}.approval.reviewer is required for approved sheets`);
    }
    if (!isNonEmptyString(approval.approvedAt)) {
      errors.push(`${prefix}.approval.approvedAt is required for approved sheets`);
    }
  }
}
