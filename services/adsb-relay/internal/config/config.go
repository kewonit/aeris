package config

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ListenAddr               string
	DataDir                  string
	ReadsbURL                string
	ProviderID               string
	ProviderLabel            string
	AttributionURL           string
	AllowedOrigins           map[string]struct{}
	TicketPublicKey          ed25519.PublicKey
	HTTPToken                string
	PollInterval             time.Duration
	SourceStaleAfter         time.Duration
	AircraftExpiry           time.Duration
	HistoryWindow            time.Duration
	RetentionWindow          time.Duration
	SegmentDuration          time.Duration
	LatenessGrace            time.Duration
	MaxSourceBodyBytes       int64
	MaxBBoxAreaDegrees       float64
	MaxRadiusNM              float64
	MaxCurrentAircraft       int
	MaxResponseAircraft      int
	MaxHistoryPoints         int
	MaxConnections           int
	SocketQueueDepth         int
	MaxSubscriptionChanges   int
	BlockCacheEntries        int
	EmergencyHistoryBytes    int64
	GracefulShutdownDuration time.Duration
}

func Load() (Config, error) {
	return load(os.LookupEnv)
}

func load(lookup func(string) (string, bool)) (Config, error) {
	config := Config{
		ListenAddr:               value(lookup, "RELAY_LISTEN_ADDR", ":8080"),
		DataDir:                  value(lookup, "RELAY_DATA_DIR", "./data"),
		ReadsbURL:                strings.TrimSpace(value(lookup, "RELAY_READSB_URL", "")),
		ProviderID:               strings.TrimSpace(value(lookup, "RELAY_PROVIDER_ID", "unconfigured")),
		ProviderLabel:            strings.TrimSpace(value(lookup, "RELAY_PROVIDER_LABEL", "")),
		AttributionURL:           strings.TrimSpace(value(lookup, "RELAY_ATTRIBUTION_URL", "")),
		HTTPToken:                strings.TrimSpace(value(lookup, "RELAY_HTTP_TOKEN", "")),
		PollInterval:             durationValue(lookup, "RELAY_POLL_INTERVAL", time.Second),
		SourceStaleAfter:         durationValue(lookup, "RELAY_SOURCE_STALE_AFTER", 10*time.Second),
		AircraftExpiry:           durationValue(lookup, "RELAY_AIRCRAFT_EXPIRY", 90*time.Second),
		HistoryWindow:            durationValue(lookup, "RELAY_HISTORY_WINDOW", time.Hour),
		RetentionWindow:          durationValue(lookup, "RELAY_RETENTION_WINDOW", 65*time.Minute),
		SegmentDuration:          durationValue(lookup, "RELAY_SEGMENT_DURATION", 5*time.Minute),
		LatenessGrace:            durationValue(lookup, "RELAY_LATENESS_GRACE", 10*time.Second),
		MaxSourceBodyBytes:       int64Value(lookup, "RELAY_MAX_SOURCE_BODY_BYTES", 16<<20),
		MaxBBoxAreaDegrees:       floatValue(lookup, "RELAY_MAX_BBOX_AREA_DEGREES", 100),
		MaxRadiusNM:              floatValue(lookup, "RELAY_MAX_RADIUS_NM", 250),
		MaxCurrentAircraft:       intValue(lookup, "RELAY_MAX_CURRENT_AIRCRAFT", 50_000),
		MaxResponseAircraft:      intValue(lookup, "RELAY_MAX_RESPONSE_AIRCRAFT", 2500),
		MaxHistoryPoints:         intValue(lookup, "RELAY_MAX_HISTORY_POINTS", 2000),
		MaxConnections:           intValue(lookup, "RELAY_MAX_CONNECTIONS", 256),
		SocketQueueDepth:         intValue(lookup, "RELAY_SOCKET_QUEUE_DEPTH", 8),
		MaxSubscriptionChanges:   intValue(lookup, "RELAY_MAX_SUBSCRIPTION_CHANGES", 30),
		BlockCacheEntries:        intValue(lookup, "RELAY_BLOCK_CACHE_ENTRIES", 32),
		EmergencyHistoryBytes:    int64Value(lookup, "RELAY_MAX_HISTORY_BYTES", 0),
		GracefulShutdownDuration: durationValue(lookup, "RELAY_SHUTDOWN_GRACE", 10*time.Second),
	}

	origins, err := parseOrigins(value(lookup, "RELAY_ALLOWED_ORIGINS", ""))
	if err != nil {
		return Config{}, err
	}
	config.AllowedOrigins = origins

	publicKey, err := parsePublicKey(value(lookup, "RELAY_TICKET_PUBLIC_KEY", ""))
	if err != nil {
		return Config{}, err
	}
	config.TicketPublicKey = publicKey

	if err := config.Validate(); err != nil {
		return Config{}, err
	}
	return config, nil
}

