package ingest

import (
	"errors"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
)

var ErrInvalidPosition = errors.New("invalid aircraft position")

const (
	stableSampleInterval = 5 * time.Second
	dynamicMinInterval   = time.Second
	sessionGap           = 10 * time.Minute
	discontinuityGap     = 90 * time.Second
	maxImpliedSpeedKt    = 1500.0
)

type sessionState struct {
	generation uint64
	last       *model.Observation
	lastSeen   time.Time
}

type Normalizer struct {
	mu           sync.Mutex
	provider     string
	maxSourceAge time.Duration
	sourceEpoch  string
	sessions     map[string]*sessionState
	processed    uint64
}

func NewNormalizer(provider string, maxSourceAge time.Duration) (*Normalizer, error) {
	if maxSourceAge <= 0 {
		return nil, errors.New("maximum source age must be positive")
	}
	epoch, err := NewSourceEpoch()
	if err != nil {
		return nil, err
	}
	return &Normalizer{
		provider:     provider,
		maxSourceAge: maxSourceAge,
		sourceEpoch:  epoch,
		sessions:     make(map[string]*sessionState),
	}, nil
}

func (n *Normalizer) RotateSourceEpoch() error {
	epoch, err := NewSourceEpoch()
	if err != nil {
		return err
	}
	n.mu.Lock()
	n.sourceEpoch = epoch
	n.sessions = make(map[string]*sessionState)
	n.mu.Unlock()
	return nil
}

func (n *Normalizer) SourceEpoch() string {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.sourceEpoch
}

func (n *Normalizer) Normalize(raw RawAircraft, responseTime, receivedAt time.Time) (model.Observation, bool, error) {
	if raw.Latitude == nil || raw.Longitude == nil ||
		!finite(*raw.Latitude) || !finite(*raw.Longitude) ||
		*raw.Latitude < -90 || *raw.Latitude > 90 ||
		*raw.Longitude < -180 || *raw.Longitude > 180 {
		return model.Observation{}, false, ErrInvalidPosition
	}
	address := strings.ToLower(strings.TrimSpace(raw.Hex))
	if address == "" || len(address) > 32 {
		return model.Observation{}, false, errors.New("invalid aircraft address")
	}
	addressType := strings.ToLower(model.SanitizeLabel(raw.Type, 32))
	if addressType == "" {
		addressType = "unknown"
	}
	fixTime := responseTime.UTC()
	if raw.SeenPosition != nil {
		if !finite(*raw.SeenPosition) || *raw.SeenPosition < 0 || time.Duration(*raw.SeenPosition*float64(time.Second)) >= n.maxSourceAge {
			return model.Observation{}, false, errors.New("stale or invalid source position age")
		}
		fixTime = responseTime.Add(-time.Duration(*raw.SeenPosition * float64(time.Second))).UTC()
	}

	baroAltitude := finitePointer(raw.AltBaro.Value)
	geomAltitude := finitePointer(raw.AltGeom)
	altitudeReference := model.AltitudeUnknown
	onGround := raw.AltBaro.Ground
	switch {
	case onGround:
		altitudeReference = model.AltitudeGround
	case baroAltitude != nil:
		altitudeReference = model.AltitudeBarometric
	case geomAltitude != nil:
		altitudeReference = model.AltitudeGeometric
	}
	verticalRate := finitePointer(raw.BaroRate)
	if verticalRate == nil {
		verticalRate = finitePointer(raw.GeomRate)
	}

	n.mu.Lock()
	defer n.mu.Unlock()
	key := addressType + "\x00" + address
	n.processed++
	if n.processed%1024 == 0 {
		for sessionKey, session := range n.sessions {
			if sessionKey != key && !session.lastSeen.IsZero() && receivedAt.Sub(session.lastSeen) > 2*sessionGap {
				delete(n.sessions, sessionKey)
			}
		}
	}
	state := n.sessions[key]
	if state == nil {
		state = &sessionState{generation: 1}
		n.sessions[key] = state
	}

	observation := model.Observation{
		Provider:          n.provider,
		SourceEpoch:       n.sourceEpoch,
		SessionGeneration: state.generation,
		Address:           address,
		AddressType:       addressType,
		Callsign:          model.SanitizeLabel(raw.Flight, 16),
		Registration:      model.SanitizeLabel(raw.Registration, 16),
		AircraftType:      model.SanitizeLabel(raw.AircraftType, 16),
		FixTime:           fixTime,
		ReceivedAt:        receivedAt.UTC(),
		PublishedAt:       receivedAt.UTC(),
		Latitude:          *raw.Latitude,
		Longitude:         *raw.Longitude,
		BaroAltitudeFt:    baroAltitude,
		GeomAltitudeFt:    geomAltitude,
		AltitudeReference: altitudeReference,
		OnGround:          onGround,
		TrackDeg:          normalizedTrack(raw.Track),
		GroundSpeedKt:     finitePointer(raw.GroundSpeed),
		VerticalRateFPM:   verticalRate,
		PositionSource:    addressType,
		NIC:               finitePointer(raw.NIC),
		NACP:              finitePointer(raw.NACP),
		SIL:               finitePointer(raw.SIL),
	}
	if state.last != nil && !state.lastSeen.IsZero() && receivedAt.Sub(state.lastSeen) > sessionGap {
		if sameKinematics(*state.last, observation) {
			return model.Observation{}, false, nil
		}
		state.generation++
		state.last = nil
		state.lastSeen = time.Time{}
		observation.SessionGeneration = state.generation
	}
	observation.TrackID = model.StableTrackID(
		observation.Provider,
		observation.SourceEpoch,
		observation.AddressType,
		observation.Address,
		observation.SessionGeneration,
	)

	if state.last != nil {
		previous := *state.last
		interval := observation.FixTime.Sub(previous.FixTime)
		if interval <= 0 || sameKinematics(previous, observation) {
			return model.Observation{}, false, nil
		}
		distance := model.DistanceNM(previous.Latitude, previous.Longitude, observation.Latitude, observation.Longitude)
		if interval > 0 && interval <= discontinuityGap {
			impliedSpeed := distance / interval.Hours()
			if impliedSpeed > maxImpliedSpeedKt {
				return model.Observation{}, false, ErrInvalidPosition
			}
		}
		observation.Discontinuity = interval > discontinuityGap ||
			math.Abs(observation.Longitude-previous.Longitude) > 180 ||
			observation.PositionSource != previous.PositionSource ||
			observation.AltitudeReference != previous.AltitudeReference
		if !observation.Discontinuity && !shouldPersist(previous, observation, interval) {
			return model.Observation{}, false, nil
		}
	}
	if err := observation.Validate(); err != nil {
		return model.Observation{}, false, err
	}
	copyObservation := observation
	state.last = &copyObservation
	state.lastSeen = receivedAt
	return observation, true, nil
}

