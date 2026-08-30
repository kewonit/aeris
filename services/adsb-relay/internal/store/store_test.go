package store

import (
	"testing"
	"time"

	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
)

func testOptions(directory string) Options {
	return Options{
		DataDir:           directory,
		HistoryWindow:     time.Hour,
		RetentionWindow:   65 * time.Minute,
		SegmentDuration:   50 * time.Millisecond,
		BlockCacheEntries: 4,
	}
}

func TestStoreQueriesActiveWALAndReportsColdHistory(t *testing.T) {
	store, err := Open(testOptions(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	now := time.Now().UTC()
	observation := syntheticObservation("track-a", now)
	if err := store.Accept(observation); err != nil {
		t.Fatal(err)
	}
	track, retention, err := store.Track("track-a", now.Add(time.Second), time.Hour, 100)
	if err != nil || len(track) != 1 {
		t.Fatalf("active WAL query failed: records=%d err=%v", len(track), err)
	}
	if retention.Complete {
		t.Fatal("cold store must not claim a complete history window")
	}
	current := store.Current(model.BoundingBox{West: 77, South: 12, East: 78, North: 13}, now, time.Minute, 10)
	if len(current) != 1 {
		t.Fatalf("expected one current aircraft, got %d", len(current))
	}
}

func TestStoreFinalizesSegmentAndRecoversAfterRestart(t *testing.T) {
	directory := t.TempDir()
	store, err := Open(testOptions(directory))
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now().UTC()
	first := syntheticObservation("track-a", start)
	second := syntheticObservation("track-a", start.Add(100*time.Millisecond))
	second.Longitude += 0.01
	if err := store.Accept(first); err != nil {
		t.Fatal(err)
	}
	if err := store.Accept(second); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		store.mu.RLock()
		finalized := len(store.manifests) > 0
		store.mu.RUnlock()
		if finalized || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(testOptions(directory))
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	track, _, err := reopened.Track("track-a", start.Add(time.Second), time.Hour, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(track) != 2 {
		t.Fatalf("expected both recovered observations, got %d", len(track))
	}
}

func TestDownsamplePreservesDiscontinuityBoundary(t *testing.T) {
	start := time.Unix(1_700_000_000, 0).UTC()
	records := make([]model.Observation, 20)
	for index := range records {
		records[index] = syntheticObservation("track-a", start.Add(time.Duration(index)*time.Second))
		records[index].Longitude += float64(index) * 0.001
	}
	records[10].Discontinuity = true
	result := downsample(records, 6)
	foundBoundary := false
	for _, record := range result {
		if record.Discontinuity {
			foundBoundary = true
		}
	}
	if !foundBoundary || len(result) > 6 {
		t.Fatalf("discontinuity was not retained within limit: records=%d", len(result))
	}
}

func TestStorePurgesExpiredCurrentState(t *testing.T) {
	store, err := Open(testOptions(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	now := time.Now().UTC()
	if err := store.Accept(syntheticObservation("track-a", now.Add(-2*time.Minute))); err != nil {
		t.Fatal(err)
	}
	store.PurgeCurrentBefore(now.Add(-time.Minute))
	current := store.Current(model.BoundingBox{West: 70, South: 10, East: 80, North: 20}, now, 0, 10)
	if len(current) != 0 {
		t.Fatalf("expected expired current state to be purged, got %d", len(current))
	}
}
