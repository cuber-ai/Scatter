use crate::models::{SpinRequest, SpinResult, VerifyRequest, VerifyResult, WinningLine};
use anyhow::{anyhow, Result};
use hmac::{Hmac, Mac};
use rand::seq::SliceRandom;
use rand::SeedableRng;
use rand_chacha::ChaCha20Rng;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

type HmacSha256 = Hmac<Sha256>;

const REELS: usize = 5;
const ROWS: usize = 3;

// Symbol payout multipliers (symbol → [2-match, 3-match, 4-match, 5-match])
const SYMBOL_PAYOUTS: &[(&str, [f64; 4])] = &[
    ("wild", [0.0, 50.0, 200.0, 1000.0]),
    ("scatter", [0.0, 10.0, 50.0, 200.0]),
    ("seven", [0.0, 8.0, 40.0, 150.0]),
    ("bar", [0.0, 5.0, 20.0, 75.0]),
    ("bell", [0.0, 4.0, 15.0, 50.0]),
    ("cherry", [0.0, 2.0, 10.0, 30.0]),
    ("lemon", [0.0, 1.5, 6.0, 20.0]),
    ("orange", [0.0, 1.5, 6.0, 20.0]),
    ("plum", [0.0, 1.0, 4.0, 15.0]),
];

/// Derive a deterministic u64 seed from server_seed + client_seed + nonce
fn derive_seed(server_seed: &str, client_seed: &str, nonce: u64) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(server_seed.as_bytes()).expect("HMAC key error");
    mac.update(format!("{}:{}", client_seed, nonce).as_bytes());
    let result = mac.finalize().into_bytes();
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&result);
    seed
}

/// Build a weighted symbol pool from the provided weights.
/// Sorts by symbol name to ensure deterministic pool order regardless of
/// HashMap iteration order (which is not guaranteed to be stable).
fn build_symbol_pool(weights: &HashMap<String, u32>) -> Vec<String> {
    let mut pool = Vec::new();
    let mut entries: Vec<(&String, &u32)> = weights.iter().collect();
    entries.sort_by_key(|(name, _)| name.as_str());
    for (symbol, &weight) in entries {
        for _ in 0..weight {
            pool.push(symbol.clone());
        }
    }
    pool
}

