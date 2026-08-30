package ingest

import (
	"context"
	"sync"
	"time"

	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
)

type BatchHandler func([]model.Observation)

type Batcher struct {
	mu       sync.Mutex
	pending  map[string]model.Observation
	interval time.Duration
	handle   BatchHandler
}

func NewBatcher(interval time.Duration, handle BatchHandler) *Batcher {
	return &Batcher{
		pending:  make(map[string]model.Observation),
		interval: interval,
		handle:   handle,
	}
}

func (b *Batcher) Add(observation model.Observation) {
	b.mu.Lock()
	b.pending[observation.TrackID] = observation
	b.mu.Unlock()
}

func (b *Batcher) Run(ctx context.Context) {
	ticker := time.NewTicker(b.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			b.Flush()
			return
		case <-ticker.C:
			b.Flush()
		}
	}
}

func (b *Batcher) Flush() {
	b.mu.Lock()
	if len(b.pending) == 0 {
		b.mu.Unlock()
		return
	}
	batch := make([]model.Observation, 0, len(b.pending))
	for _, observation := range b.pending {
		batch = append(batch, observation)
	}
	b.pending = make(map[string]model.Observation)
	b.mu.Unlock()
	b.handle(batch)
}
