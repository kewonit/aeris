package model

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode"
)

const (
	ProtocolVersion = 1
	EarthRadiusNM   = 3440.065
)

type SourceStatus string

const (
	SourceStarting SourceStatus = "starting"
	SourceLive     SourceStatus = "live"
	SourceDegraded SourceStatus = "degraded"
	SourceStale    SourceStatus = "stale"
)

type AltitudeReference string

const (
	AltitudeBarometric AltitudeReference = "barometric"
	AltitudeGeometric  AltitudeReference = "geometric"
	AltitudeGround     AltitudeReference = "ground"
	AltitudeUnknown    AltitudeReference = "unknown"
)

type Observation struct {
	TrackID           string            `json:"trackId"`
	Provider          string            `json:"provider"`
	SourceEpoch       string            `json:"sourceEpoch"`
	SessionGeneration uint64            `json:"sessionGeneration"`
	Address           string            `json:"address"`
	AddressType       string            `json:"addressType"`
	Callsign          string            `json:"callsign,omitempty"`
	Registration      string            `json:"registration,omitempty"`
	AircraftType      string            `json:"aircraftType,omitempty"`
	FixTime           time.Time         `json:"fixTime"`
	ReceivedAt        time.Time         `json:"receivedAt"`
	PublishedAt       time.Time         `json:"publishedAt"`
	Latitude          float64           `json:"latitude"`
	Longitude         float64           `json:"longitude"`
	BaroAltitudeFt    *float64          `json:"baroAltitudeFt,omitempty"`
	GeomAltitudeFt    *float64          `json:"geomAltitudeFt,omitempty"`
	AltitudeReference AltitudeReference `json:"altitudeReference"`
	OnGround          bool              `json:"onGround"`
	TrackDeg          *float64          `json:"trackDeg,omitempty"`
	GroundSpeedKt     *float64          `json:"groundSpeedKt,omitempty"`
	VerticalRateFPM   *float64          `json:"verticalRateFpm,omitempty"`
	PositionSource    string            `json:"positionSource"`
	NIC               *float64          `json:"nic,omitempty"`
	NACP              *float64          `json:"nacP,omitempty"`
	SIL               *float64          `json:"sil,omitempty"`
	Discontinuity     bool              `json:"discontinuity,omitempty"`
}

func (o Observation) Validate() error {
	if o.TrackID == "" || len(o.TrackID) > 128 {
		return errors.New("invalid track id")
	}
	if o.Provider == "" || len(o.Provider) > 64 {
		return errors.New("invalid provider")
	}
	if o.SourceEpoch == "" || len(o.SourceEpoch) > 64 {
		return errors.New("invalid source epoch")
	}
	if o.Address == "" || len(o.Address) > 32 {
		return errors.New("invalid address")
	}
	if o.AddressType == "" || len(o.AddressType) > 32 || len(o.PositionSource) > 32 {
		return errors.New("invalid address or position source type")
	}
	if !finite(o.Latitude) || o.Latitude < -90 || o.Latitude > 90 {
		return errors.New("invalid latitude")
	}
	if !finite(o.Longitude) || o.Longitude < -180 || o.Longitude > 180 {
		return errors.New("invalid longitude")
	}
	if o.FixTime.IsZero() || o.ReceivedAt.IsZero() {
		return errors.New("missing observation timestamps")
	}
	if o.FixTime.After(o.ReceivedAt.Add(30 * time.Second)) {
		return errors.New("fix timestamp is unreasonably far in the future")
	}
	for name, value := range map[string]*float64{
		"barometric altitude": o.BaroAltitudeFt,
		"geometric altitude":  o.GeomAltitudeFt,
		"track":               o.TrackDeg,
		"ground speed":        o.GroundSpeedKt,
		"vertical rate":       o.VerticalRateFPM,
		"nic":                 o.NIC,
		"nacp":                o.NACP,
		"sil":                 o.SIL,
	} {
		if value != nil && !finite(*value) {
			return fmt.Errorf("invalid %s", name)
		}
	}
	if o.TrackDeg != nil && (*o.TrackDeg < 0 || *o.TrackDeg >= 360) {
		return errors.New("track must be in [0, 360)")
	}
	if o.GroundSpeedKt != nil && (*o.GroundSpeedKt < 0 || *o.GroundSpeedKt > 1500) {
		return errors.New("ground speed outside accepted range")
	}
	if o.AltitudeReference == "" {
		return errors.New("missing altitude reference")
	}
	return nil
}

