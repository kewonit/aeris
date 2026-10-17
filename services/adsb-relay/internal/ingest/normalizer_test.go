package ingest

import (
	"math"
	"testing"
	"time"

	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
)

func number(value float64) *float64 { return &value }

func syntheticAircraft() RawAircraft {
	return RawAircraft{
		Hex:          "abc123",
		Type:         "adsb_icao",
		Flight:       " TEST123\n",
		Latitude:     number(12.5),
		Longitude:    number(77.6),
		SeenPosition: number(0),
		AltBaro:      RawAltitude{Value: number(30_000)},
		GroundSpeed:  number(450),
		Track:        number(90),
	}
}

func TestNormalizerSeparatesFixAndReceiveTime(t *testing.T) {
	normalizer, err := NewNormalizer("synthetic", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	raw := syntheticAircraft()
	raw.SeenPosition = number(2.5)
	responseTime := time.Unix(1_700_000_000, 0).UTC()
	receivedAt := responseTime.Add(time.Second)
	observation, accepted, err := normalizer.Normalize(raw, responseTime, receivedAt)
	if err != nil || !accepted {
		t.Fatalf("observation was not accepted: %v", err)
	}
	if got := responseTime.Sub(observation.FixTime); got != 2500*time.Millisecond {
		t.Fatalf("unexpected fix age %s", got)
	}
	if observation.ReceivedAt != receivedAt || observation.PublishedAt != receivedAt {
		t.Fatal("receive and publish timestamps were not preserved")
	}
	if observation.Callsign != "TEST123" {
		t.Fatalf("unsafe callsign was not sanitized: %q", observation.Callsign)
	}
}

func TestNormalizerDownsamplesStableCruiseButKeepsTurns(t *testing.T) {
	normalizer, err := NewNormalizer("synthetic", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Unix(1_700_000_000, 0).UTC()
	raw := syntheticAircraft()
	if _, accepted, err := normalizer.Normalize(raw, start, start); err != nil || !accepted {
		t.Fatal("first point must be accepted")
	}

	raw.Longitude = number(77.601)
	if _, accepted, err := normalizer.Normalize(raw, start.Add(time.Second), start.Add(time.Second)); err != nil || accepted {
		t.Fatalf("stable one-second point should be suppressed: accepted=%v err=%v", accepted, err)
	}

	raw.Track = number(96)
	if _, accepted, err := normalizer.Normalize(raw, start.Add(2*time.Second), start.Add(2*time.Second)); err != nil || !accepted {
		t.Fatalf("turn point should be retained: accepted=%v err=%v", accepted, err)
	}
}

func TestNormalizerRejectsImpossibleJump(t *testing.T) {
	normalizer, err := NewNormalizer("synthetic", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Unix(1_700_000_000, 0).UTC()
	raw := syntheticAircraft()
	if _, accepted, err := normalizer.Normalize(raw, start, start); err != nil || !accepted {
		t.Fatal("first point must be accepted")
	}
	raw.Latitude = number(40)
	if _, _, err := normalizer.Normalize(raw, start.Add(time.Second), start.Add(time.Second)); !errorsIs(err, ErrInvalidPosition) {
		t.Fatalf("expected impossible jump rejection, got %v", err)
	}
}

func TestNormalizerBreaksOnAltitudeDatumChange(t *testing.T) {
	normalizer, err := NewNormalizer("synthetic", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Unix(1_700_000_000, 0).UTC()
	raw := syntheticAircraft()
	if _, accepted, err := normalizer.Normalize(raw, start, start); err != nil || !accepted {
		t.Fatal("first point must be accepted")
	}
	raw.AltBaro = RawAltitude{}
	raw.AltGeom = number(30_100)
	raw.Longitude = number(77.61)
	observation, accepted, err := normalizer.Normalize(raw, start.Add(2*time.Second), start.Add(2*time.Second))
	if err != nil || !accepted {
		t.Fatalf("datum change should be accepted: %v", err)
	}
	if !observation.Discontinuity || observation.AltitudeReference != model.AltitudeGeometric {
		t.Fatal("altitude datum change must split the trail")
	}
}

func TestNormalizerRejectsNonFiniteInput(t *testing.T) {
	normalizer, err := NewNormalizer("synthetic", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	raw := syntheticAircraft()
	raw.Latitude = number(math.NaN())
	if _, _, err := normalizer.Normalize(raw, time.Now(), time.Now()); !errorsIs(err, ErrInvalidPosition) {
		t.Fatalf("expected invalid position error, got %v", err)
	}
}

func TestNormalizerRejectsIndividuallyStalePositions(t *testing.T) {
	normalizer, err := NewNormalizer("synthetic", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	raw := syntheticAircraft()
	raw.SeenPosition = number(30)
	if _, accepted, err := normalizer.Normalize(raw, time.Now().UTC(), time.Now().UTC()); err == nil || accepted {
		t.Fatalf("stale position must be rejected: accepted=%v err=%v", accepted, err)
	}
}

func TestNormalizerRejectsDuplicatesAndOutOfOrderFixes(t *testing.T) {
	normalizer, err := NewNormalizer("synthetic", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Unix(1_700_000_000, 0).UTC()
	raw := syntheticAircraft()
	first, accepted, err := normalizer.Normalize(raw, start, start)
	if err != nil || !accepted {
		t.Fatal("first point must be accepted")
	}
	if _, accepted, err := normalizer.Normalize(raw, start.Add(5*time.Second), start.Add(5*time.Second)); err != nil || accepted {
		t.Fatalf("unchanged repeated position must be suppressed: accepted=%v err=%v", accepted, err)
	}
	raw.Longitude = number(77.601)
	if _, accepted, err := normalizer.Normalize(raw, start.Add(-time.Second), start.Add(6*time.Second)); err != nil || accepted {
		t.Fatalf("out-of-order fix must be suppressed: accepted=%v err=%v", accepted, err)
	}
	raw.Longitude = number(77.605)
	next, accepted, err := normalizer.Normalize(raw, start.Add(6*time.Second), start.Add(6*time.Second))
	if err != nil || !accepted || next.TrackID != first.TrackID {
		t.Fatalf("next ordered fix should retain the session: accepted=%v err=%v", accepted, err)
	}
}

func TestNormalizerSeparatesICAOReuseAndAddressTypes(t *testing.T) {
	normalizer, err := NewNormalizer("synthetic", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Unix(1_700_000_000, 0).UTC()
	raw := syntheticAircraft()
	first, accepted, err := normalizer.Normalize(raw, start, start)
	if err != nil || !accepted {
		t.Fatal("first point must be accepted")
	}

	reused := syntheticAircraft()
	reused.Latitude = number(40)
	reused.Longitude = number(-73)
	reused.Flight = "OTHER1"
	second, accepted, err := normalizer.Normalize(reused, start.Add(11*time.Minute), start.Add(11*time.Minute))
	if err != nil || !accepted || second.SessionGeneration != 2 || second.TrackID == first.TrackID {
		t.Fatalf("ICAO reuse must start a new session: accepted=%v err=%v", accepted, err)
	}

	tisb := syntheticAircraft()
	tisb.Type = "tisb_icao"
	tisbObservation, accepted, err := normalizer.Normalize(tisb, start.Add(12*time.Minute), start.Add(12*time.Minute))
	if err != nil || !accepted || tisbObservation.TrackID == second.TrackID {
		t.Fatalf("TIS-B and ADS-B identities must remain separate: accepted=%v err=%v", accepted, err)
	}
	mlat := syntheticAircraft()
	mlat.Type = "mlat"
	mlatObservation, accepted, err := normalizer.Normalize(mlat, start.Add(13*time.Minute), start.Add(13*time.Minute))
	if err != nil || !accepted || mlatObservation.TrackID == tisbObservation.TrackID {
		t.Fatalf("MLAT and TIS-B identities must remain separate: accepted=%v err=%v", accepted, err)
	}
}

func TestNormalizerDoesNotReviveUnchangedPositionAfterSessionGap(t *testing.T) {
	normalizer, err := NewNormalizer("synthetic", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Unix(1_700_000_000, 0).UTC()
	raw := syntheticAircraft()
	if _, accepted, err := normalizer.Normalize(raw, start, start); err != nil || !accepted {
		t.Fatal("first point must be accepted")
	}
	if _, accepted, err := normalizer.Normalize(raw, start.Add(11*time.Minute), start.Add(11*time.Minute)); err != nil || accepted {
		t.Fatalf("unchanged cached position must not be revived: accepted=%v err=%v", accepted, err)
	}
}

func errorsIs(err, target error) bool {
	return err == target
}
