package api

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/kewonit/aeris/services/adsb-relay/internal/auth"
	"github.com/kewonit/aeris/services/adsb-relay/internal/config"
	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
	"github.com/kewonit/aeris/services/adsb-relay/internal/store"
	"github.com/kewonit/aeris/services/adsb-relay/internal/stream"
)

func apiObservation(at time.Time) model.Observation {
	altitude := 30_000.0
	track := 90.0
	return model.Observation{
		TrackID:           "track-a",
		Provider:          "synthetic",
		SourceEpoch:       "epoch",
		SessionGeneration: 1,
		Address:           "abc123",
		AddressType:       "adsb_icao",
		Callsign:          "TEST123",
		FixTime:           at,
		ReceivedAt:        at,
		PublishedAt:       at,
		Latitude:          12.5,
		Longitude:         77.6,
		BaroAltitudeFt:    &altitude,
		AltitudeReference: model.AltitudeBarometric,
		TrackDeg:          &track,
		PositionSource:    "adsb_icao",
	}
}

type testServer struct {
	http      *httptest.Server
	store     *store.Store
	hub       *stream.Hub
	private   ed25519.PrivateKey
	origin    string
	httpToken string
}

func newTestServer(t *testing.T) *testServer {
	t.Helper()
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	origin := "https://aeris.example"
	config := config.Config{
		ProviderID:             "synthetic",
		ProviderLabel:          "Synthetic",
		AllowedOrigins:         map[string]struct{}{origin: {}},
		TicketPublicKey:        public,
		HTTPToken:              "server-secret",
		HistoryWindow:          time.Hour,
		RetentionWindow:        65 * time.Minute,
		SegmentDuration:        5 * time.Minute,
		AircraftExpiry:         90 * time.Second,
		MaxBBoxAreaDegrees:     100,
		MaxRadiusNM:            250,
		MaxResponseAircraft:    100,
		MaxHistoryPoints:       1000,
		MaxConnections:         8,
		SocketQueueDepth:       8,
		MaxSubscriptionChanges: 30,
	}
	storage, err := store.Open(store.Options{
		DataDir:           t.TempDir(),
		HistoryWindow:     config.HistoryWindow,
		RetentionWindow:   config.RetentionWindow,
		SegmentDuration:   config.SegmentDuration,
		BlockCacheEntries: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	hub, err := stream.NewHub(config.SocketQueueDepth)
	if err != nil {
		t.Fatal(err)
	}
	verifier := auth.NewTicketVerifier(public, config.AllowedOrigins, 32)
	server := httptest.NewServer(NewServer(config, storage, hub, verifier).Handler())
	t.Cleanup(func() {
		server.Close()
		_ = storage.Close()
	})
	return &testServer{http: server, store: storage, hub: hub, private: private, origin: origin, httpToken: config.HTTPToken}
}

func TestHealthIsCoarseAndDataRequiresBearerToken(t *testing.T) {
	server := newTestServer(t)
	response, err := http.Get(server.http.URL + "/status")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var status map[string]any
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}
	if len(status) != 1 || status["status"] != "starting" {
		t.Fatalf("public status leaked unexpected details: %#v", status)
	}

	response, err = http.Get(server.http.URL + "/v1/aircraft?lat=12.5&lon=77.6&radius=10")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized response, got %d", response.StatusCode)
	}
}

func TestAircraftAndTrackResponsesExposeFreshnessAndRetention(t *testing.T) {
	server := newTestServer(t)
	now := time.Now().UTC()
	observation := apiObservation(now)
	if err := server.store.Accept(observation); err != nil {
		t.Fatal(err)
	}
	server.hub.SetSourceStatus(model.SourceLive, now, now)
	server.hub.ApplyBatch([]model.Observation{observation}, now)

	request, _ := http.NewRequest(http.MethodGet, server.http.URL+"/v1/aircraft?lat=12.5&lon=77.6&radius=10", nil)
	request.Header.Set("Authorization", "Bearer "+server.httpToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var aircraft aircraftEnvelope
	if err := json.NewDecoder(response.Body).Decode(&aircraft); err != nil {
		t.Fatal(err)
	}
	if len(aircraft.Aircraft) != 1 || aircraft.Aircraft[0].TrackID != "track-a" || aircraft.Meta.SourceStatus != model.SourceLive {
		t.Fatalf("unexpected aircraft response: %#v", aircraft)
	}

	request, _ = http.NewRequest(http.MethodGet, server.http.URL+"/v1/tracks/track-a", nil)
	request.Header.Set("Authorization", "Bearer "+server.httpToken)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var track trackEnvelope
	if err := json.NewDecoder(response.Body).Decode(&track); err != nil {
		t.Fatal(err)
	}
	if track.Track == nil || len(track.Track.Observations) != 1 || track.Meta.Retention == nil || track.Meta.Retention.Complete {
		t.Fatalf("unexpected track response: %#v", track)
	}
}

func TestWebSocketTicketAndSnapshotFirstProtocol(t *testing.T) {
	server := newTestServer(t)
	now := time.Now().UTC()
	observation := apiObservation(now)
	server.hub.ApplyBatch([]model.Observation{observation}, now)
	token, err := auth.SignTicket(server.private, auth.TicketClaims{
		ID:        "ticket-one",
		ExpiresAt: now.Add(time.Minute).Unix(),
		Origin:    server.origin,
	})
	if err != nil {
		t.Fatal(err)
	}
	wsURL := "ws" + strings.TrimPrefix(server.http.URL, "http") + "/v1/live"
	connection, response, err := websocket.Dial(context.Background(), wsURL, &websocket.DialOptions{
		HTTPHeader:   http.Header{"Origin": []string{server.origin}},
		Subprotocols: []string{"aeris.v1", auth.TicketSubprotocol(token)},
	})
	if err != nil {
		if response != nil {
			t.Fatalf("websocket dial failed with HTTP %d: %v", response.StatusCode, err)
		}
		t.Fatal(err)
	}
	defer connection.CloseNow()
	subscribe := stream.SubscribeRequest{
		Type:                 "subscribe",
		ProtocolVersion:      model.ProtocolVersion,
		SubscriptionRevision: 1,
		BBox:                 model.BoundingBox{West: 70, South: 10, East: 80, North: 20},
	}
	if err := wsjson.Write(context.Background(), connection, subscribe); err != nil {
		t.Fatal(err)
	}
	var message stream.Message
	if err := wsjson.Read(context.Background(), connection, &message); err != nil {
		t.Fatal(err)
	}
	if message.Type != "snapshot" || len(message.Aircraft) != 1 || message.SubscriptionRevision != 1 {
		t.Fatalf("expected snapshot-first response, got %#v", message)
	}
}

func TestStreamRejectsTicketReplay(t *testing.T) {
	server := newTestServer(t)
	now := time.Now().UTC()
	token, err := auth.SignTicket(server.private, auth.TicketClaims{ID: "replayed", ExpiresAt: now.Add(time.Minute).Unix(), Origin: server.origin})
	if err != nil {
		t.Fatal(err)
	}
	wsURL := "ws" + strings.TrimPrefix(server.http.URL, "http") + "/v1/live"
	options := &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{server.origin}}, Subprotocols: []string{"aeris.v1", auth.TicketSubprotocol(token)}}
	first, _, err := websocket.Dial(context.Background(), wsURL, options)
	if err != nil {
		t.Fatal(err)
	}
	first.CloseNow()
	_, response, err := websocket.Dial(context.Background(), wsURL, options)
	if err == nil || response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected replay rejection, response=%v err=%v", response, err)
	}
}
