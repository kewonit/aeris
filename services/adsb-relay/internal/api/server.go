package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/kewonit/aeris/services/adsb-relay/internal/auth"
	"github.com/kewonit/aeris/services/adsb-relay/internal/config"
	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
	"github.com/kewonit/aeris/services/adsb-relay/internal/store"
	"github.com/kewonit/aeris/services/adsb-relay/internal/stream"
)

const (
	maxJSONResponseBytes  = 16 << 20
	maxStreamMessageBytes = 8 << 20
)

var (
	trackIDPattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	addressPattern  = regexp.MustCompile(`^[0-9A-Fa-f]{6}$`)
	callsignPattern = regexp.MustCompile(`^[A-Z0-9-]{1,8}$`)
)

type Server struct {
	config   config.Config
	store    *store.Store
	hub      *stream.Hub
	verifier *auth.TicketVerifier
	streams  chan struct{}
	handler  http.Handler
}

func NewServer(config config.Config, store *store.Store, hub *stream.Hub, verifier *auth.TicketVerifier) *Server {
	server := &Server{
		config:   config,
		store:    store,
		hub:      hub,
		verifier: verifier,
		streams:  make(chan struct{}, config.MaxConnections),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /livez", server.handleLivez)
	mux.HandleFunc("GET /readyz", server.handleReadyz)
	mux.HandleFunc("GET /status", server.handleStatus)
	mux.HandleFunc("GET /v1/aircraft", server.requireHTTPToken(server.handleAircraft))
	mux.HandleFunc("GET /v1/lookup", server.requireHTTPToken(server.handleLookup))
	mux.HandleFunc("GET /v1/trails", server.requireHTTPToken(server.handleTrails))
	mux.HandleFunc("GET /v1/tracks/{trackID}", server.requireHTTPToken(server.handleTrack))
	mux.HandleFunc("GET /v1/live", server.handleStream)
	server.handler = securityHeaders(mux)
	return server
}

func (s *Server) Handler() http.Handler { return s.handler }

func (s *Server) handleLivez(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "live"})
}

func (s *Server) handleReadyz(w http.ResponseWriter, _ *http.Request) {
	if !s.store.Ready() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	status, _ := s.hub.Status(time.Now().UTC())
	writeJSON(w, http.StatusOK, map[string]string{"status": string(status)})
}

type aircraftEnvelope struct {
	Aircraft []readsbAircraft `json:"ac"`
	Message  string           `json:"msg"`
	Now      int64            `json:"now"`
	Total    int              `json:"total"`
	Meta     responseMeta     `json:"meta"`
}

type readsbAircraft struct {
	Hex          string   `json:"hex"`
	Type         string   `json:"type"`
	Flight       string   `json:"flight,omitempty"`
	Registration string   `json:"r,omitempty"`
	AircraftType string   `json:"t,omitempty"`
	Latitude     float64  `json:"lat"`
	Longitude    float64  `json:"lon"`
	SeenPosition float64  `json:"seen_pos"`
	AltBaro      any      `json:"alt_baro,omitempty"`
	AltGeom      *float64 `json:"alt_geom,omitempty"`
	GroundSpeed  *float64 `json:"gs,omitempty"`
	Track        *float64 `json:"track,omitempty"`
	BaroRate     *float64 `json:"baro_rate,omitempty"`
	TrackID      string   `json:"track_id"`
	FixTime      int64    `json:"fix_time"`
}

type responseMeta struct {
	SourceStatus model.SourceStatus   `json:"sourceStatus"`
	SourceAgeMS  *int64               `json:"sourceAgeMs,omitempty"`
	Attribution  model.Attribution    `json:"attribution"`
	Retention    *model.RetentionInfo `json:"retention,omitempty"`
}

