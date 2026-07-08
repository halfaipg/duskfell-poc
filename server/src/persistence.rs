mod file_guard;
mod journal_loader;
mod jsonl;

#[cfg(test)]
mod tests;

pub use self::file_guard::{
    ensure_file_within_size, validate_distinct_durable_paths, DurableFileLock,
};
pub use self::journal_loader::load_journal_events;
pub use self::jsonl::{for_each_jsonl_line, JsonlEventWriter};

pub const DEFAULT_MAX_DURABLE_LINE_BYTES: usize = 256 * 1024;
