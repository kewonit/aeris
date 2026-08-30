package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
)

func waitForManifest(t *testing.T, storage *Store) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		storage.mu.RLock()
		finalized := len(storage.manifests) > 0
		storage.mu.RUnlock()
		if finalized {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("segment finalization timed out")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func testOptions(directory string) Options {
	return Options{
		DataDir:            directory,
		HistoryWindow:      time.Hour,
		RetentionWindow:    65 * time.Minute,
		SegmentDuration:    50 * time.Millisecond,
		LatenessGrace:      0,
		MaxCurrentAircraft: 1000,
		BlockCacheEntries:  4,
	}
}

func TestStoreKeepsRotatedWALQueryableDuringLatenessGrace(t *testing.T) {
	options := testOptions(t.TempDir())
	options.LatenessGrace = 150 * time.Millisecond
	storage, err := Open(options)
	if err != nil {
		t.Fatal(err)
	}
	defer storage.Close()
	start := time.Now().UTC()
	first := syntheticObservation("track-a", start)
	second := syntheticObservation("track-a", start.Add(100*time.Millisecond))
	second.Longitude += 0.01
	if err := storage.Accept(first); err != nil {
		t.Fatal(err)
	}
	if err := storage.Accept(second); err != nil {
		t.Fatal(err)
	}
	storage.mu.RLock()
	manifestCount := len(storage.manifests)
	storage.mu.RUnlock()
	if manifestCount != 0 {
		t.Fatal("segment finalized before the lateness grace elapsed")
	}
	track, _, err := storage.Track("track-a", start.Add(time.Second), time.Hour, 100)
	if err != nil || len(track) != 2 {
		t.Fatalf("pending WAL was not queryable during grace: records=%d err=%v", len(track), err)
	}
	waitForManifest(t, storage)
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
	waitForManifest(t, store)
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

func TestEmergencyHistoryGuardKeepsLiveServiceAndMarksHistoryIncomplete(t *testing.T) {
	directory := t.TempDir()
	options := testOptions(directory)
	options.EmergencyHistoryBytes = 1
	storage, err := Open(options)
	if err != nil {
		t.Fatal(err)
	}
	defer storage.Close()
	start := time.Now().UTC()
	first := syntheticObservation("track-a", start)
	second := syntheticObservation("track-a", start.Add(100*time.Millisecond))
	second.Longitude += 0.01
	if err := storage.Accept(first); err != nil {
		t.Fatal(err)
	}
	if err := storage.Accept(second); err != nil {
		t.Fatal(err)
	}
	waitForManifest(t, storage)
	now := start.Add(time.Second)
	storage.cleanup(now)

	storage.mu.RLock()
	manifestCount := len(storage.manifests)
	storage.mu.RUnlock()
	if manifestCount != 0 {
		t.Fatalf("expected emergency guard to evict finalized history, got %d segments", manifestCount)
	}
	retention := storage.Retention(now, time.Hour)
	if retention.Complete {
		t.Fatal("emergency eviction must mark history incomplete")
	}
	current := storage.Current(model.BoundingBox{West: 70, South: 10, East: 80, North: 20}, now, time.Minute, 10)
	if len(current) != 1 || current[0].TrackID != "track-a" {
		t.Fatalf("live state must remain available after history eviction: %#v", current)
	}
	temporaryFiles, err := filepath.Glob(filepath.Join(directory, "segments", "*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(temporaryFiles) != 0 {
		t.Fatalf("segment finalization left temporary files: %#v", temporaryFiles)
	}
	entries, err := os.ReadDir(filepath.Join(directory, "segments"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("emergency guard left finalized history files: %d", len(entries))
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

func TestStoreBoundsCurrentStateWithoutDroppingHistory(t *testing.T) {
	options := testOptions(t.TempDir())
	options.MaxCurrentAircraft = 2
	storage, err := Open(options)
	if err != nil {
		t.Fatal(err)
	}
	defer storage.Close()
	now := time.Now().UTC()
	for _, trackID := range []string{"track-a", "track-b", "track-c"} {
		if err := storage.Accept(syntheticObservation(trackID, now)); err != nil {
			t.Fatal(err)
		}
	}
	current := storage.Current(model.BoundingBox{West: 70, South: 10, East: 80, North: 20}, now, time.Minute, 10)
	if len(current) != 2 {
		t.Fatalf("current state exceeded its bound: %d", len(current))
	}
	history, _, err := storage.Track("track-c", now.Add(time.Second), time.Hour, 10)
	if err != nil || len(history) != 1 {
		t.Fatalf("bounded current state dropped durable history: records=%d err=%v", len(history), err)
	}
}