func (s *Server) handleAircraft(w http.ResponseWriter, request *http.Request) {
	now := time.Now().UTC()
	latitude, latOK := queryFloat(request, "lat")
	longitude, lonOK := queryFloat(request, "lon")
	radius, radiusOK := queryFloat(request, "radius")
	if !latOK || !lonOK || !radiusOK || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || radius <= 0 || radius > s.config.MaxRadiusNM {
		writeError(w, http.StatusBadRequest, "invalid point query")
		return
	}
	observations := s.store.CurrentAround(latitude, longitude, radius, now, s.config.AircraftExpiry, s.config.MaxResponseAircraft)
	aircraft := readsbAircraftFromObservations(observations, now)
	status, sourceAge := s.hub.Status(now)
	writeBoundedJSON(w, http.StatusOK, aircraftEnvelope{
		Aircraft: aircraft,
		Message:  "No error",
		Now:      now.UnixMilli(),
		Total:    len(aircraft),
		Meta: responseMeta{
			SourceStatus: status,
			SourceAgeMS:  sourceAge,
			Attribution:  s.attribution(),
		},
	})
}

func (s *Server) handleLookup(w http.ResponseWriter, request *http.Request) {
	address := strings.TrimSpace(request.URL.Query().Get("address"))
	callsign := strings.ToUpper(strings.TrimSpace(request.URL.Query().Get("callsign")))
	if (address == "") == (callsign == "") ||
		(address != "" && !addressPattern.MatchString(address)) ||
		(callsign != "" && !callsignPattern.MatchString(callsign)) {
		writeError(w, http.StatusBadRequest, "exactly one valid address or callsign is required")
		return
	}
	now := time.Now().UTC()
	observations := s.store.CurrentByIdentity(address, callsign, now, s.config.AircraftExpiry, s.config.MaxResponseAircraft)
	aircraft := readsbAircraftFromObservations(observations, now)
	status, sourceAge := s.hub.Status(now)
	writeBoundedJSON(w, http.StatusOK, aircraftEnvelope{
		Aircraft: aircraft,
		Message:  "No error",
		Now:      now.UnixMilli(),
		Total:    len(aircraft),
		Meta: responseMeta{
			SourceStatus: status,
			SourceAgeMS:  sourceAge,
			Attribution:  s.attribution(),
		},
	})
}

func readsbAircraftFromObservations(observations []model.Observation, now time.Time) []readsbAircraft {
	aircraft := make([]readsbAircraft, 0, len(observations))
	for _, observation := range observations {
		altitude := any(nil)
		if observation.OnGround {
			altitude = "ground"
		} else if observation.BaroAltitudeFt != nil {
			altitude = *observation.BaroAltitudeFt
		}
		aircraft = append(aircraft, readsbAircraft{
			Hex:          observation.Address,
			Type:         observation.PositionSource,
			Flight:       observation.Callsign,
			Registration: observation.Registration,
			AircraftType: observation.AircraftType,
			Latitude:     observation.Latitude,
			Longitude:    observation.Longitude,
			SeenPosition: maxFloat(0, now.Sub(observation.FixTime).Seconds()),
			AltBaro:      altitude,
			AltGeom:      observation.GeomAltitudeFt,
			GroundSpeed:  observation.GroundSpeedKt,
			Track:        observation.TrackDeg,
			BaroRate:     observation.VerticalRateFPM,
			TrackID:      observation.TrackID,
			FixTime:      observation.FixTime.UnixMilli(),
		})
	}
	return aircraft
}

type trailsEnvelope struct {
	Tracks []model.HistoryTrack `json:"tracks"`
	Meta   responseMeta         `json:"meta"`
}

func (s *Server) handleTrails(w http.ResponseWriter, request *http.Request) {
	bbox, err := parseBBox(request.URL.Query().Get("bbox"))
	if err != nil || bbox.Validate(s.config.MaxBBoxAreaDegrees) != nil {
		writeError(w, http.StatusBadRequest, "invalid bbox")
		return
	}
	window := queryWindow(request, 10*time.Minute, s.config.HistoryWindow)
	limitPerTrack := queryIntBounded(request, "limitPerAircraft", 120, 2, s.config.MaxHistoryPoints)
	now := time.Now().UTC()
	tracks, retention, err := s.store.Trails(bbox, now, window, s.config.MaxResponseAircraft, limitPerTrack)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "history is temporarily unavailable")
		return
	}
	status, sourceAge := s.hub.Status(now)
	writeBoundedJSON(w, http.StatusOK, trailsEnvelope{
		Tracks: tracks,
		Meta: responseMeta{
			SourceStatus: status,
			SourceAgeMS:  sourceAge,
			Attribution:  s.attribution(),
			Retention:    &retention,
		},
	})
}