func (c Config) Validate() error {
	if strings.TrimSpace(c.ListenAddr) == "" {
		return errors.New("RELAY_LISTEN_ADDR cannot be empty")
	}
	if strings.TrimSpace(c.DataDir) == "" {
		return errors.New("RELAY_DATA_DIR cannot be empty")
	}
	if c.ReadsbURL != "" {
		parsed, err := url.Parse(c.ReadsbURL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return errors.New("RELAY_READSB_URL must be an absolute HTTP(S) URL")
		}
		if c.ProviderID == "" || c.ProviderID == "unconfigured" {
			return errors.New("RELAY_PROVIDER_ID is required when RELAY_READSB_URL is configured")
		}
	}
	if c.RetentionWindow < c.HistoryWindow {
		return errors.New("retention window must be at least as long as the history window")
	}
	if c.SegmentDuration <= 0 || c.HistoryWindow <= 0 || c.PollInterval <= 0 || c.SourceStaleAfter <= 0 || c.AircraftExpiry <= 0 || c.GracefulShutdownDuration <= 0 {
		return errors.New("duration settings must be positive")
	}
	if c.LatenessGrace < 0 {
		return errors.New("lateness grace cannot be negative")
	}
	if c.LatenessGrace > c.SegmentDuration {
		return errors.New("lateness grace cannot exceed segment duration")
	}
	if c.SourceStaleAfter > c.AircraftExpiry {
		return errors.New("source stale threshold cannot exceed aircraft expiry")
	}
	if c.MaxSourceBodyBytes <= 0 || c.MaxCurrentAircraft <= 0 || c.MaxResponseAircraft <= 0 || c.MaxHistoryPoints <= 0 {
		return errors.New("response and source limits must be positive")
	}
	if c.MaxSourceBodyBytes > 256<<20 || c.MaxCurrentAircraft > 250_000 || c.MaxResponseAircraft > 5_000 || c.MaxHistoryPoints > 10_000 {
		return errors.New("response or source limit exceeds the hard safety bound")
	}
	if c.MaxResponseAircraft > c.MaxCurrentAircraft {
		return errors.New("response aircraft limit cannot exceed current-state limit")
	}
	if c.MaxConnections <= 0 || c.SocketQueueDepth <= 0 || c.MaxSubscriptionChanges <= 0 || c.BlockCacheEntries <= 0 {
		return errors.New("stream bounds must be positive")
	}
	if c.MaxConnections > 100_000 || c.SocketQueueDepth > 1_024 || c.MaxSubscriptionChanges > 10_000 || c.BlockCacheEntries > 10_000 {
		return errors.New("stream limit exceeds the hard safety bound")
	}
	if c.MaxRadiusNM <= 0 || c.MaxBBoxAreaDegrees <= 0 {
		return errors.New("geographic bounds must be positive")
	}
	if c.MaxRadiusNM > 250 || c.MaxBBoxAreaDegrees > 100 {
		return errors.New("geographic limit exceeds the hard safety bound")
	}
	if c.EmergencyHistoryBytes < 0 {
		return errors.New("emergency history limit cannot be negative")
	}
	return nil
}

func value(lookup func(string) (string, bool), key, fallback string) string {
	if result, ok := lookup(key); ok {
		return result
	}
	return fallback
}

func durationValue(lookup func(string) (string, bool), key string, fallback time.Duration) time.Duration {
	raw, ok := lookup(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return fallback
	}
	result, err := time.ParseDuration(raw)
	if err != nil {
		return -1
	}
	return result
}

func intValue(lookup func(string) (string, bool), key string, fallback int) int {
	raw, ok := lookup(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return fallback
	}
	result, err := strconv.Atoi(raw)
	if err != nil {
		return -1
	}
	return result
}

func int64Value(lookup func(string) (string, bool), key string, fallback int64) int64 {
	raw, ok := lookup(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return fallback
	}
	result, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return -1
	}
	return result
}

func floatValue(lookup func(string) (string, bool), key string, fallback float64) float64 {
	raw, ok := lookup(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return fallback
	}
	result, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return -1
	}
	return result
}

func parseOrigins(raw string) (map[string]struct{}, error) {
	result := make(map[string]struct{})
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		parsed, err := url.Parse(entry)
		if err != nil || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, fmt.Errorf("invalid allowed origin %q", entry)
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return nil, fmt.Errorf("invalid allowed origin scheme %q", parsed.Scheme)
		}
		result[parsed.Scheme+"://"+parsed.Host] = struct{}{}
	}
	return result, nil
}

func parsePublicKey(raw string) (ed25519.PublicKey, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, errors.New("RELAY_TICKET_PUBLIC_KEY must be base64url encoded")
	}
	if len(decoded) != ed25519.PublicKeySize {
		return nil, errors.New("RELAY_TICKET_PUBLIC_KEY has the wrong length")
	}
	return ed25519.PublicKey(decoded), nil
}
