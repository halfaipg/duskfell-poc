import {
  ALLOWED_APPROVAL_STATES,
  DISALLOWED_CLEAN_ROOM_PROMPT_TERMS,
  DISALLOWED_COMMERCIAL_STYLE_PROMPT_TERMS,
  DISALLOWED_PROJECTION_PROMPT_TERMS,
} from "./constants.js";
import { isNonEmptyString, isObject } from "./validators.js";

export function validateProvenance(provenance, approval, errors) {
  if (!isObject(provenance)) {
    errors.push("provenance must be an object");
    return;
  }
  if (provenance.cleanRoom !== true) {
    errors.push("provenance.cleanRoom must be true");
  }
  for (const key of ["source", "createdAt", "license", "reviewer", "prompt"]) {
    if (!isNonEmptyString(provenance[key])) {
      errors.push(`provenance.${key} must be a non-empty string`);
    }
  }
  if (isNonEmptyString(provenance.prompt)) {
    validatePromptText(provenance.prompt, "provenance.prompt", errors);
  }

  const isPlaceholder = isObject(approval) && approval.state === "placeholder";
  if (isPlaceholder) return;

  for (const key of ["method", "tool", "toolVersion", "sourceHash", "termsSnapshot"]) {
    if (!isNonEmptyString(provenance[key])) {
      errors.push(`provenance.${key} must be a non-empty string for non-placeholder terrain`);
    }
  }
}

export function validateApproval(approval, errors) {
  if (!isObject(approval)) {
    errors.push("approval must be an object");
    return;
  }
  if (!ALLOWED_APPROVAL_STATES.has(approval.state)) {
    errors.push(`approval.state must be one of ${[...ALLOWED_APPROVAL_STATES].join(", ")}`);
  }
  if (approval.state === "approved") {
    if (!isNonEmptyString(approval.reviewer)) {
      errors.push("approval.reviewer is required for approved terrain");
    }
    if (!isNonEmptyString(approval.approvedAt)) {
      errors.push("approval.approvedAt is required for approved terrain");
    }
  }
}

function validatePromptText(prompt, prefix, errors) {
  if (DISALLOWED_CLEAN_ROOM_PROMPT_TERMS.test(prompt)) {
    errors.push(`${prefix} contains disallowed UO-derived reference terms`);
  }
  if (DISALLOWED_PROJECTION_PROMPT_TERMS.test(prompt)) {
    errors.push(`${prefix} contains projection drift terms`);
  }
  if (DISALLOWED_COMMERCIAL_STYLE_PROMPT_TERMS.test(prompt)) {
    errors.push(`${prefix} contains commercial game/style reference terms`);
  }
}
