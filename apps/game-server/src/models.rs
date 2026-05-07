use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpinRequest {
    pub server_seed: String,
    pub client_seed: String,
    pub nonce: u64,
    pub bet_amount: f64,
    pub symbol_weights: HashMap<String, u32>,
    pub paylines: Vec<Vec<usize>>,
    pub rtp: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpinResult {
    pub reel_result: Vec<Vec<String>>,
    pub win_amount: f64,
    pub multiplier: f64,
    pub is_bonus_round: bool,
    pub is_jackpot: bool,
    pub jackpot_tier: Option<String>,
    pub winning_lines: Vec<WinningLine>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WinningLine {
    pub payline_index: usize,
    pub symbols: Vec<String>,
    pub multiplier: f64,
    pub amount: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct VerifyRequest {
    pub server_seed: String,
    pub client_seed: String,
    pub nonce: u64,
    pub server_seed_hash: String,
    pub reel_result: Vec<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub valid: bool,
    pub seed_hash_matches: bool,
    pub result_matches: bool,
}
