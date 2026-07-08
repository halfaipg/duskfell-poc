import {
  isObject,
  normalizeBoolean,
  normalizeNonNegativeInteger,
  normalizeText,
  normalizeUuid,
} from "./server-message-validators.js";

export function normalizeSettlement(settlement, prefix) {
  if (!isObject(settlement)) {
    throw new Error(`${prefix} must be an object`);
  }
  return {
    chainEnabled: normalizeBoolean(settlement.chainEnabled, `${prefix}.chainEnabled`),
    pendingJobs: normalizeNonNegativeInteger(settlement.pendingJobs, `${prefix}.pendingJobs`),
    confirmedJobs: normalizeNonNegativeInteger(settlement.confirmedJobs, `${prefix}.confirmedJobs`),
    ownedAssets: normalizeNonNegativeInteger(settlement.ownedAssets, `${prefix}.ownedAssets`),
    latestReceipt:
      settlement.latestReceipt == null
        ? null
        : normalizeReceipt(settlement.latestReceipt, `${prefix}.latestReceipt`),
  };
}

function normalizeReceipt(receipt, prefix) {
  if (!isObject(receipt)) {
    throw new Error(`${prefix} must be an object`);
  }
  return {
    jobId: normalizeUuid(receipt.jobId, `${prefix}.jobId`),
    playerId: normalizeUuid(receipt.playerId, `${prefix}.playerId`),
    accountSubject:
      receipt.accountSubject == null
        ? null
        : normalizeText(receipt.accountSubject, `${prefix}.accountSubject`),
    assetId: normalizeText(receipt.assetId, `${prefix}.assetId`),
    status: normalizeText(receipt.status, `${prefix}.status`),
    chainTx: receipt.chainTx == null ? null : normalizeText(receipt.chainTx, `${prefix}.chainTx`),
  };
}