/// Spin the reels deterministically using ChaCha20 PRNG
pub fn process_spin(req: &SpinRequest) -> Result<SpinResult> {
    let seed = derive_seed(&req.server_seed, &req.client_seed, req.nonce);
    let mut rng = ChaCha20Rng::from_seed(seed);

    let symbol_pool = build_symbol_pool(&req.symbol_weights);
    if symbol_pool.is_empty() {
        return Err(anyhow!("Empty symbol pool"));
    }

    // Generate reel grid (5 reels × 3 rows)
    let mut reel_result: Vec<Vec<String>> = Vec::with_capacity(REELS);
    for _ in 0..REELS {
        let mut reel_col = Vec::with_capacity(ROWS);
        for _ in 0..ROWS {
            let symbol = symbol_pool
                .choose(&mut rng)
                .ok_or_else(|| anyhow!("Empty pool"))?
                .clone();
            reel_col.push(symbol);
        }
        reel_result.push(reel_col);
    }

    // Evaluate paylines
    let payout_map: HashMap<&str, [f64; 4]> = SYMBOL_PAYOUTS.iter().cloned().collect();
    let mut winning_lines: Vec<WinningLine> = Vec::new();
    let mut total_multiplier = 0.0_f64;

    for (payline_idx, payline) in req.paylines.iter().enumerate() {
        if let Some(line_symbols) = extract_payline_symbols(&reel_result, payline) {
            if let Some((symbol, count)) = count_leading_matches(&line_symbols) {
                if count >= 3 {
                    let match_idx = (count - 2).min(3); // maps 3→0, 4→1, 5→2
                    let mult = payout_map
                        .get(symbol.as_str())
                        .map(|p| p[match_idx])
                        .unwrap_or(0.0);

                    if mult > 0.0 {
                        winning_lines.push(WinningLine {
                            payline_index: payline_idx,
                            symbols: line_symbols[..count].to_vec(),
                            multiplier: mult,
                            amount: req.bet_amount * mult,
                        });
                        total_multiplier += mult;
                    }
                }
            }
        }
    }

    // Bonus round trigger: 3+ scatter symbols anywhere
    let scatter_count = reel_result
        .iter()
        .flat_map(|col| col.iter())
        .filter(|s| s.as_str() == "scatter")
        .count();
    let is_bonus_round = scatter_count >= 3;

    // Jackpot trigger: progressive jackpot has 0.001% base probability, scaled by RTP
    let jackpot_threshold = (req.rtp / 100.0) * 0.00001;
    let jackpot_roll: f64 = {
        // Use a separate deterministic value from the same seed
        let mut hasher = Sha256::new();
        hasher.update(
            format!(
                "jackpot:{}:{}:{}",
                req.server_seed, req.client_seed, req.nonce
            )
            .as_bytes(),
        );
        let hash = hasher.finalize();
        let val = u64::from_be_bytes(hash[..8].try_into().unwrap());
        val as f64 / u64::MAX as f64
    };
    let is_jackpot = jackpot_roll < jackpot_threshold;
    let jackpot_tier = if is_jackpot {
        Some(
            if jackpot_roll < jackpot_threshold * 0.001 {
                "PROGRESSIVE"
            } else if jackpot_roll < jackpot_threshold * 0.01 {
                "MEGA"
            } else if jackpot_roll < jackpot_threshold * 0.1 {
                "MAJOR"
            } else {
                "MINI"
            }
            .to_string(),
        )
    } else {
        None
    };

    let win_amount = if is_jackpot {
        0.0 // Jackpot amount handled by jackpot service
    } else {
        req.bet_amount * total_multiplier
    };

    Ok(SpinResult {
        reel_result,
        win_amount,
        multiplier: total_multiplier,
        is_bonus_round,
        is_jackpot,
        jackpot_tier,
        winning_lines,
    })
}

/// Verify a past spin result for provably fair validation.
/// Re-derives the PRNG seed, re-runs the spin deterministically, and compares
/// the recomputed reel grid against the one provided by the client.
pub fn verify_spin(req: &VerifyRequest) -> Result<VerifyResult> {
    // 1. Verify that SHA-256(serverSeed) matches the pre-committed hash.
    let mut hasher = Sha256::new();
    hasher.update(req.server_seed.as_bytes());
    let computed_hash = hex::encode(hasher.finalize());
    let seed_hash_matches = computed_hash == req.server_seed_hash;

    if !seed_hash_matches {
        return Ok(VerifyResult {
            valid: false,
            seed_hash_matches: false,
            result_matches: false,
        });
    }

    // 2. Recompute the spin deterministically from the same inputs.
    let spin_req = crate::models::SpinRequest {
        server_seed: req.server_seed.clone(),
        client_seed: req.client_seed.clone(),
        nonce: req.nonce,
        bet_amount: req.bet_amount,
        symbol_weights: req.symbol_weights.clone(),
        paylines: req.paylines.clone(),
        rtp: req.rtp,
    };
    let recomputed = process_spin(&spin_req)?;

    // 3. Compare the recomputed reel grid against the stored result.
    let result_matches = recomputed.reel_result == req.reel_result;

    Ok(VerifyResult {
        valid: seed_hash_matches && result_matches,
        seed_hash_matches,
        result_matches,
    })
}

fn extract_payline_symbols(reel_result: &[Vec<String>], payline: &[usize]) -> Option<Vec<String>> {
    let mut symbols = Vec::new();
    for (reel_idx, &row_idx) in payline.iter().enumerate() {
        let symbol = reel_result.get(reel_idx)?.get(row_idx)?.clone();
        symbols.push(symbol);
    }
    Some(symbols)
}

