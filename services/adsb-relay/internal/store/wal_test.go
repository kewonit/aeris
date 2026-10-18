package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
)

func syntheticObservation(trackID string, at time.Time) model.Observation {
	altitude := 30_000.0
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
		Latitude:          12.5,
		Longitude:         77.6,
		BaroAltitudeFt:    &altitude,
		AltitudeReference: model.AltitudeBarometric,
		PositionSource:    "adsb_icao",
	}
}

func TestWALRoundTripAndTruncatedTailRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "active.wal")
	writer, err := OpenWAL(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	if err := writer.Append(syntheticObservation("track-a", now)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte{0, 0, 0}); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()

	records, truncated, err := ReadWAL(path)
	if err != nil {
		t.Fatal(err)
	}
	if !truncated || len(records) != 1 || records[0].TrackID != "track-a" {
		t.Fatalf("unexpected recovery result: truncated=%v records=%d", truncated, len(records))
	}
}

func TestWALRejectsChecksumCorruption(t *testing.T) {
	path := filepath.Join(t.TempDir(), "active.wal")
	writer, err := OpenWAL(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	if err := writer.Append(syntheticObservation("track-a", now)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	payload[len(payload)-1] ^= 0xff
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReadWAL(path); err == nil {
		t.Fatal("expected corrupt WAL checksum to fail")
	}
}
