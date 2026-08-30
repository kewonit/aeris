package stream

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
)

type SubscribeRequest struct {
	Type                 string            `json:"type"`
	ProtocolVersion      int               `json:"protocolVersion"`
	SubscriptionRevision uint64            `json:"subscriptionRevision"`
	BBox                 model.BoundingBox `json:"bbox"`
}

type Message struct {
	Type                 string              `json:"type"`
	ProtocolVersion      int                 `json:"protocolVersion"`
	ServerEpoch          string              `json:"serverEpoch"`
	SubscriptionRevision uint64              `json:"subscriptionRevision"`
	Sequence             uint64              `json:"sequence"`
	AsOf                 time.Time           `json:"asOf"`
	SourceStatus         model.SourceStatus  `json:"sourceStatus,omitempty"`
	SourceAgeMS          *int64              `json:"sourceAgeMs,omitempty"`
	Aircraft             []model.Observation `json:"aircraft,omitempty"`
	Upserts              []model.Observation `json:"upserts,omitempty"`
	Removals             []string            `json:"removals,omitempty"`
	Reason               string              `json:"reason,omitempty"`
}

type Subscription struct {
	hub      *Hub
	queue    chan Message
	done     chan struct{}
	closed   bool
	bbox     model.BoundingBox
	revision uint64
	visible  map[string]struct{}
}

func (s *Subscription) Messages() <-chan Message { return s.queue }
func (s *Subscription) Done() <-chan struct{}    { return s.done }

func (s *Subscription) Update(request SubscribeRequest, now time.Time) error {
	return s.hub.updateSubscription(s, request, now)
}

func (s *Subscription) Heartbeat(now time.Time) Message {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	return Message{
		Type:                 "heartbeat",
		ProtocolVersion:      model.ProtocolVersion,
		ServerEpoch:          s.hub.serverEpoch,
		SubscriptionRevision: s.revision,
		Sequence:             s.hub.sequence,
		AsOf:                 now.UTC(),
		SourceStatus:         s.hub.sourceStatus,
		SourceAgeMS:          s.hub.sourceAgeLocked(now),
	}
}

func (s *Subscription) Close() {
	s.hub.closeSubscription(s)
}

type Hub struct {
	mu           sync.Mutex
	serverEpoch  string
	sequence     uint64
	current      map[string]model.Observation
	clients      map[*Subscription]struct{}
	queueDepth   int
	sourceStatus model.SourceStatus
	lastSourceAt time.Time
}

func NewHub(queueDepth int) (*Hub, error) {
	if queueDepth <= 0 {
		return nil, errors.New("queue depth must be positive")
	}
	var epoch [16]byte
	if _, err := rand.Read(epoch[:]); err != nil {
		return nil, err
	}
	return &Hub{
		serverEpoch:  hex.EncodeToString(epoch[:]),
		current:      make(map[string]model.Observation),
		clients:      make(map[*Subscription]struct{}),
		queueDepth:   queueDepth,
		sourceStatus: model.SourceStarting,
	}, nil
}

