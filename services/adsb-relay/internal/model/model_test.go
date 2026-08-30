package model

import (
	"math"
	"testing"
	"time"
)

func TestObservationValidationRejectsUnsafeValues(t *testing.T) {
	now := time.Now().UTC()
	base := Observation{
		TrackID:           "track",
		Provider:          "synthetic",
		SourceEpoch:       "epoch",
		Address:           "abc123",
		AddressType:       "adsb_icao",
		FixTime:           now,
		ReceivedAt:        now,
		Latitude:          12.5,
		Longitude:         77.6,
		AltitudeReference: AltitudeBarometric,
	}
	if err := base.Validate(); err != nil {
		t.Fatalf("valid observation rejected: %v", err)
	}

	invalid := base
	invalid.Latitude = math.NaN()
	if err := invalid.Validate(); err == nil {
		t.Fatal("expected non-finite latitude to be rejected")
	}

	invalid = base
	invalid.FixTime = now.Add(time.Minute)
	if err := invalid.Validate(); err == nil {
		t.Fatal("expected future source timestamp to be rejected")
	}
}

func TestBoundingBoxHandlesAntimeridian(t *testing.T) {
	bbox := BoundingBox{West: 170, South: -10, East: -170, North: 10}
	if err := bbox.Validate(500); err != nil {
		t.Fatalf("valid antimeridian bbox rejected: %v", err)
	}
	if !bbox.Contains(0, 179) || !bbox.Contains(0, -179) || bbox.Contains(0, 0) {
		t.Fatal("antimeridian containment is incorrect")
	}
}

func TestStableTrackIDIncludesSessionAndSource(t *testing.T) {
	first := StableTrackID("provider", "epoch-a", "adsb_icao", "abc123", 1)
	if first == StableTrackID("provider", "epoch-a", "adsb_icao", "abc123", 2) {
		t.Fatal("session generation must change the track id")
	}
	if first == StableTrackID("provider", "epoch-b", "adsb_icao", "abc123", 1) {
		t.Fatal("source epoch must change the track id")
	}
}

func TestSanitizeLabelRemovesControlCharacters(t *testing.T) {
	if got := SanitizeLabel(" TEST\n123 \x00", 8); got != "TEST123" {
		t.Fatalf("unexpected sanitized value %q", got)
	}
}
