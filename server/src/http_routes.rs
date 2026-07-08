use axum::body::Body;
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderMap, HeaderName, HeaderValue, Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use uuid::Uuid;

const CONTENT_SECURITY_POLICY: &str = concat!(
    "default-src 'self'; ",
    "connect-src 'self' ws: wss:; ",
    "img-src 'self' data: blob:; ",
    "style-src 'self'; ",
    "script-src 'self'; ",
    "base-uri 'none'; ",
    "object-src 'none'; ",
    "frame-ancestors 'none'"
);

pub(crate) async fn add_http_hardening_headers(request: Request<Body>, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let has_hidden_segment = has_hidden_path_segment(&path);
    let request_id = request_id_header_value(request.headers());
    let mut response = if has_hidden_segment {
        StatusCode::NOT_FOUND.into_response()
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();

    headers.insert(HeaderName::from_static("x-request-id"), request_id);
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    headers.insert(
        HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );

    let cache_control = if path.starts_with("/assets/") && !has_hidden_segment {
        "public, max-age=60"
    } else {
        "no-store"
    };
    headers.insert(CACHE_CONTROL, HeaderValue::from_static(cache_control));

    response
}

pub(crate) fn has_hidden_path_segment(path: &str) -> bool {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .any(|segment| match segment.as_bytes() {
            [b'.', ..] => true,
            [b'%', high, low, ..] => {
                high.eq_ignore_ascii_case(&b'2') && low.eq_ignore_ascii_case(&b'e')
            }
            _ => false,
        })
}

fn request_id_header_value(headers: &HeaderMap) -> HeaderValue {
    if let Some(value) = headers
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| is_safe_request_id(value))
    {
        return HeaderValue::from_str(value).expect("validated request id is a header value");
    }

    HeaderValue::from_str(&Uuid::new_v4().to_string()).expect("uuid is a header value")
}

pub(crate) fn is_safe_request_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

pub(crate) fn sanitized_trace_path(uri: &axum::http::Uri) -> &str {
    let path = uri.path();
    if path.is_empty() {
        "/"
    } else {
        path
    }
}