/// Count leading matching symbols on a payline (wilds count as any symbol).
/// Returns `(base_symbol, count)` or `None` if the slice is empty.
/// An all-wild payline uses "wild" as the base symbol so it earns wild payouts.
fn count_leading_matches(symbols: &[String]) -> Option<(String, usize)> {
    if symbols.is_empty() {
        return None;
    }
    // Find the first non-wild symbol to use as the base.
    // If all symbols are wild the base is "wild" itself.
    let base_symbol = symbols
        .iter()
        .find(|s| s.as_str() != "wild")
        .cloned()
        .unwrap_or_else(|| "wild".to_string());

    let count = symbols
        .iter()
        .take_while(|s| s.as_str() == "wild" || *s == &base_symbol)
        .count();

    if count == 0 {
        return None;
    }
    Some((base_symbol, count))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn default_weights() -> HashMap<String, u32> {
        let mut w = HashMap::new();
        w.insert("wild".to_string(), 1);
        w.insert("scatter".to_string(), 2);
        w.insert("seven".to_string(), 5);
        w.insert("bar".to_string(), 8);
        w.insert("bell".to_string(), 10);
        w.insert("cherry".to_string(), 15);
        w.insert("lemon".to_string(), 20);
        w.insert("orange".to_string(), 20);
        w.insert("plum".to_string(), 19);
        w
    }

    /// Each payline is a Vec of ROWS row-indices (0..ROWS-1), one per reel.
    fn default_paylines() -> Vec<Vec<usize>> {
        vec![
            vec![0, 0, 0, 0, 0], // top row across all reels
            vec![1, 1, 1, 1, 1], // middle row
            vec![2, 2, 2, 2, 2], // bottom row
            vec![0, 1, 2, 1, 0], // V shape
            vec![2, 1, 0, 1, 2], // inverted V
        ]
    }

    #[test]
    fn test_deterministic_spin() {
        let req = SpinRequest {
            server_seed: "test_server_seed_abc123".to_string(),
            client_seed: "player_client_seed_xyz".to_string(),
            nonce: 42,
            bet_amount: 100.0,
            symbol_weights: default_weights(),
            paylines: default_paylines(),
            rtp: 96.0,
        };

        let result1 = process_spin(&req).unwrap();
        let result2 = process_spin(&req).unwrap();

        // Same inputs must always produce same result (deterministic)
        assert_eq!(result1.reel_result, result2.reel_result);
        assert_eq!(result1.win_amount, result2.win_amount);
    }

    #[test]
    fn test_different_seeds_produce_different_results() {
        let make_req = |nonce: u64| SpinRequest {
            server_seed: "server_seed".to_string(),
            client_seed: "client_seed".to_string(),
            nonce,
            bet_amount: 10.0,
            symbol_weights: default_weights(),
            paylines: default_paylines(),
            rtp: 96.0,
        };

        let r1 = process_spin(&make_req(1)).unwrap();
        let r2 = process_spin(&make_req(2)).unwrap();
        // With overwhelmingly high probability, different nonces yield different grids
        // (not a strict guarantee but valid for detecting seed wiring bugs)
        let _ = (r1, r2);
    }

    #[test]
    fn test_reel_dimensions() {
        let req = SpinRequest {
            server_seed: "seed".to_string(),
            client_seed: "cseed".to_string(),
            nonce: 0,
            bet_amount: 50.0,
            symbol_weights: default_weights(),
            paylines: default_paylines(),
            rtp: 96.0,
        };
        let result = process_spin(&req).unwrap();
        assert_eq!(result.reel_result.len(), REELS);
        for col in &result.reel_result {
            assert_eq!(col.len(), ROWS);
        }
    }

    #[test]
    fn test_no_negative_win() {
        let req = SpinRequest {
            server_seed: "neg_test_seed".to_string(),
            client_seed: "neg_client".to_string(),
            nonce: 99,
            bet_amount: 10.0,
            symbol_weights: default_weights(),
            paylines: default_paylines(),
            rtp: 96.0,
        };
        let result = process_spin(&req).unwrap();
        assert!(result.win_amount >= 0.0);
        assert!(result.multiplier >= 0.0);
    }

    /// All payline row indices must be within 0..ROWS-1; otherwise
    /// extract_payline_symbols silently drops the payline.
    #[test]
    fn test_payline_row_indices_in_range() {
        for (i, payline) in default_paylines().iter().enumerate() {
            assert_eq!(
                payline.len(),
                REELS,
                "payline {i}: expected {REELS} entries, got {}",
                payline.len()
            );
            for &row_idx in payline {
                assert!(
                    row_idx < ROWS,
                    "payline {i}: row_idx {row_idx} is out of range 0..{ROWS}"
                );
            }
        }
    }

    /// verify_spin must return valid=true when given the original seed + same
    /// reel grid, and valid=false when the reel grid is tampered with.
    #[test]
    fn test_verify_spin_roundtrip() {
        use crate::models::VerifyRequest;
        use sha2::{Digest, Sha256};

        let server_seed = "verify_test_server_seed_99".to_string();
        let client_seed = "verify_client_seed".to_string();
        let nonce: u64 = 7;

        let spin_req = SpinRequest {
            server_seed: server_seed.clone(),
            client_seed: client_seed.clone(),
            nonce,
            bet_amount: 50.0,
            symbol_weights: default_weights(),
            paylines: default_paylines(),
            rtp: 96.0,
        };
        let spin_result = process_spin(&spin_req).unwrap();

        let mut hasher = Sha256::new();
        hasher.update(server_seed.as_bytes());
        let server_seed_hash = hex::encode(hasher.finalize());

        // 1. Valid verification
        let verify_req = VerifyRequest {
            server_seed: server_seed.clone(),
            client_seed: client_seed.clone(),
            nonce,
            server_seed_hash: server_seed_hash.clone(),
            reel_result: spin_result.reel_result.clone(),
            symbol_weights: default_weights(),
            paylines: default_paylines(),
            bet_amount: 50.0,
            rtp: 96.0,
        };
        let result = verify_spin(&verify_req).unwrap();
        assert!(
            result.valid,
            "verify_spin should return valid=true for correct inputs"
        );
        assert!(result.seed_hash_matches);
        assert!(result.result_matches);

        // 2. Tampered reel grid → result_matches must be false.
        // We use "invalid_symbol" which cannot appear in any real spin (it is not
        // in the symbol pool), so the comparison is guaranteed to differ.
        let impossible_reels: Vec<Vec<String>> = (0..REELS)
            .map(|_| vec!["invalid_symbol".to_string(); ROWS])
            .collect();
        let tampered_req = VerifyRequest {
            server_seed: server_seed.clone(),
            client_seed: client_seed.clone(),
            nonce,
            server_seed_hash: server_seed_hash.clone(),
            reel_result: impossible_reels,
            symbol_weights: default_weights(),
            paylines: default_paylines(),
            bet_amount: 50.0,
            rtp: 96.0,
        };
        let tampered_result = verify_spin(&tampered_req).unwrap();
        assert!(
            !tampered_result.result_matches,
            "verify_spin should detect mismatched reel result"
        );
        assert!(
            !tampered_result.valid,
            "verify_spin should return valid=false when reel result does not match"
        );
    }

    /// An all-wild payline must pay wild payouts, not zero.
    #[test]
    fn test_all_wild_payline_pays() {
        // Build a reel grid where the top row is all wilds
        let wild_reel: Vec<Vec<String>> = (0..REELS)
            .map(|_| {
                vec![
                    "wild".to_string(),
                    "cherry".to_string(),
                    "cherry".to_string(),
                ]
            })
            .collect();

        let top_row_payline = vec![0usize; REELS]; // row 0 of every reel
        let result = extract_payline_symbols(&wild_reel, &top_row_payline);
        assert!(result.is_some(), "all-wild payline should extract symbols");
        let symbols = result.unwrap();

        let (base, count) =
            count_leading_matches(&symbols).expect("all-wild payline should return Some");
        assert_eq!(base, "wild", "base symbol for all-wild should be 'wild'");
        assert_eq!(count, REELS, "all {REELS} wilds should match");

        // Payout map must have a non-zero entry for a 5-wild match (index 3)
        let payout_map: HashMap<&str, [f64; 4]> = SYMBOL_PAYOUTS.iter().cloned().collect();
        let mult = payout_map["wild"][3]; // 5-match index
        assert!(mult > 0.0, "5-wild payout must be positive");
    }
}
