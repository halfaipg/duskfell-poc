use std::fmt::Write;

use super::AppMetrics;

mod admission;
mod durability;
mod websocket;

pub(super) fn render(metrics: &AppMetrics) -> String {
    let mut output = String::new();
    websocket::write_websocket_metrics(&mut output, metrics);
    admission::write_admission_metrics(&mut output, metrics);
    durability::write_durability_metrics(&mut output, metrics);
    output
}

pub(super) fn write_metric(
    output: &mut String,
    name: &str,
    help: &str,
    metric_type: &str,
    value: u64,
) {
    let _ = writeln!(output, "# HELP {name} {help}");
    let _ = writeln!(output, "# TYPE {name} {metric_type}");
    let _ = writeln!(output, "{name} {value}");
}
