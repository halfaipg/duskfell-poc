use anyhow::anyhow;

use crate::protocol::SettlementReceiptSnapshot;

use super::SettlementJob;

const MAX_SETTLEMENT_ASSET_ID_BYTES: usize = 96;
const MAX_SETTLEMENT_REASON_BYTES: usize = 96;
const MAX_SETTLEMENT_STATUS_BYTES: usize = 160;
const MAX_SETTLEMENT_CHAIN_TX_BYTES: usize = 128;
const MAX_ACCOUNT_SUBJECT_BYTES: usize = 128;

pub(super) fn validate_job(job: &SettlementJob) -> anyhow::Result<()> {
    if let Some(account_subject) = &job.account_subject {
        validate_text_field(
            "settlement job accountSubject",
            account_subject,
            MAX_ACCOUNT_SUBJECT_BYTES,
        )?;
    }
    validate_tokenish_field(
        "settlement job assetId",
        &job.asset_id,
        MAX_SETTLEMENT_ASSET_ID_BYTES,
    )?;
    validate_text_field(
        "settlement job reason",
        &job.reason,
        MAX_SETTLEMENT_REASON_BYTES,
    )
}

pub(super) fn validate_receipt(receipt: &SettlementReceiptSnapshot) -> anyhow::Result<()> {
    if let Some(account_subject) = &receipt.account_subject {
        validate_text_field(
            "settlement receipt accountSubject",
            account_subject,
            MAX_ACCOUNT_SUBJECT_BYTES,
        )?;
    }
    validate_tokenish_field(
        "settlement receipt assetId",
        &receipt.asset_id,
        MAX_SETTLEMENT_ASSET_ID_BYTES,
    )?;
    validate_text_field(
        "settlement receipt status",
        &receipt.status,
        MAX_SETTLEMENT_STATUS_BYTES,
    )?;
    if let Some(chain_tx) = &receipt.chain_tx {
        validate_text_field(
            "settlement receipt chainTx",
            chain_tx,
            MAX_SETTLEMENT_CHAIN_TX_BYTES,
        )?;
    }
    Ok(())
}

fn validate_tokenish_field(field: &str, value: &str, max_bytes: usize) -> anyhow::Result<()> {
    validate_text_field(field, value, max_bytes)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        return Err(anyhow!(
            "{field} must contain only ASCII letters, digits, '-', '_', ':', or '.'"
        ));
    }
    Ok(())
}

fn validate_text_field(field: &str, value: &str, max_bytes: usize) -> anyhow::Result<()> {
    if value.trim().is_empty() {
        return Err(anyhow!("{field} must be non-empty"));
    }
    if value.trim() != value {
        return Err(anyhow!("{field} must not have surrounding whitespace"));
    }
    if value.len() > max_bytes {
        return Err(anyhow!("{field} must be at most {max_bytes} bytes"));
    }
    if !value.is_ascii() || value.chars().any(char::is_control) {
        return Err(anyhow!("{field} must be printable ASCII"));
    }
    Ok(())
}
