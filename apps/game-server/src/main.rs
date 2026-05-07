use actix_web::{web, App, HttpServer, HttpResponse, HttpRequest, middleware};
use dotenvy::dotenv;
use tracing_subscriber::EnvFilter;

mod engine;
mod models;
mod auth;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .json()
        .init();

    let port: u16 = std::env::var("GAME_SERVER_PORT")
        .unwrap_or_else(|_| "9001".to_string())
        .parse()
        .expect("Invalid GAME_SERVER_PORT");

    tracing::info!("🎰 ScatterX Game Server starting on port {}", port);

    HttpServer::new(|| {
        App::new()
            .wrap(middleware::Logger::default())
            .route("/health", web::get().to(health_handler))
            .service(
                web::scope("/api")
                    .wrap(auth::ApiKeyMiddleware)
                    .route("/spin", web::post().to(spin_handler))
                    .route("/verify", web::post().to(verify_handler)),
            )
            .default_service(web::to(|| async {
                actix_web::HttpResponse::NotFound()
                    .json(serde_json::json!({ "error": "Not found" }))
            }))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}

async fn health_handler() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": "game-server",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

async fn spin_handler(
    _req: HttpRequest,
    body: web::Json<models::SpinRequest>,
) -> HttpResponse {
    match engine::process_spin(&body) {
        Ok(result) => HttpResponse::Ok().json(result),
        Err(e) => {
            tracing::error!("Spin processing error: {:?}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Spin processing failed"
            }))
        }
    }
}

async fn verify_handler(
    body: web::Json<models::VerifyRequest>,
) -> HttpResponse {
    match engine::verify_spin(&body) {
        Ok(result) => HttpResponse::Ok().json(result),
        Err(e) => {
            tracing::error!("Verify error: {:?}", e);
            HttpResponse::BadRequest().json(serde_json::json!({
                "error": e.to_string()
            }))
        }
    }
}
