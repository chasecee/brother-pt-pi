use serde_json::{json, Value};

fn parse_kb(line: &str) -> Option<u64> {
    line.trim().strip_suffix(" kB")?.trim().parse().ok()
}

pub fn linux_mem_mb() -> Option<Value> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let mut total_kb = None;
    let mut avail_kb = None;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            total_kb = parse_kb(rest);
        } else if let Some(rest) = line.strip_prefix("MemAvailable:") {
            avail_kb = parse_kb(rest);
        }
    }
    Some(json!({
        "total_mb": total_kb? / 1024,
        "avail_mb": avail_kb? / 1024,
    }))
}
