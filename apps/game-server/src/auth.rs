use actix_web::{
    body::BoxBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    Error,
};
use std::future::{ready, Future, Ready};
use std::pin::Pin;

pub struct ApiKeyMiddleware;

impl<S> Transform<S, ServiceRequest> for ApiKeyMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<BoxBody>, Error = Error>,
    S::Future: 'static,
{
    type Response = ServiceResponse<BoxBody>;
    type Error = Error;
    type InitError = ();
    type Transform = ApiKeyMiddlewareService<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(ApiKeyMiddlewareService { service }))
    }
}

pub struct ApiKeyMiddlewareService<S> {
    service: S,
}

impl<S> Service<ServiceRequest> for ApiKeyMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<BoxBody>, Error = Error>,
    S::Future: 'static,
{
    type Response = ServiceResponse<BoxBody>;
    type Error = Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>>>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let expected_key = std::env::var("GAME_SERVER_API_KEY").unwrap_or_default();
        let auth_header = req
            .headers()
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let token = auth_header.strip_prefix("Bearer ").unwrap_or("");

        if expected_key.is_empty() || token != expected_key {
            let response = actix_web::HttpResponse::Unauthorized()
                .json(serde_json::json!({ "error": "Unauthorized" }));
            let (http_req, _payload) = req.into_parts();
            let resp = ServiceResponse::new(http_req, response);
            return Box::pin(async move { Ok(resp) });
        }

        let fut = self.service.call(req);
        Box::pin(async move {
            let res = fut.await?;
            Ok(res)
        })
    }
}
