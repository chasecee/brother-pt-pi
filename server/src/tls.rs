use std::path::Path;

use anyhow::{Context, Result};
use axum_server::tls_rustls::RustlsConfig;

pub async fn load(data_dir: &Path) -> Result<RustlsConfig> {
    let dir = data_dir.join("tls");
    let cert_path = dir.join("leaf.pem");
    let key_path = dir.join("leaf.key.pem");
    RustlsConfig::from_pem_file(&cert_path, &key_path)
        .await
        .with_context(|| {
            format!(
                "load TLS cert from {}; first-boot openssl gen in init script should have created leaf.pem + leaf.key.pem",
                dir.display()
            )
        })
}
