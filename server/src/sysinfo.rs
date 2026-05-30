use serde_json::{json, Map, Value};

fn parse_kb(line: &str) -> Option<u64> {
    line.trim().strip_suffix(" kB")?.trim().parse().ok()
}

fn mem() -> Option<Value> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let mut total = None;
    let mut avail = None;
    for line in text.lines() {
        if let Some(r) = line.strip_prefix("MemTotal:") {
            total = parse_kb(r);
        } else if let Some(r) = line.strip_prefix("MemAvailable:") {
            avail = parse_kb(r);
        }
    }
    Some(json!({ "total_mb": total? / 1024, "avail_mb": avail? / 1024 }))
}

fn wifi() -> Option<Value> {
    let text = std::fs::read_to_string("/proc/net/wireless").ok()?;
    let line = text.lines().nth(2)?;
    let mut parts = line.split_whitespace();
    let iface = parts.next()?.trim_end_matches(':').to_string();
    let _status = parts.next()?;
    let _quality = parts.next()?;
    let level = parts.next()?.trim_end_matches('.');
    let signal_dbm: i32 = level.parse().ok()?;
    Some(json!({ "iface": iface, "signal_dbm": signal_dbm }))
}

fn temp_c() -> Option<f64> {
    let text = std::fs::read_to_string("/sys/class/thermal/thermal_zone0/temp").ok()?;
    let m: f64 = text.trim().parse().ok()?;
    Some(m / 1000.0)
}

fn uptime_s() -> Option<f64> {
    let text = std::fs::read_to_string("/proc/uptime").ok()?;
    text.split_whitespace().next()?.parse().ok()
}

pub fn linux_sysinfo() -> Map<String, Value> {
    let mut out = Map::new();
    if let Some(v) = mem() {
        out.insert("mem".into(), v);
    }
    if let Some(v) = wifi() {
        out.insert("wifi".into(), v);
    }
    if let Some(v) = temp_c() {
        out.insert("temp_c".into(), json!(v));
    }
    if let Some(v) = uptime_s() {
        out.insert("uptime_s".into(), json!(v));
    }
    out
}
