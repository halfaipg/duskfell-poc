use crate::config::{
    parse_origin_allowlist_value, validate_websocket_timing, MAX_ALLOWED_ORIGINS, MAX_ORIGIN_BYTES,
};

#[test]
fn rejects_idle_timeout_not_greater_than_heartbeat() {
    assert!(validate_websocket_timing(30, 180).is_ok());
    assert!(validate_websocket_timing(30, 30).is_err());
    assert!(validate_websocket_timing(30, 29).is_err());
}

#[test]
fn parses_origin_allowlist_values() {
    let config = parse_origin_allowlist_value(
        "https://game.example, http://localhost:4107, https://game.example",
    )
    .expect("origin allowlist parses");

    assert!(config.enabled());
    assert_eq!(config.allowed_count(), 2);
    assert!(config.allows("https://game.example"));
    assert!(config.allows("http://localhost:4107"));
    assert!(!config.allows("https://other.example"));
}

#[test]
fn empty_origin_allowlist_disables_origin_checks() {
    let config = parse_origin_allowlist_value(" ").expect("empty allowlist parses");

    assert!(!config.enabled());
    assert_eq!(config.allowed_count(), 0);
}

#[test]
fn rejects_non_origin_allowlist_entries() {
    assert!(parse_origin_allowlist_value("game.example").is_err());
    assert!(parse_origin_allowlist_value("ftp://game.example").is_err());
    assert!(parse_origin_allowlist_value("https://").is_err());
    assert!(parse_origin_allowlist_value("https://game.example/path").is_err());
    assert!(parse_origin_allowlist_value("https://game.example?debug=true").is_err());
    assert!(parse_origin_allowlist_value("https://game.example#fragment").is_err());
    assert!(
        parse_origin_allowlist_value(&format!("https://{}", "a".repeat(MAX_ORIGIN_BYTES))).is_err()
    );
    assert!(parse_origin_allowlist_value(
        &(0..=MAX_ALLOWED_ORIGINS)
            .map(|index| format!("https://game-{index}.example"))
            .collect::<Vec<_>>()
            .join(","),
    )
    .is_err());
}
