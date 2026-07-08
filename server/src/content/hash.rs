pub(super) fn stable_content_hash(raw: &str) -> String {
    // FNV-1a: stable, tiny, and enough for an ops fingerprint. Not a security hash.
    let mut hash = 0xcbf29ce484222325u64;
    for byte in raw.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}")
}
