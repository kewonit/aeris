package ingest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type RawAltitude struct {
	Value  *float64
	Ground bool
}

func (a *RawAltitude) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return nil
	}
	var number float64
	if err := json.Unmarshal(data, &number); err == nil {
		a.Value = &number
		return nil
	}
	var text string
	if err := json.Unmarshal(data, &text); err == nil && strings.EqualFold(text, "ground") {
		a.Ground = true
		return nil
	}
	// A malformed optional altitude must not invalidate the entire feed
	// snapshot. The normalizer treats it as unavailable and still validates
	// every required position field independently.
	return nil
}

type RawAircraft struct {
	Hex          string      `json:"hex"`
	Type         string      `json:"type"`
	Flight       string      `json:"flight"`
	Registration string      `json:"r"`
	AircraftType string      `json:"t"`
	Latitude     *float64    `json:"lat"`
	Longitude    *float64    `json:"lon"`
	SeenPosition *float64    `json:"seen_pos"`
	AltBaro      RawAltitude `json:"alt_baro"`
	AltGeom      *float64    `json:"alt_geom"`
	GroundSpeed  *float64    `json:"gs"`
	Track        *float64    `json:"track"`
	BaroRate     *float64    `json:"baro_rate"`
	GeomRate     *float64    `json:"geom_rate"`
	NIC          *float64    `json:"nic"`
	NACP         *float64    `json:"nac_p"`
	SIL          *float64    `json:"sil"`
}

type ReadsbEnvelope struct {
	Now      float64           `json:"now"`
	Aircraft []json.RawMessage `json:"aircraft"`
	AC       []json.RawMessage `json:"ac"`
}

func (e ReadsbEnvelope) Entries() []RawAircraft {
	rawEntries := e.AC
	if len(e.Aircraft) > 0 {
		rawEntries = e.Aircraft
	}
	entries := make([]RawAircraft, 0, len(rawEntries))
	for _, raw := range rawEntries {
		var aircraft RawAircraft
		if err := json.Unmarshal(raw, &aircraft); err == nil {
			entries = append(entries, aircraft)
		}
	}
	return entries
}

func (e ReadsbEnvelope) LatestFixTime(responseTime time.Time) time.Time {
	latest := time.Time{}
	for _, aircraft := range e.Entries() {
		if aircraft.Latitude == nil || aircraft.Longitude == nil {
			continue
		}
		fixTime := responseTime
		if aircraft.SeenPosition != nil && finite(*aircraft.SeenPosition) && *aircraft.SeenPosition >= 0 {
			fixTime = responseTime.Add(-time.Duration(*aircraft.SeenPosition * float64(time.Second)))
		}
		if latest.IsZero() || fixTime.After(latest) {
			latest = fixTime
		}
	}
	if latest.IsZero() {
		return responseTime
	}
	return latest.UTC()
}

func (e ReadsbEnvelope) ResponseTime(receivedAt time.Time) time.Time {
	if e.Now <= 0 {
		return receivedAt
	}
	if e.Now > 10_000_000_000 {
		return time.UnixMilli(int64(e.Now)).UTC()
	}
	seconds := int64(e.Now)
	nanos := int64((e.Now - float64(seconds)) * float64(time.Second))
	return time.Unix(seconds, nanos).UTC()
}

type ReadsbClient struct {
	url          string
	maxBodyBytes int64
	httpClient   *http.Client
}

func NewReadsbClient(url string, maxBodyBytes int64, httpClient *http.Client) *ReadsbClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &ReadsbClient{url: url, maxBodyBytes: maxBodyBytes, httpClient: httpClient}
}

func (c *ReadsbClient) Fetch(ctx context.Context) (ReadsbEnvelope, time.Time, error) {
	receivedAt := time.Now().UTC()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return ReadsbEnvelope{}, receivedAt, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return ReadsbEnvelope{}, receivedAt, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ReadsbEnvelope{}, receivedAt, fmt.Errorf("readsb returned HTTP %d", response.StatusCode)
	}
	limited := io.LimitReader(response.Body, c.maxBodyBytes+1)
	payload, err := io.ReadAll(limited)
	if err != nil {
		return ReadsbEnvelope{}, receivedAt, err
	}
	if int64(len(payload)) > c.maxBodyBytes {
		return ReadsbEnvelope{}, receivedAt, errors.New("readsb response exceeded configured size limit")
	}
	var envelope ReadsbEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return ReadsbEnvelope{}, receivedAt, errors.New("readsb returned malformed JSON")
	}
	return envelope, receivedAt, nil
}

func NewSourceEpoch() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}