func shouldPersist(previous, next model.Observation, interval time.Duration) bool {
	if interval >= stableSampleInterval {
		return true
	}
	if interval < dynamicMinInterval {
		return false
	}
	if previous.OnGround != next.OnGround || previous.AltitudeReference != next.AltitudeReference {
		return true
	}
	if pointerDelta(previous.TrackDeg, next.TrackDeg, headingDelta) >= 3 {
		return true
	}
	if pointerDelta(previous.BaroAltitudeFt, next.BaroAltitudeFt, absoluteDelta) >= 75 {
		return true
	}
	if pointerDelta(previous.GeomAltitudeFt, next.GeomAltitudeFt, absoluteDelta) >= 75 {
		return true
	}
	if pointerDelta(previous.GroundSpeedKt, next.GroundSpeedKt, absoluteDelta) >= 10 {
		return true
	}
	return pointerDelta(previous.VerticalRateFPM, next.VerticalRateFPM, absoluteDelta) >= 250
}

func sameKinematics(left, right model.Observation) bool {
	return left.Latitude == right.Latitude &&
		left.Longitude == right.Longitude &&
		left.OnGround == right.OnGround &&
		left.PositionSource == right.PositionSource &&
		left.AltitudeReference == right.AltitudeReference &&
		equalPointers(left.BaroAltitudeFt, right.BaroAltitudeFt) &&
		equalPointers(left.GeomAltitudeFt, right.GeomAltitudeFt) &&
		equalPointers(left.TrackDeg, right.TrackDeg) &&
		equalPointers(left.GroundSpeedKt, right.GroundSpeedKt) &&
		equalPointers(left.VerticalRateFPM, right.VerticalRateFPM)
}

func equalPointers(left, right *float64) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}

func pointerDelta(left, right *float64, delta func(float64, float64) float64) float64 {
	if left == nil || right == nil {
		if left != right {
			return math.Inf(1)
		}
		return 0
	}
	return delta(*left, *right)
}

func absoluteDelta(left, right float64) float64 {
	return math.Abs(left - right)
}

func headingDelta(left, right float64) float64 {
	delta := math.Abs(left - right)
	if delta > 180 {
		delta = 360 - delta
	}
	return delta
}

func finitePointer(value *float64) *float64 {
	if value == nil || !finite(*value) {
		return nil
	}
	copyValue := *value
	return &copyValue
}

func normalizedTrack(value *float64) *float64 {
	value = finitePointer(value)
	if value == nil {
		return nil
	}
	for *value < 0 {
		*value += 360
	}
	for *value >= 360 {
		*value -= 360
	}
	return value
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}
