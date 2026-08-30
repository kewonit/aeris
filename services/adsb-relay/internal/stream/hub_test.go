package stream

import (
	"testing"
	"time"

	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
)

func streamObservation(trackID string, lat, lon float64, at time.Time) model.Observation {
	return model.Observation{
		TrackID:           trackID,
		Provider:          "synthetic",
		SourceEpoch:       "epoch",
		SessionGeneration: 1,
		Address:           "abc123",
		AddressType:       "adsb_icao",
		FixTime:           at,
		ReceivedAt:        at,
		PublishedAt:       at,
		Latitude:          lat,
		Longitude:         lon,
		AltitudeReference: model.AltitudeUnknown,
		PositionSource:    "adsb_icao",
	}
}

func request(revision uint64) SubscribeRequest {
	return SubscribeRequest{
		Type:                 "subscribe",
		ProtocolVersion:      model.ProtocolVersion,
		SubscriptionRevision: revision,
		BBox:                 model.BoundingBox{West: 70, South: 10, East: 80, North: 20},
	}
}

func TestSubscriptionAlwaysReceivesSnapshotBeforeDeltas(t *testing.T) {
	hub, err := NewHub(4, 100, 1000)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	hub.ApplyBatch([]model.Observation{streamObservation("track-a", 12.5, 77.6, now)}, now)
	subscription, err := hub.Register(request(1), now)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	hub.ApplyBatch([]model.Observation{streamObservation("track-a", 12.6, 77.7, now.Add(time.Second))}, now.Add(time.Second))
	first := <-subscription.Messages()
	second := <-subscription.Messages()
	if first.Type != "snapshot" || second.Type != "delta" || second.Sequence <= first.Sequence {
		t.Fatalf("unexpected message ordering: first=%s second=%s", first.Type, second.Type)
	}
}

func TestAircraftLeavingViewportProducesTombstone(t *testing.T) {
	hub, _ := NewHub(4, 100, 1000)
	now := time.Now().UTC()
	hub.ApplyBatch([]model.Observation{streamObservation("track-a", 12.5, 77.6, now)}, now)
	subscription, err := hub.Register(request(1), now)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	<-subscription.Messages()
	hub.ApplyBatch([]model.Observation{streamObservation("track-a", 40, -73, now.Add(time.Second))}, now.Add(time.Second))
	message := <-subscription.Messages()
	if len(message.Removals) != 1 || message.Removals[0] != "track-a" {
		t.Fatalf("expected viewport tombstone, got %#v", message.Removals)
	}
}

func TestSlowConsumerIsClosedInsteadOfGrowing(t *testing.T) {
	hub, _ := NewHub(1, 100, 1000)
	now := time.Now().UTC()
	subscription, err := hub.Register(request(1), now)
	if err != nil {
		t.Fatal(err)
	}
	hub.ApplyBatch([]model.Observation{streamObservation("track-a", 12.5, 77.6, now)}, now)
	select {
	case <-subscription.Done():
	case <-time.After(time.Second):
		t.Fatal("slow consumer was not closed")
	}
}

func TestFeedOutageDoesNotMassRemoveAircraft(t *testing.T) {
	hub, _ := NewHub(4, 100, 1000)
	now := time.Now().UTC()
	hub.SetSourceStatus(model.SourceLive, now, now)
	hub.ApplyBatch([]model.Observation{streamObservation("track-a", 12.5, 77.6, now)}, now)
	subscription, err := hub.Register(request(1), now)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	<-subscription.Messages()
	hub.SetSourceStatus(model.SourceStale, now, now.Add(time.Minute))
	status := <-subscription.Messages()
	if status.Type != "source_status" || len(status.Removals) != 0 {
		t.Fatal("source outage must not emit aircraft tombstones")
	}
	hub.RemoveExpired(now.Add(2*time.Minute), time.Second)
	select {
	case unexpected := <-subscription.Messages():
		t.Fatalf("stale feed unexpectedly removed aircraft: %#v", unexpected)
	default:
	}
}

func TestHeartbeatCarriesConsistencyCursor(t *testing.T) {
	hub, _ := NewHub(4, 100, 1000)
	now := time.Now().UTC()
	subscription, err := hub.Register(request(7), now)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	heartbeat := subscription.Heartbeat(now)
	if heartbeat.ServerEpoch == "" || heartbeat.SubscriptionRevision != 7 || heartbeat.ProtocolVersion != model.ProtocolVersion {
		t.Fatalf("heartbeat lacks consistency metadata: %#v", heartbeat)
	}
}

func TestHubBoundsCurrentStateAndViewportSnapshot(t *testing.T) {
	hub, err := NewHub(8, 2, 3)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	hub.SetSourceStatus(model.SourceLive, now, now)
	hub.ApplyBatch([]model.Observation{
		streamObservation("track-a", 12.5, 77.6, now),
		streamObservation("track-b", 12.6, 77.6, now),
		streamObservation("track-c", 12.7, 77.6, now),
		streamObservation("track-d", 12.8, 77.6, now),
	}, now)
	if len(hub.current) != 3 {
		t.Fatalf("current state exceeded its bound: %d", len(hub.current))
	}
	if status, _ := hub.Status(now); status != model.SourceDegraded {
		t.Fatalf("saturated current state must report degraded, got %s", status)
	}
	subscription, err := hub.Register(request(1), now)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	snapshot := <-subscription.Messages()
	if len(snapshot.Aircraft) != 2 || len(subscription.visible) != 2 || snapshot.SourceStatus != model.SourceDegraded {
		t.Fatalf("viewport snapshot exceeded its bound: aircraft=%d visible=%d", len(snapshot.Aircraft), len(subscription.visible))
	}
	hub.RemoveExpired(now.Add(2*time.Second), time.Second)
	if status, _ := hub.Status(now.Add(2 * time.Second)); status != model.SourceLive {
		t.Fatalf("capacity recovery must restore live status, got %s", status)
	}
}