func StableTrackID(provider, sourceEpoch, addressType, address string, session uint64) string {
	material := fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%d", provider, sourceEpoch, addressType, address, session)
	sum := sha256.Sum256([]byte(material))
	return base64.RawURLEncoding.EncodeToString(sum[:18])
}

func SanitizeLabel(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	if value == "" || maxRunes <= 0 {
		return ""
	}
	var result []rune
	for _, current := range value {
		if unicode.IsControl(current) || current == '\u007f' {
			continue
		}
		result = append(result, current)
		if len(result) >= maxRunes {
			break
		}
	}
	return strings.TrimSpace(string(result))
}

type BoundingBox struct {
	West  float64 `json:"west"`
	South float64 `json:"south"`
	East  float64 `json:"east"`
	North float64 `json:"north"`
}

func (b BoundingBox) Validate(maxArea float64) error {
	values := []float64{b.West, b.South, b.East, b.North}
	for _, value := range values {
		if !finite(value) {
			return errors.New("bbox contains a non-finite value")
		}
	}
	if b.West < -180 || b.West > 180 || b.East < -180 || b.East > 180 {
		return errors.New("bbox longitude outside accepted range")
	}
	if b.South < -90 || b.South > 90 || b.North < -90 || b.North > 90 || b.South >= b.North {
		return errors.New("bbox latitude outside accepted range")
	}
	width := b.East - b.West
	if width < 0 {
		width += 360
	}
	area := width * (b.North - b.South)
	if width <= 0 || (maxArea > 0 && area > maxArea) {
		return errors.New("bbox exceeds the accepted area")
	}
	return nil
}

func (b BoundingBox) Contains(latitude, longitude float64) bool {
	if latitude < b.South || latitude > b.North {
		return false
	}
	if b.West <= b.East {
		return longitude >= b.West && longitude <= b.East
	}
	return longitude >= b.West || longitude <= b.East
}

func BoundingBoxAround(latitude, longitude, radiusNM float64) BoundingBox {
	latDelta := radiusNM / 60
	cosLat := math.Cos(latitude * math.Pi / 180)
	if math.Abs(cosLat) < 0.01 {
		cosLat = 0.01
	}
	lonDelta := math.Min(180, radiusNM/(60*math.Abs(cosLat)))
	return BoundingBox{
		West:  wrapLongitude(longitude - lonDelta),
		South: math.Max(-90, latitude-latDelta),
		East:  wrapLongitude(longitude + lonDelta),
		North: math.Min(90, latitude+latDelta),
	}
}

func DistanceNM(lat1, lon1, lat2, lon2 float64) float64 {
	phi1 := lat1 * math.Pi / 180
	phi2 := lat2 * math.Pi / 180
	dPhi := (lat2 - lat1) * math.Pi / 180
	dLambda := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dPhi/2)*math.Sin(dPhi/2) +
		math.Cos(phi1)*math.Cos(phi2)*math.Sin(dLambda/2)*math.Sin(dLambda/2)
	return EarthRadiusNM * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func TileKey(latitude, longitude float64) string {
	latCell := int(math.Floor(math.Max(-90, math.Min(math.Nextafter(90, -1), latitude))))
	lonCell := int(math.Floor(math.Max(-180, math.Min(math.Nextafter(180, -1), longitude))))
	return fmt.Sprintf("%+03d_%+04d", latCell, lonCell)
}

type RetentionInfo struct {
	Start    time.Time `json:"retentionStart"`
	End      time.Time `json:"retentionEnd"`
	Complete bool      `json:"retentionComplete"`
}

type Attribution struct {
	Provider string `json:"provider"`
	Label    string `json:"label,omitempty"`
	URL      string `json:"url,omitempty"`
}

type HistoryTrack struct {
	TrackID      string        `json:"trackId"`
	Address      string        `json:"address"`
	AddressType  string        `json:"addressType"`
	Provider     string        `json:"provider"`
	Observations []Observation `json:"observations"`
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func wrapLongitude(value float64) float64 {
	for value < -180 {
		value += 360
	}
	for value > 180 {
		value -= 360
	}
	return value
}
