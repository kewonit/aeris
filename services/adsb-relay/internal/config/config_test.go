package config

import (
	"crypto/ed25519"
	"encoding/base64"
	"testing"
)

func TestLoadAcceptsProviderNeutralConfiguration(t *testing.T) {
	public, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	values := map[string]string{
		"RELAY_READSB_URL":        "http://readsb.internal/aircraft.json",
		"RELAY_PROVIDER_ID":       "authorized-source",
		"RELAY_ALLOWED_ORIGINS":   "https://aeris.example,http://localhost:3000",
		"RELAY_TICKET_PUBLIC_KEY": base64.RawURLEncoding.EncodeToString(public),
	}
	config, err := load(func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := config.AllowedOrigins["https://aeris.example"]; !ok {
		t.Fatal("expected exact allowed origin")
	}
	if len(config.TicketPublicKey) != ed25519.PublicKeySize {
		t.Fatal("ticket public key was not decoded")
	}
}

func TestLoadRejectsRetentionShorterThanHistory(t *testing.T) {
	_, err := load(func(key string) (string, bool) {
		switch key {
		case "RELAY_HISTORY_WINDOW":
			return "1h", true
		case "RELAY_RETENTION_WINDOW":
			return "30m", true
		default:
			return "", false
		}
	})
	if err == nil {
		t.Fatal("expected invalid retention settings to fail")
	}
}

func TestLoadRejectsWildcardOrigin(t *testing.T) {
	_, err := load(func(key string) (string, bool) {
		if key == "RELAY_ALLOWED_ORIGINS" {
			return "*", true
		}
		return "", false
	})
	if err == nil {
		t.Fatal("expected wildcard origin to fail")
	}
}

func TestLoadRejectsLimitsOutsideHardSafetyBounds(t *testing.T) {
	for key, value := range map[string]string{
		"RELAY_MAX_SOURCE_BODY_BYTES":    "999999999999",
		"RELAY_MAX_CURRENT_AIRCRAFT":     "250001",
		"RELAY_MAX_RESPONSE_AIRCRAFT":    "5001",
		"RELAY_MAX_HISTORY_POINTS":       "10001",
		"RELAY_MAX_CONNECTIONS":          "100001",
		"RELAY_SOCKET_QUEUE_DEPTH":       "1025",
		"RELAY_MAX_SUBSCRIPTION_CHANGES": "10001",
		"RELAY_BLOCK_CACHE_ENTRIES":      "10001",
		"RELAY_MAX_BBOX_AREA_DEGREES":    "101",
		"RELAY_MAX_RADIUS_NM":            "251",
		"RELAY_MAX_HISTORY_BYTES":        "-1",
	} {
		t.Run(key, func(t *testing.T) {
			_, err := load(func(candidate string) (string, bool) {
				if candidate == key {
					return value, true
				}
				return "", false
			})
			if err == nil {
				t.Fatalf("expected %s=%s to fail", key, value)
			}
		})
	}
}
