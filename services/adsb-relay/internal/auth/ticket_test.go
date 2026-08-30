package auth

import (
	"crypto/ed25519"
	"testing"
	"time"
)

func TestTicketIsOriginBoundAndOneUse(t *testing.T) {
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	verifier := NewTicketVerifier(public, map[string]struct{}{"https://aeris.example": {}}, 8)
	verifier.now = func() time.Time { return now }
	token, err := SignTicket(private, TicketClaims{
		ID:        "one-use",
		ExpiresAt: now.Add(time.Minute).Unix(),
		Origin:    "https://aeris.example",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifier.VerifyAndConsume(token, "https://other.example"); err == nil {
		t.Fatal("expected origin mismatch")
	}
	if _, err := verifier.VerifyAndConsume(token, "https://aeris.example"); err != nil {
		t.Fatalf("valid ticket rejected: %v", err)
	}
	if _, err := verifier.VerifyAndConsume(token, "https://aeris.example"); err == nil {
		t.Fatal("expected ticket replay to be rejected")
	}
}

func TestTicketRejectsExcessiveLifetime(t *testing.T) {
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	verifier := NewTicketVerifier(public, map[string]struct{}{"https://aeris.example": {}}, 8)
	verifier.now = func() time.Time { return now }
	token, err := SignTicket(private, TicketClaims{
		ID:        "too-long",
		ExpiresAt: now.Add(MaxTicketTTL + time.Second).Unix(),
		Origin:    "https://aeris.example",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifier.VerifyAndConsume(token, "https://aeris.example"); err == nil {
		t.Fatal("expected excessive ticket lifetime to be rejected")
	}
}
