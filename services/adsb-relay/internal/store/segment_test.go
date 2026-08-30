package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
)

func TestSegmentPartitionsAndIndexesTracks(t *testing.T) {
	directory := t.TempDir()
	start := time.Unix(1_700_000_000, 0).UTC()
	first := syntheticObservation("track-a", start)
	second := syntheticObservation("track-a", start.Add(time.Second))
	second.Latitude = 13.5
	third := syntheticObservation("track-b", start.Add(2*time.Second))
	third.Longitude = 78.6

	manifest, err := writeSegment(directory, []model.Observation{first, second, third})
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Blocks) != 3 || len(manifest.Tracks["track-a"]) != 2 {
		t.Fatalf("unexpected segment index: blocks=%d trackTiles=%d", len(manifest.Blocks), len(manifest.Tracks["track-a"]))
	}
	loaded, err := loadManifests(directory)
	if err != nil || len(loaded) != 1 {
		t.Fatalf("manifest recovery failed: %v", err)
	}
	cache := newBlockCache(2)
	records, err := readBlock(directory, manifest, model.TileKey(first.Latitude, first.Longitude), cache)
	if err != nil || len(records) != 1 || records[0].TrackID != "track-a" {
		t.Fatalf("block read failed: %v", err)
	}
}

func TestSegmentChecksumDetectsCorruption(t *testing.T) {
	directory := t.TempDir()
	now := time.Unix(1_700_000_000, 0).UTC()
	observation := syntheticObservation("track-a", now)
	manifest, err := writeSegment(directory, []model.Observation{observation})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, manifest.DataFile)
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	payload[0] ^= 0xff
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readBlock(directory, manifest, model.TileKey(observation.Latitude, observation.Longitude), newBlockCache(1)); err == nil {
		t.Fatal("expected corrupted segment block to fail")
	}
}
