package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kewonit/aeris/services/adsb-relay/internal/api"
	"github.com/kewonit/aeris/services/adsb-relay/internal/auth"
	"github.com/kewonit/aeris/services/adsb-relay/internal/config"
	"github.com/kewonit/aeris/services/adsb-relay/internal/ingest"
	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
	"github.com/kewonit/aeris/services/adsb-relay/internal/store"
	"github.com/kewonit/aeris/services/adsb-relay/internal/stream"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("relay stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	settings, err := config.Load()
	if err != nil {
		return err
	}
	history, err := store.Open(store.Options{
		DataDir:               settings.DataDir,
		HistoryWindow:         settings.HistoryWindow,
		RetentionWindow:       settings.RetentionWindow,
		SegmentDuration:       settings.SegmentDuration,
		LatenessGrace:         settings.LatenessGrace,
		MaxCurrentAircraft:    settings.MaxCurrentAircraft,
		BlockCacheEntries:     settings.BlockCacheEntries,
		EmergencyHistoryBytes: settings.EmergencyHistoryBytes,
	})
	if err != nil {
		return err
	}
	defer history.Close()
	hub, err := stream.NewHub(settings.SocketQueueDepth, settings.MaxResponseAircraft, settings.MaxCurrentAircraft)
	if err != nil {
		return err
	}
	verifier := auth.NewTicketVerifier(settings.TicketPublicKey, settings.AllowedOrigins, settings.MaxConnections*4)
	handler := api.NewServer(settings, history, hub, verifier)
	server := &http.Server{
		Addr:              settings.ListenAddr,
		Handler:           handler.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	workerContext, cancelWorkers := context.WithCancel(ctx)
	defer cancelWorkers()
	batcher := ingest.NewBatcher(time.Second, func(observations []model.Observation) {
		hub.ApplyBatch(observations, time.Now().UTC())
	})
	go batcher.Run(workerContext)
	if settings.ReadsbURL == "" {
		hub.SetSourceStatus(model.SourceDegraded, time.Time{}, time.Now().UTC())
		logger.Warn("authorized source is not configured")
	} else {
		normalizer, err := ingest.NewNormalizer(settings.ProviderID, settings.SourceStaleAfter)
		if err != nil {
			return err
		}
		client := ingest.NewReadsbClient(settings.ReadsbURL, settings.MaxSourceBodyBytes, nil)
		go runSource(workerContext, logger, settings, client, normalizer, history, hub, batcher)
	}
	go runExpiry(workerContext, settings.AircraftExpiry, history, hub)

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("relay listening")
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
	case serverErr := <-serverErrors:
		if !errors.Is(serverErr, http.ErrServerClosed) {
			cancelWorkers()
			return serverErr
		}
	}
	cancelWorkers()
	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), settings.GracefulShutdownDuration)
	defer cancelShutdown()
	if err := server.Shutdown(shutdownContext); err != nil {
		return err
	}
	return history.Close()
}

func runSource(
	ctx context.Context,
	logger *slog.Logger,
	settings config.Config,
	client *ingest.ReadsbClient,
	normalizer *ingest.Normalizer,
	history *store.Store,
	hub *stream.Hub,
	batcher *ingest.Batcher,
) {
	ticker := time.NewTicker(settings.PollInterval)
	defer ticker.Stop()
	lastSuccess := time.Time{}
	wasStale := false
	poll := func() {
		fetchContext, cancel := context.WithTimeout(ctx, settings.PollInterval)
		envelope, receivedAt, err := client.Fetch(fetchContext)
		cancel()
		if err != nil {
			now := time.Now().UTC()
			if wasStale {
				hub.SetSourceStatus(model.SourceStale, time.Time{}, now)
			} else if lastSuccess.IsZero() {
				hub.SetSourceStatus(model.SourceDegraded, time.Time{}, now)
			} else if now.Sub(lastSuccess) >= settings.SourceStaleAfter {
				wasStale = true
				hub.SetSourceStatus(model.SourceStale, lastSuccess, now)
			}
			logger.Warn("authorized source poll failed")
			return
		}
		responseTime := envelope.ResponseTime(receivedAt)
		if responseTime.IsZero() {
			if wasStale {
				hub.SetSourceStatus(model.SourceStale, time.Time{}, receivedAt)
			} else if lastSuccess.IsZero() {
				hub.SetSourceStatus(model.SourceDegraded, time.Time{}, receivedAt)
			} else if receivedAt.Sub(lastSuccess) >= settings.SourceStaleAfter {
				wasStale = true
				hub.SetSourceStatus(model.SourceStale, lastSuccess, receivedAt)
			}
			logger.Warn("authorized source returned an invalid timestamp")
			return
		}
		latestFixTime := envelope.LatestFixTime(responseTime)
		if !envelope.IsFresh(responseTime, receivedAt, settings.SourceStaleAfter) {
			wasStale = true
			hub.SetSourceStatus(model.SourceStale, latestFixTime, receivedAt)
			logger.Warn("authorized source returned a stale snapshot")
			return
		}
		if wasStale {
			if err := normalizer.RotateSourceEpoch(); err != nil {
				logger.Error("source epoch rotation failed", "error", err)
				return
			}
			hub.ResetAfterSourceRecovery(receivedAt)
			wasStale = false
		}
		lastSuccess = receivedAt
		accepted := 0
		for _, raw := range envelope.Entries() {
			observation, keep, err := normalizer.Normalize(raw, responseTime, receivedAt)
			if err != nil || !keep {
				continue
			}
			if err := history.Accept(observation); err != nil {
				logger.Error("normalized observation persistence failed", "error", err)
				continue
			}
			batcher.Add(observation)
			accepted++
		}
		hub.SetSourceStatus(model.SourceLive, latestFixTime, receivedAt)
		logger.Debug("authorized source poll accepted", "observations", accepted)
	}
	poll()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			poll()
		}
	}
}

func runExpiry(ctx context.Context, expiry time.Duration, history *store.Store, hub *stream.Hub) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			history.PurgeCurrentBefore(now.UTC().Add(-expiry))
			hub.RemoveExpired(now.UTC(), expiry)
		}
	}
}
