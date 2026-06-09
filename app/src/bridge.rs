use serde::Serialize;
use serde_json::{json, Value};

pub struct BridgeClient {
    base_url: String,
    client: reqwest::Client,
}

#[derive(Serialize)]
pub struct BridgePrintLabel {
    pub png_b64: String,
    pub qty: u32,
}

impl BridgeClient {
    pub fn from_env() -> Self {
        let base_url = std::env::var("BRIDGE_URL")
            .ok()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "http://bridge.local:7777".to_string());
        Self {
            base_url,
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .expect("failed to build bridge http client"),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn status(&self) -> Result<Value, String> {
        self.get_json("/status").await
    }

    pub async fn media(&self) -> Result<Value, String> {
        self.get_json("/media").await
    }

    pub async fn print(&self, labels: &[BridgePrintLabel]) -> Result<Value, String> {
        let body = json!({ "labels": labels });
        let url = format!("{}/print", self.base_url);
        let resp = self
            .client
            .post(url)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status();
        let body: Value = resp.json().await.map_err(|e| e.to_string())?;
        if status.is_success() {
            Ok(body)
        } else {
            let err = body
                .get("err")
                .and_then(|v| v.as_str())
                .unwrap_or("bridge print failed");
            Err(err.to_string())
        }
    }

    async fn get_json(&self, path: &str) -> Result<Value, String> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.client.get(url).send().await.map_err(|e| e.to_string())?;
        let status = resp.status();
        let body: Value = resp.json().await.map_err(|e| e.to_string())?;
        if status.is_success() {
            Ok(body)
        } else {
            let err = body
                .get("err")
                .and_then(|v| v.as_str())
                .unwrap_or("bridge request failed");
            Err(err.to_string())
        }
    }
}
