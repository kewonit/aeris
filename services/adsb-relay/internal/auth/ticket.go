package auth

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

const MaxTicketTTL = 2 * time.Minute

type TicketClaims struct {
	ID        string `json:"jti"`
	ExpiresAt int64  `json:"exp"`
	Origin    string `json:"origin"`
}

func SignTicket(privateKey ed25519.PrivateKey, claims TicketClaims) (string, error) {
	if len(privateKey) != ed25519.PrivateKeySize {
		return "", errors.New("invalid Ed25519 private key")
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	signature := ed25519.Sign(privateKey, []byte(encodedPayload))
	return encodedPayload + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

type TicketVerifier struct {
	publicKey ed25519.PublicKey
	allowed   map[string]struct{}
	replay    *replayGuard
	now       func() time.Time
}

func NewTicketVerifier(publicKey ed25519.PublicKey, allowedOrigins map[string]struct{}, replayLimit int) *TicketVerifier {
	copyOrigins := make(map[string]struct{}, len(allowedOrigins))
	for origin := range allowedOrigins {
		copyOrigins[origin] = struct{}{}
	}
	return &TicketVerifier{
		publicKey: append(ed25519.PublicKey(nil), publicKey...),
		allowed:   copyOrigins,
		replay:    newReplayGuard(replayLimit),
		now:       time.Now,
	}
}

func (v *TicketVerifier) Configured() bool {
	return len(v.publicKey) == ed25519.PublicKeySize && len(v.allowed) > 0
}

func (v *TicketVerifier) VerifyAndConsume(token, requestOrigin string) (TicketClaims, error) {
	if !v.Configured() {
		return TicketClaims{}, errors.New("stream ticket verification is not configured")
	}
	if _, ok := v.allowed[requestOrigin]; !ok {
		return TicketClaims{}, errors.New("origin is not allowed")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 || len(token) > 4096 {
		return TicketClaims{}, errors.New("malformed stream ticket")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(signature) != ed25519.SignatureSize {
		return TicketClaims{}, errors.New("malformed stream ticket signature")
	}
	if !ed25519.Verify(v.publicKey, []byte(parts[0]), signature) {
		return TicketClaims{}, errors.New("invalid stream ticket signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return TicketClaims{}, errors.New("malformed stream ticket payload")
	}
	var claims TicketClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return TicketClaims{}, errors.New("malformed stream ticket claims")
	}
	now := v.now().UTC()
	expiresAt := time.Unix(claims.ExpiresAt, 0)
	if claims.ID == "" || len(claims.ID) > 128 {
		return TicketClaims{}, errors.New("invalid stream ticket id")
	}
	if claims.Origin != requestOrigin {
		return TicketClaims{}, errors.New("stream ticket origin mismatch")
	}
	if !expiresAt.After(now) || expiresAt.After(now.Add(MaxTicketTTL)) {
		return TicketClaims{}, errors.New("stream ticket is expired or has an excessive lifetime")
	}
	if !v.replay.consume(claims.ID, expiresAt, now) {
		return TicketClaims{}, errors.New("stream ticket was already used")
	}
	return claims, nil
}

type replayGuard struct {
	mu         sync.Mutex
	entries    map[string]time.Time
	maxEntries int
}

func newReplayGuard(maxEntries int) *replayGuard {
	if maxEntries <= 0 {
		maxEntries = 1024
	}
	return &replayGuard{entries: make(map[string]time.Time), maxEntries: maxEntries}
}

func (g *replayGuard) consume(id string, expiresAt, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	for existingID, expiry := range g.entries {
		if !expiry.After(now) {
			delete(g.entries, existingID)
		}
	}
	if _, exists := g.entries[id]; exists || len(g.entries) >= g.maxEntries {
		return false
	}
	g.entries[id] = expiresAt
	return true
}

func TicketSubprotocol(token string) string {
	return fmt.Sprintf("aeris.ticket.%s", token)
}
