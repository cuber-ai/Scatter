package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Server struct {
	router *chi.Mux
	rdb    *redis.Client
	logger *zap.Logger
}

func main() {
	_ = godotenv.Load()

	logger, _ := zap.NewProduction()
	defer logger.Sync()

	rdb := redis.NewClient(&redis.Options{
		Addr: parseRedisAddr(getEnv("REDIS_URL", "localhost:6379")),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.Fatal("Failed to connect to Redis", zap.Error(err))
	}
	logger.Info("Connected to Redis")

	srv := &Server{
		router: chi.NewRouter(),
		rdb:    rdb,
		logger: logger,
	}
	srv.setupRoutes()

	port := getEnv("JACKPOT_SERVICE_PORT", "9000")
	httpSrv := &http.Server{
		Addr:         ":" + port,
		Handler:      srv.router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("🎯 Jackpot Service starting", zap.String("port", port))
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("Server error", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel = context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil {
		logger.Error("Graceful shutdown failed", zap.Error(err))
	}
	logger.Info("Jackpot service stopped")
}

func (s *Server) setupRoutes() {
	s.router.Use(middleware.Logger)
	s.router.Use(middleware.Recoverer)
	s.router.Use(middleware.RequestID)
	s.router.Use(apiKeyAuth(getEnv("JACKPOT_SERVICE_API_KEY", "")))

	s.router.Get("/health", s.healthHandler)
	s.router.Get("/pools", s.getPoolsHandler)
	s.router.Post("/contribute", s.contributeHandler)
	s.router.Post("/trigger", s.triggerJackpotHandler)
}

func (s *Server) healthHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	redisOk := s.rdb.Ping(ctx).Err() == nil
	status := "ok"
	if !redisOk {
		status = "degraded"
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  status,
		"service": "jackpot-service",
	})
}

type ContributeRequest struct {
	Tier       string  `json:"tier"`
	Amount     float64 `json:"amount"`
	SpinID     string  `json:"spinId"`
}

type TriggerRequest struct {
	Tier   string `json:"tier"`
	UserID string `json:"userId"`
	SpinID string `json:"spinId"`
}

func (s *Server) getPoolsHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tiers := []string{"MINI", "MAJOR", "MEGA", "PROGRESSIVE"}
	pools := make([]map[string]interface{}, 0, len(tiers))

	for _, tier := range tiers {
		key := "jackpot:" + tier
		val, err := s.rdb.Get(ctx, key).Float64()
		if err != nil {
			val = 0
		}
		pools = append(pools, map[string]interface{}{
			"tier":          tier,
			"currentAmount": val,
			"currency":      "PHP",
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"pools": pools})
}

func (s *Server) contributeHandler(w http.ResponseWriter, r *http.Request) {
	var req ContributeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	validTiers := map[string]bool{"MINI": true, "MAJOR": true, "MEGA": true, "PROGRESSIVE": true}
	if !validTiers[req.Tier] {
		http.Error(w, "invalid tier", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	key := "jackpot:" + req.Tier

	// Atomic increment – safe for distributed systems
	newVal, err := s.rdb.IncrByFloat(ctx, key, req.Amount).Result()
	if err != nil {
		s.logger.Error("Redis increment failed", zap.Error(err))
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tier":      req.Tier,
		"newAmount": newVal,
	})
}

func (s *Server) triggerJackpotHandler(w http.ResponseWriter, r *http.Request) {
	var req TriggerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	key := "jackpot:" + req.Tier
	lockKey := "jackpot:lock:" + req.Tier

	// Distributed lock – prevent duplicate payouts
	locked, err := s.rdb.SetNX(ctx, lockKey, "1", 30*time.Second).Result()
	if err != nil || !locked {
		http.Error(w, "jackpot payout in progress or lock failed", http.StatusConflict)
		return
	}
	defer s.rdb.Del(ctx, lockKey)

	// Get current pool amount
	amount, err := s.rdb.Get(ctx, key).Float64()
	if err != nil {
		http.Error(w, "pool not found", http.StatusNotFound)
		return
	}

	// Determine base (reset) amount per tier
	baseAmounts := map[string]float64{
		"MINI":        1000,
		"MAJOR":       50000,
		"MEGA":        500000,
		"PROGRESSIVE": 1000000,
	}
	base := baseAmounts[req.Tier]

	// Reset pool to base value
	if err := s.rdb.Set(ctx, key, base, 0).Err(); err != nil {
		s.logger.Error("Failed to reset jackpot pool", zap.Error(err))
		http.Error(w, "reset failed", http.StatusInternalServerError)
		return
	}

	s.logger.Info("Jackpot triggered",
		zap.String("tier", req.Tier),
		zap.String("userId", req.UserID),
		zap.Float64("amount", amount),
	)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tier":       req.Tier,
		"amount":     amount,
		"userId":     req.UserID,
		"spinId":     req.SpinID,
		"resetTo":    base,
		"triggeredAt": time.Now().UTC(),
	})
}

func apiKeyAuth(expectedKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip auth for health endpoint
			if r.URL.Path == "/health" {
				next.ServeHTTP(w, r)
				return
			}
			auth := r.Header.Get("Authorization")
			token := ""
			if len(auth) > 7 && auth[:7] == "Bearer " {
				token = auth[7:]
			}
			if expectedKey == "" || token != expectedKey {
				http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("JSON encode error: %v", err)
	}
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

// parseRedisAddr accepts both "redis://host:port[/db]" URL format and plain
// "host:port" address strings, returning a host:port suitable for go-redis.
func parseRedisAddr(redisURL string) string {
	if strings.HasPrefix(redisURL, "redis://") || strings.HasPrefix(redisURL, "rediss://") {
		u, err := url.Parse(redisURL)
		if err == nil && u.Host != "" {
			return u.Host
		}
	}
	return redisURL
}