type trackEnvelope struct {
	Track *model.HistoryTrack `json:"track"`
	Meta  responseMeta        `json:"meta"`
}

func (s *Server) handleTrack(w http.ResponseWriter, request *http.Request) {
	trackID := request.PathValue("trackID")
	if !trackIDPattern.MatchString(trackID) {
		writeError(w, http.StatusBadRequest, "invalid track id")
		return
	}
	window := queryWindow(request, s.config.HistoryWindow, s.config.HistoryWindow)
	limit := queryIntBounded(request, "limit", 720, 2, s.config.MaxHistoryPoints)
	now := time.Now().UTC()
	observations, retention, err := s.store.Track(trackID, now, window, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "history is temporarily unavailable")
		return
	}
	var track *model.HistoryTrack
	if len(observations) > 0 {
		track = &model.HistoryTrack{
			TrackID:      trackID,
			Address:      observations[len(observations)-1].Address,
			AddressType:  observations[len(observations)-1].AddressType,
			Provider:     observations[len(observations)-1].Provider,
			Observations: observations,
		}
	}
	status, sourceAge := s.hub.Status(now)
	writeBoundedJSON(w, http.StatusOK, trackEnvelope{
		Track: track,
		Meta: responseMeta{
			SourceStatus: status,
			SourceAgeMS:  sourceAge,
			Attribution:  s.attribution(),
			Retention:    &retention,
		},
	})
}

func (s *Server) handleStream(w http.ResponseWriter, request *http.Request) {
	origin := request.Header.Get("Origin")
	if _, allowed := s.config.AllowedOrigins[origin]; !allowed {
		writeError(w, http.StatusForbidden, "origin is not allowed")
		return
	}
	ticket := streamTicket(request.Header.Values("Sec-WebSocket-Protocol"))
	if ticket == "" {
		writeError(w, http.StatusUnauthorized, "stream ticket is required")
		return
	}
	if _, err := s.verifier.VerifyAndConsume(ticket, origin); err != nil {
		writeError(w, http.StatusUnauthorized, "stream ticket is invalid")
		return
	}
	select {
	case s.streams <- struct{}{}:
		defer func() { <-s.streams }()
	default:
		writeError(w, http.StatusServiceUnavailable, "stream capacity is temporarily unavailable")
		return
	}
	origins := make([]string, 0, len(s.config.AllowedOrigins))
	for value := range s.config.AllowedOrigins {
		origins = append(origins, value)
	}
	sort.Strings(origins)
	connection, err := websocket.Accept(w, request, &websocket.AcceptOptions{
		Subprotocols:    []string{"aeris.v1"},
		OriginPatterns:  origins,
		CompressionMode: websocket.CompressionDisabled,
	})
	if err != nil {
		return
	}
	defer connection.CloseNow()
	connection.SetReadLimit(16 << 10)

	firstContext, cancelFirst := context.WithTimeout(request.Context(), 5*time.Second)
	var subscriptionRequest stream.SubscribeRequest
	err = wsjson.Read(firstContext, connection, &subscriptionRequest)
	cancelFirst()
	if err != nil || subscriptionRequest.BBox.Validate(s.config.MaxBBoxAreaDegrees) != nil {
		_ = connection.Close(websocket.StatusPolicyViolation, "valid subscription required")
		return
	}
	subscription, err := s.hub.Register(subscriptionRequest, time.Now().UTC())
	if err != nil {
		_ = connection.Close(websocket.StatusPolicyViolation, "invalid subscription")
		return
	}
	defer subscription.Close()

	ctx, cancel := context.WithCancel(request.Context())
	defer cancel()
	writerDone := make(chan error, 1)
	go func() { writerDone <- s.writeStream(ctx, connection, subscription) }()
	changeWindowStarted := time.Now().UTC()
	changeCount := 0
	for {
		var update stream.SubscribeRequest
		if err := wsjson.Read(ctx, connection, &update); err != nil {
			cancel()
			<-writerDone
			return
		}
		now := time.Now().UTC()
		if now.Sub(changeWindowStarted) >= time.Minute {
			changeWindowStarted = now
			changeCount = 0
		}
		changeCount++
		if changeCount > s.config.MaxSubscriptionChanges || update.BBox.Validate(s.config.MaxBBoxAreaDegrees) != nil || subscription.Update(update, now) != nil {
			_ = connection.Close(websocket.StatusPolicyViolation, "invalid subscription update")
			cancel()
			<-writerDone
			return
		}
	}
}