func (h *Hub) Register(request SubscribeRequest, now time.Time) (*Subscription, error) {
	if request.Type != "subscribe" || request.ProtocolVersion != model.ProtocolVersion || request.SubscriptionRevision == 0 {
		return nil, errors.New("invalid subscription request")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	subscription := &Subscription{
		hub:      h,
		queue:    make(chan Message, h.queueDepth),
		done:     make(chan struct{}),
		bbox:     request.BBox,
		revision: request.SubscriptionRevision,
		visible:  make(map[string]struct{}),
	}
	h.clients[subscription] = struct{}{}
	h.enqueueSnapshotLocked(subscription, now, "")
	return subscription, nil
}

func (h *Hub) ApplyBatch(observations []model.Observation, publishedAt time.Time) {
	if len(observations) == 0 {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sequence++
	for index := range observations {
		observations[index].PublishedAt = publishedAt.UTC()
		h.current[observations[index].TrackID] = observations[index]
	}
	for subscription := range h.clients {
		upserts := make([]model.Observation, 0)
		removals := make([]string, 0)
		for _, observation := range observations {
			_, wasVisible := subscription.visible[observation.TrackID]
			isVisible := subscription.bbox.Contains(observation.Latitude, observation.Longitude)
			switch {
			case isVisible:
				subscription.visible[observation.TrackID] = struct{}{}
				upserts = append(upserts, observation)
			case wasVisible:
				delete(subscription.visible, observation.TrackID)
				removals = append(removals, observation.TrackID)
			}
		}
		if len(upserts) == 0 && len(removals) == 0 {
			continue
		}
		h.enqueueLocked(subscription, Message{
			Type:                 "delta",
			ProtocolVersion:      model.ProtocolVersion,
			ServerEpoch:          h.serverEpoch,
			SubscriptionRevision: subscription.revision,
			Sequence:             h.sequence,
			AsOf:                 publishedAt.UTC(),
			SourceStatus:         h.sourceStatus,
			SourceAgeMS:          h.sourceAgeLocked(publishedAt),
			Upserts:              upserts,
			Removals:             removals,
		})
	}
}

func (h *Hub) SetSourceStatus(status model.SourceStatus, sourceObservedAt, now time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !sourceObservedAt.IsZero() {
		h.lastSourceAt = sourceObservedAt.UTC()
	}
	if h.sourceStatus == status && status == model.SourceLive {
		return
	}
	h.sourceStatus = status
	h.sequence++
	for subscription := range h.clients {
		h.enqueueLocked(subscription, Message{
			Type:                 "source_status",
			ProtocolVersion:      model.ProtocolVersion,
			ServerEpoch:          h.serverEpoch,
			SubscriptionRevision: subscription.revision,
			Sequence:             h.sequence,
			AsOf:                 now.UTC(),
			SourceStatus:         status,
			SourceAgeMS:          h.sourceAgeLocked(now),
		})
	}
}

func (h *Hub) ResetAfterSourceRecovery(now time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.current = make(map[string]model.Observation)
	h.sequence++
	for subscription := range h.clients {
		subscription.visible = make(map[string]struct{})
		h.enqueueSnapshotLocked(subscription, now, "source_recovered")
	}
}

func (h *Hub) RemoveExpired(now time.Time, expiry time.Duration) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.sourceStatus != model.SourceLive {
		return
	}
	removed := make([]string, 0)
	for trackID, observation := range h.current {
		if now.Sub(observation.ReceivedAt) > expiry {
			delete(h.current, trackID)
			removed = append(removed, trackID)
		}
	}
	if len(removed) == 0 {
		return
	}
	sort.Strings(removed)
	h.sequence++
	for subscription := range h.clients {
		visibleRemovals := make([]string, 0)
		for _, trackID := range removed {
			if _, ok := subscription.visible[trackID]; ok {
				delete(subscription.visible, trackID)
				visibleRemovals = append(visibleRemovals, trackID)
			}
		}
		if len(visibleRemovals) == 0 {
			continue
		}
		h.enqueueLocked(subscription, Message{
			Type:                 "delta",
			ProtocolVersion:      model.ProtocolVersion,
			ServerEpoch:          h.serverEpoch,
			SubscriptionRevision: subscription.revision,
			Sequence:             h.sequence,
			AsOf:                 now.UTC(),
			SourceStatus:         h.sourceStatus,
			SourceAgeMS:          h.sourceAgeLocked(now),
			Removals:             visibleRemovals,
		})
	}
}

func (h *Hub) Status(now time.Time) (model.SourceStatus, *int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.sourceStatus, h.sourceAgeLocked(now)
}

func (h *Hub) updateSubscription(subscription *Subscription, request SubscribeRequest, now time.Time) error {
	if request.Type != "subscribe" || request.ProtocolVersion != model.ProtocolVersion || request.SubscriptionRevision <= subscription.revision {
		return errors.New("invalid subscription revision")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if subscription.closed {
		return errors.New("subscription is closed")
	}
	subscription.bbox = request.BBox
	subscription.revision = request.SubscriptionRevision
	subscription.visible = make(map[string]struct{})
	h.enqueueSnapshotLocked(subscription, now, "viewport_changed")
	return nil
}

func (h *Hub) closeSubscription(subscription *Subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closeLocked(subscription)
}

func (h *Hub) enqueueSnapshotLocked(subscription *Subscription, now time.Time, reason string) {
	aircraft := make([]model.Observation, 0)
	for _, observation := range h.current {
		if subscription.bbox.Contains(observation.Latitude, observation.Longitude) {
			aircraft = append(aircraft, observation)
			subscription.visible[observation.TrackID] = struct{}{}
		}
	}
	sort.Slice(aircraft, func(i, j int) bool { return aircraft[i].TrackID < aircraft[j].TrackID })
	h.enqueueLocked(subscription, Message{
		Type:                 "snapshot",
		ProtocolVersion:      model.ProtocolVersion,
		ServerEpoch:          h.serverEpoch,
		SubscriptionRevision: subscription.revision,
		Sequence:             h.sequence,
		AsOf:                 now.UTC(),
		SourceStatus:         h.sourceStatus,
		SourceAgeMS:          h.sourceAgeLocked(now),
		Aircraft:             aircraft,
		Reason:               reason,
	})
}

func (h *Hub) enqueueLocked(subscription *Subscription, message Message) {
	if subscription.closed {
		return
	}
	select {
	case subscription.queue <- message:
	default:
		h.closeLocked(subscription)
	}
}

func (h *Hub) closeLocked(subscription *Subscription) {
	if subscription.closed {
		return
	}
	subscription.closed = true
	delete(h.clients, subscription)
	close(subscription.done)
}

func (h *Hub) sourceAgeLocked(now time.Time) *int64 {
	if h.lastSourceAt.IsZero() {
		return nil
	}
	value := now.Sub(h.lastSourceAt).Milliseconds()
	if value < 0 {
		value = 0
	}
	return &value
}
