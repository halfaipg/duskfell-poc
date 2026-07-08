use crate::config::{
    parse_admission_backend_value, parse_bool_value, parse_deployment_profile_value,
    parse_persistence_backend_value, parse_positive_f32_value, parse_positive_u32_value,
    parse_positive_u64_value, parse_positive_usize_value, validate_supported_admission_backend,
    validate_supported_persistence_backend, AdmissionBackend, DeploymentProfile,
    PersistenceBackend,
};

#[test]
fn parses_boolean_env_values_strictly() {
    assert!(parse_bool_value("TEST_BOOL", "true").expect("true parses"));
    assert!(parse_bool_value("TEST_BOOL", "1").expect("1 parses"));
    assert!(!parse_bool_value("TEST_BOOL", "false").expect("false parses"));
    assert!(!parse_bool_value("TEST_BOOL", "0").expect("0 parses"));
    assert!(parse_bool_value("TEST_BOOL", "maybe").is_err());
}

#[test]
fn parses_deployment_profile_values() {
    assert_eq!(
        parse_deployment_profile_value("").expect("empty profile defaults local"),
        DeploymentProfile::Local
    );
    assert_eq!(
        parse_deployment_profile_value("local").expect("local parses"),
        DeploymentProfile::Local
    );
    assert_eq!(
        parse_deployment_profile_value("shared-poc").expect("shared-poc parses"),
        DeploymentProfile::SharedPoc
    );
    assert_eq!(
        parse_deployment_profile_value("production").expect("production parses"),
        DeploymentProfile::Production
    );
    assert!(parse_deployment_profile_value("prod").is_err());
}

#[test]
fn parses_and_guards_persistence_backend_values() {
    assert_eq!(
        parse_persistence_backend_value("").expect("empty backend defaults jsonl"),
        PersistenceBackend::Jsonl
    );
    assert_eq!(
        parse_persistence_backend_value("jsonl").expect("jsonl parses"),
        PersistenceBackend::Jsonl
    );
    assert_eq!(
        parse_persistence_backend_value("postgres").expect("postgres parses"),
        PersistenceBackend::Postgres
    );
    assert!(parse_persistence_backend_value("sqlite").is_err());
    assert!(validate_supported_persistence_backend(PersistenceBackend::Jsonl).is_ok());
    let postgres_err = validate_supported_persistence_backend(PersistenceBackend::Postgres)
        .expect_err("postgres backend remains reserved");
    let postgres_message = postgres_err.to_string();
    assert!(postgres_message.contains("PERSISTENCE_BACKEND=postgres"));
    assert!(postgres_message.contains("production database/event-store"));
    assert!(postgres_message.contains("PERSISTENCE_BACKEND=jsonl"));
}

#[test]
fn parses_and_guards_admission_backend_values() {
    assert_eq!(
        parse_admission_backend_value("").expect("empty backend defaults in-memory"),
        AdmissionBackend::InMemory
    );
    assert_eq!(
        parse_admission_backend_value("in-memory").expect("in-memory parses"),
        AdmissionBackend::InMemory
    );
    assert_eq!(
        parse_admission_backend_value("redis").expect("redis parses"),
        AdmissionBackend::Redis
    );
    assert!(parse_admission_backend_value("local").is_err());
    assert!(validate_supported_admission_backend(AdmissionBackend::InMemory).is_ok());
    let redis_err = validate_supported_admission_backend(AdmissionBackend::Redis)
        .expect_err("redis admission backend remains reserved");
    let redis_message = redis_err.to_string();
    assert!(redis_message.contains("ADMISSION_BACKEND=redis"));
    assert!(redis_message.contains("shared session/admission/rate-limit state"));
    assert!(redis_message.contains("ADMISSION_BACKEND=in-memory"));
}

#[test]
fn rejects_invalid_positive_integer_env_values() {
    assert_eq!(
        parse_positive_u64_value("TEST_U64", "42").expect("u64 parses"),
        42
    );
    assert_eq!(
        parse_positive_usize_value("TEST_USIZE", "7").expect("usize parses"),
        7
    );
    assert_eq!(
        parse_positive_u32_value("TEST_U32", "3").expect("u32 parses"),
        3
    );
    assert_eq!(
        parse_positive_f32_value("TEST_F32", "3.5").expect("f32 parses"),
        3.5
    );
    assert!(parse_positive_u64_value("TEST_U64", "0").is_err());
    assert!(parse_positive_u64_value("TEST_U64", "abc").is_err());
    assert!(parse_positive_usize_value("TEST_USIZE", "0").is_err());
    assert!(parse_positive_usize_value("TEST_USIZE", "abc").is_err());
    assert!(parse_positive_u32_value("TEST_U32", "0").is_err());
    assert!(parse_positive_u32_value("TEST_U32", "abc").is_err());
    assert!(parse_positive_f32_value("TEST_F32", "0").is_err());
    assert!(parse_positive_f32_value("TEST_F32", "NaN").is_err());
    assert!(parse_positive_f32_value("TEST_F32", "inf").is_err());
    assert!(parse_positive_f32_value("TEST_F32", "abc").is_err());
}
