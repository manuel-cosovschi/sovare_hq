//! Outbound HTTP. All network access from the app goes through these two commands, so the
//! webview CSP can forbid direct connections.
//! - `http_secure`: injects a Keychain credential, HTTPS only, host must be allow-listed for
//!   that credential, no redirects (a redirect could leak the token to another host).
//! - `http_public`: unauthenticated requests (health checks, public FX rates, local LLMs).

use crate::error::{CmdError, CmdResult};
use crate::secrets::{allowed_hosts, get_secret};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Deserialize)]
pub struct SecureRequest {
    secret: String,
    method: String,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
pub struct PublicRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
    latency_ms: u128,
}

const MAX_BODY: usize = 20 * 1024 * 1024;
const USER_AGENT: &str = "SovareHQ/0.1 (+local desktop app)";

fn method(m: &str, allowed: &[&str]) -> CmdResult<reqwest::Method> {
    let up = m.to_ascii_uppercase();
    if !allowed.contains(&up.as_str()) {
        return Err(CmdError::new("method_not_allowed", format!("method {up} not allowed")));
    }
    reqwest::Method::from_bytes(up.as_bytes()).map_err(|e| CmdError::new("method", e.to_string()))
}

fn is_forbidden_header(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    matches!(n.as_str(), "authorization" | "x-api-key" | "cookie" | "host" | "proxy-authorization")
}

async fn send(req: reqwest::RequestBuilder, started: Instant) -> CmdResult<HttpResponse> {
    let resp = req.send().await.map_err(|e| {
        let code = if e.is_timeout() { "timeout" } else if e.is_connect() { "connect" } else { "network" };
        // reqwest errors may contain the URL but never headers, so no secret leaks here.
        CmdError::new(code, e.without_url().to_string())
    })?;
    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(s) = v.to_str() {
            headers.insert(k.as_str().to_string(), s.to_string());
        }
    }
    let bytes = resp.bytes().await.map_err(|e| CmdError::new("network", e.without_url().to_string()))?;
    if bytes.len() > MAX_BODY {
        return Err(CmdError::new("too_large", "response body too large"));
    }
    Ok(HttpResponse {
        status,
        headers,
        body: String::from_utf8_lossy(&bytes).into_owned(),
        latency_ms: started.elapsed().as_millis(),
    })
}

/// Validates that a credential may be sent to `raw_url` (HTTPS + allow-listed host, no userinfo).
pub(crate) fn check_secure_url(secret: &str, raw_url: &str) -> CmdResult<url::Url> {
    let hosts = allowed_hosts(secret).ok_or_else(|| CmdError::new("invalid_secret_key", "unknown credential slot"))?;
    let url = url::Url::parse(raw_url).map_err(|_| CmdError::new("invalid_url", "invalid URL"))?;
    if url.scheme() != "https" {
        return Err(CmdError::new("insecure_url", "credentials are only sent over HTTPS"));
    }
    if !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return Err(CmdError::new("invalid_url", "unexpected userinfo or port"));
    }
    let host = url.host_str().unwrap_or_default();
    if !hosts.contains(&host) {
        return Err(CmdError::new("host_not_allowed", format!("host {host} is not allowed for this credential")));
    }
    Ok(url)
}

#[tauri::command]
pub async fn http_secure(req: SecureRequest) -> CmdResult<HttpResponse> {
    let url = check_secure_url(&req.secret, &req.url)?;
    let token = get_secret(&req.secret)?.ok_or_else(|| CmdError::new("missing_credential", "no credential stored for this integration"))?;
    let m = method(&req.method, &["GET", "POST", "HEAD"])?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(req.timeout_ms.unwrap_or(30_000).min(120_000)))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| CmdError::new("client", e.to_string()))?;
    let mut rb = client.request(m, url);
    for (k, v) in &req.headers {
        if !is_forbidden_header(k) {
            rb = rb.header(k, v);
        }
    }
    rb = match req.secret.as_str() {
        "anthropic" => rb.header("x-api-key", token),
        _ => rb.bearer_auth(token),
    };
    if let Some(b) = req.body {
        rb = rb.body(b);
    }
    send(rb, Instant::now()).await
}

#[tauri::command]
pub async fn http_public(req: PublicRequest) -> CmdResult<HttpResponse> {
    let url = url::Url::parse(&req.url).map_err(|_| CmdError::new("invalid_url", "invalid URL"))?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(CmdError::new("invalid_scheme", "only http(s) URLs are allowed"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(CmdError::new("invalid_url", "URLs with embedded credentials are not allowed"));
    }
    let m = method(&req.method, &["GET", "HEAD", "POST"])?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_millis(req.timeout_ms.unwrap_or(15_000).min(120_000)))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| CmdError::new("client", e.to_string()))?;
    let mut rb = client.request(m, url);
    for (k, v) in &req.headers {
        if !is_forbidden_header(k) {
            rb = rb.header(k, v);
        }
    }
    if let Some(b) = req.body {
        rb = rb.body(b);
    }
    send(rb, Instant::now()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_only_go_to_allowlisted_https_hosts() {
        assert!(check_secure_url("github", "https://api.github.com/user").is_ok());
        assert_eq!(check_secure_url("github", "http://api.github.com/user").unwrap_err().code, "insecure_url");
        assert_eq!(check_secure_url("github", "https://evil.example/user").unwrap_err().code, "host_not_allowed");
        assert_eq!(check_secure_url("github", "https://api.github.com.evil.example/").unwrap_err().code, "host_not_allowed");
        assert_eq!(check_secure_url("github", "https://api.stripe.com/v1/balance").unwrap_err().code, "host_not_allowed");
        assert_eq!(check_secure_url("github", "https://x:y@api.github.com/").unwrap_err().code, "invalid_url");
        assert_eq!(check_secure_url("unknown", "https://api.github.com/").unwrap_err().code, "invalid_secret_key");
    }

    #[test]
    fn auth_headers_cannot_be_overridden_by_the_webview() {
        for h in ["Authorization", "x-api-key", "Cookie", "HOST"] {
            assert!(is_forbidden_header(h));
        }
        assert!(!is_forbidden_header("Accept"));
    }

    #[test]
    fn only_expected_methods_are_allowed() {
        assert!(method("get", &["GET"]).is_ok());
        assert!(method("DELETE", &["GET", "POST"]).is_err());
    }
}