func (s *Server) writeStream(ctx context.Context, connection *websocket.Conn, subscription *stream.Subscription) error {
	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-subscription.Done():
			return connection.Close(websocket.StatusTryAgainLater, "resnapshot required")
		case message := <-subscription.Messages():
			writeContext, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := writeStreamMessage(writeContext, connection, message)
			cancel()
			if err != nil {
				return err
			}
		case now := <-heartbeat.C:
			writeContext, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := writeStreamMessage(writeContext, connection, subscription.Heartbeat(now.UTC()))
			cancel()
			if err != nil {
				return err
			}
		}
	}
}

func writeStreamMessage(ctx context.Context, connection *websocket.Conn, message stream.Message) error {
	payload, err := json.Marshal(message)
	if err != nil {
		return err
	}
	if len(payload) > maxStreamMessageBytes {
		return connection.Close(websocket.StatusMessageTooBig, "stream message exceeded bounds")
	}
	return connection.Write(ctx, websocket.MessageText, payload)
}

func (s *Server) requireHTTPToken(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		if s.config.HTTPToken == "" {
			writeError(w, http.StatusServiceUnavailable, "server authorization is not configured")
			return
		}
		provided := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
		if len(provided) != len(s.config.HTTPToken) || subtle.ConstantTimeCompare([]byte(provided), []byte(s.config.HTTPToken)) != 1 {
			writeError(w, http.StatusUnauthorized, "authorization is required")
			return
		}
		next(w, request)
	}
}

func (s *Server) attribution() model.Attribution {
	return model.Attribution{Provider: s.config.ProviderID, Label: s.config.ProviderLabel, URL: s.config.AttributionURL}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, request)
	})
}

func parseBBox(raw string) (model.BoundingBox, error) {
	parts := strings.Split(raw, ",")
	if len(parts) != 4 {
		return model.BoundingBox{}, errors.New("bbox requires four values")
	}
	values := make([]float64, 4)
	for index, part := range parts {
		value, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err != nil {
			return model.BoundingBox{}, err
		}
		values[index] = value
	}
	return model.BoundingBox{West: values[0], South: values[1], East: values[2], North: values[3]}, nil
}

func queryFloat(request *http.Request, key string) (float64, bool) {
	value, err := strconv.ParseFloat(request.URL.Query().Get(key), 64)
	return value, err == nil
}

func queryWindow(request *http.Request, fallback, maximum time.Duration) time.Duration {
	raw := request.URL.Query().Get("window")
	if raw == "" {
		return fallback
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		return fallback
	}
	result := time.Duration(seconds) * time.Second
	if result > maximum {
		return maximum
	}
	return result
}

func queryIntBounded(request *http.Request, key string, fallback, minimum, maximum int) int {
	raw := request.URL.Query().Get(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum {
		return fallback
	}
	if value > maximum {
		return maximum
	}
	return value
}

func streamTicket(headers []string) string {
	for _, header := range headers {
		for _, protocol := range strings.Split(header, ",") {
			protocol = strings.TrimSpace(protocol)
			if strings.HasPrefix(protocol, "aeris.ticket.") {
				return strings.TrimPrefix(protocol, "aeris.ticket.")
			}
		}
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeBoundedJSON(w http.ResponseWriter, status int, value any) {
	payload, err := json.Marshal(value)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "response encoding failed")
		return
	}
	if len(payload) > maxJSONResponseBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "response exceeds configured bounds")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func maxFloat(left, right float64) float64 {
	if left > right {
		return left
	}
	return right
}
