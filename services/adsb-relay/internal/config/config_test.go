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
