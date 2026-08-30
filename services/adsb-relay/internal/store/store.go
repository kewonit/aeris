package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
)

type Options struct {
	DataDir               string
	HistoryWindow         time.Duration
	RetentionWindow       time.Duration
	SegmentDuration       time.Duration
	BlockCacheEntries     int
	EmergencyHistoryBytes int64
}

type rotation struct {
	walPath string
	records []model.Observation
}

const maxPendingSegments = 3

type Store struct {
	mu               sync.RWMutex
	options          Options
	walDirectory     string
	segmentDirectory string
	active           *WALWriter
	activeStart      time.Time
	activeRecords    []model.Observation
	pending          map[string][]model.Observation
	manifests        []SegmentManifest
	current          map[string]model.Observation
	cache            *blockCache
	ready            bool
	closed           bool
	incompleteUntil  time.Time
	finalize         chan rotation
	stop             chan struct{}
	wg               sync.WaitGroup
}

func Open(options Options) (*Store, error) {
	if options.DataDir == "" || options.HistoryWindow <= 0 || options.RetentionWindow < options.HistoryWindow || options.SegmentDuration <= 0 {
		return nil, errors.New("invalid store options")
	}
	if options.BlockCacheEntries <= 0 {
		return nil, errors.New("block cache size must be positive")
	}
	walDirectory := filepath.Join(options.DataDir, "wal")
	segmentDirectory := filepath.Join(options.DataDir, "segments")
	if err := os.MkdirAll(walDirectory, 0o700); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(segmentDirectory, 0o700); err != nil {
		return nil, err
	}
	manifests, err := loadManifests(segmentDirectory)
	if err != nil {
		return nil, err
	}
	store := &Store{
		options:          options,
		walDirectory:     walDirectory,
		segmentDirectory: segmentDirectory,
		pending:          make(map[string][]model.Observation),
		manifests:        manifests,
		current:          make(map[string]model.Observation),
		cache:            newBlockCache(options.BlockCacheEntries),
		finalize:         make(chan rotation, 16),
		stop:             make(chan struct{}),
	}
	if err := store.restoreCurrentFromSegments(); err != nil {
		return nil, err
	}
	recovered, err := filepath.Glob(filepath.Join(walDirectory, "*.wal"))
	if err != nil {
		return nil, err
	}
	sort.Strings(recovered)
	rotations := make([]rotation, 0, len(recovered))
	for _, path := range recovered {
		records, truncated, err := ReadWAL(path)
		if err != nil {
			return nil, fmt.Errorf("recover %s: %w", filepath.Base(path), err)
		}
		if truncated {
			store.incompleteUntil = time.Now().UTC().Add(options.HistoryWindow)
		}
		if len(records) == 0 {
			_ = os.Remove(path)
			continue
		}
		store.pending[path] = records
		for _, record := range records {
			store.updateCurrent(record)
		}
		rotations = append(rotations, rotation{walPath: path, records: records})
	}
	if len(store.current) > 0 || len(store.manifests) > 0 {
		store.ready = true
	}
	if err := store.openNewActive(time.Now().UTC()); err != nil {
		return nil, err
	}
	store.wg.Add(2)
	go store.finalizerLoop()
	go store.maintenanceLoop()
	for _, item := range rotations {
		store.finalize <- item
	}
	return store, nil
}

func (s *Store) Accept(observation model.Observation) error {
	if err := observation.Validate(); err != nil {
		return err
	}
	var rotated *rotation
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return errors.New("store is closed")
	}
	if len(s.activeRecords) > 0 && observation.ReceivedAt.Sub(s.activeStart) >= s.options.SegmentDuration {
		item, err := s.rotateLocked(observation.ReceivedAt)
		if err != nil {
			s.mu.Unlock()
			return err
		}
		rotated = &item
	}
	if err := s.active.Append(observation); err != nil {
		s.mu.Unlock()
		return err
	}
	s.activeRecords = append(s.activeRecords, observation)
	s.updateCurrent(observation)
	s.ready = true
	s.mu.Unlock()
	if rotated != nil {
		s.finalize <- *rotated
	}
	return nil
}

func (s *Store) Current(bbox model.BoundingBox, now time.Time, expiry time.Duration, limit int) []model.Observation {
	s.mu.RLock()
	result := make([]model.Observation, 0)
	for _, observation := range s.current {
		if expiry > 0 && now.Sub(observation.ReceivedAt) > expiry {
			continue
		}
		if bbox.Contains(observation.Latitude, observation.Longitude) {
			result = append(result, observation)
		}
	}
	s.mu.RUnlock()
	sort.Slice(result, func(i, j int) bool { return result[i].TrackID < result[j].TrackID })
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result
}

func (s *Store) CurrentAround(latitude, longitude, radiusNM float64, now time.Time, expiry time.Duration, limit int) []model.Observation {
	bbox := model.BoundingBoxAround(latitude, longitude, radiusNM)
	candidates := s.Current(bbox, now, expiry, 0)
	result := candidates[:0]
	for _, observation := range candidates {
		if model.DistanceNM(latitude, longitude, observation.Latitude, observation.Longitude) <= radiusNM {
			result = append(result, observation)
		}
	}
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result
}

func (s *Store) Track(trackID string, now time.Time, window time.Duration, limit int) ([]model.Observation, model.RetentionInfo, error) {
	if trackID == "" || len(trackID) > 128 {
		return nil, model.RetentionInfo{}, errors.New("invalid track id")
	}
	window = s.boundWindow(window)
	from := now.Add(-window)
	manifests, pending, active := s.snapshotHistorySources()
	result := make([]model.Observation, 0)
	for _, manifest := range manifests {
		if manifest.End.Before(from) || manifest.Start.After(now) {
			continue
		}
		for _, tile := range manifest.Tracks[trackID] {
			records, err := readBlock(s.segmentDirectory, manifest, tile, s.cache)
			if err != nil {
				return nil, model.RetentionInfo{}, err
			}
			result = appendMatching(result, records, from, now, trackID, nil)
		}
	}
	for _, records := range pending {
		result = appendMatching(result, records, from, now, trackID, nil)
	}
	result = appendMatching(result, active, from, now, trackID, nil)
	result = sortDeduplicate(result)
	result = downsample(result, limit)
	return result, s.Retention(now, window), nil
}

func (s *Store) Trails(bbox model.BoundingBox, now time.Time, window time.Duration, maxTracks, limitPerTrack int) ([]model.HistoryTrack, model.RetentionInfo, error) {
	window = s.boundWindow(window)
	from := now.Add(-window)
	manifests, pending, active := s.snapshotHistorySources()
	grouped := make(map[string][]model.Observation)
	for _, manifest := range manifests {
		if manifest.End.Before(from) || manifest.Start.After(now) {
			continue
		}
		for _, tile := range manifestTilesForBBox(manifest, bbox) {
			records, err := readBlock(s.segmentDirectory, manifest, tile, s.cache)
			if err != nil {
				return nil, model.RetentionInfo{}, err
			}
			appendGrouped(grouped, records, from, now, bbox)
		}
	}
	for _, records := range pending {
		appendGrouped(grouped, records, from, now, bbox)
	}
	appendGrouped(grouped, active, from, now, bbox)
	trackIDs := make([]string, 0, len(grouped))
	for trackID := range grouped {
		trackIDs = append(trackIDs, trackID)
	}
	sort.Strings(trackIDs)
	if maxTracks > 0 && len(trackIDs) > maxTracks {
		trackIDs = trackIDs[:maxTracks]
	}
	tracks := make([]model.HistoryTrack, 0, len(trackIDs))
	for _, trackID := range trackIDs {
		records := downsample(sortDeduplicate(grouped[trackID]), limitPerTrack)
		if len(records) == 0 {
			continue
		}
		tracks = append(tracks, model.HistoryTrack{
			TrackID:      trackID,
			Address:      records[len(records)-1].Address,
			AddressType:  records[len(records)-1].AddressType,
			Provider:     records[len(records)-1].Provider,
			Observations: records,
		})
	}
	return tracks, s.Retention(now, window), nil
}

func (s *Store) Retention(now time.Time, window time.Duration) model.RetentionInfo {
	window = s.boundWindow(window)
	s.mu.RLock()
	start := time.Time{}
	end := time.Time{}
	for _, manifest := range s.manifests {
		start, end = extendRange(start, end, manifest.Start, manifest.End)
	}
	for _, records := range s.pending {
		for _, record := range records {
			start, end = extendRange(start, end, record.ReceivedAt, record.ReceivedAt)
		}
	}
	for _, record := range s.activeRecords {
		start, end = extendRange(start, end, record.ReceivedAt, record.ReceivedAt)
	}
	incompleteUntil := s.incompleteUntil
	s.mu.RUnlock()
	complete := !start.IsZero() && !start.After(now.Add(-window)) && !now.Before(incompleteUntil)
	return model.RetentionInfo{Start: start, End: end, Complete: complete}
}

func (s *Store) Ready() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ready && !s.closed
}

func (s *Store) PurgeCurrentBefore(cutoff time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for trackID, observation := range s.current {
		if observation.ReceivedAt.Before(cutoff) {
			delete(s.current, trackID)
		}
	}
}

func (s *Store) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	close(s.stop)
	active := s.active
	s.mu.Unlock()
	err := active.Close()
	s.wg.Wait()
	return err
}

func (s *Store) rotateLocked(now time.Time) (rotation, error) {
	if err := s.active.Close(); err != nil {
		return rotation{}, err
	}
	oldPath := s.active.Path()
	pendingPath := filepath.Join(s.walDirectory, fmt.Sprintf("pending-%d.wal", s.activeStart.UnixNano()))
	if err := os.Rename(oldPath, pendingPath); err != nil {
		return rotation{}, err
	}
	records := s.activeRecords
	if len(s.pending) >= maxPendingSegments {
		var oldestPath string
		var oldestTime time.Time
		for path, pendingRecords := range s.pending {
			if len(pendingRecords) == 0 {
				continue
			}
			candidate := pendingRecords[0].ReceivedAt
			if oldestPath == "" || candidate.Before(oldestTime) {
				oldestPath = path
				oldestTime = candidate
			}
		}
		if oldestPath != "" {
			delete(s.pending, oldestPath)
			_ = os.Remove(oldestPath)
			s.incompleteUntil = now.Add(s.options.HistoryWindow)
		}
	}
	s.pending[pendingPath] = records
	if err := s.openNewActive(now); err != nil {
		return rotation{}, err
	}
	return rotation{walPath: pendingPath, records: records}, nil
}

func (s *Store) openNewActive(now time.Time) error {
	path := filepath.Join(s.walDirectory, fmt.Sprintf("active-%d.wal", now.UnixNano()))
	writer, err := OpenWAL(path)
	if err != nil {
		return err
	}
	s.active = writer
	s.activeStart = now
	s.activeRecords = nil
	return nil
}

func (s *Store) updateCurrent(observation model.Observation) {
	previous, exists := s.current[observation.TrackID]
	if !exists || observation.ReceivedAt.After(previous.ReceivedAt) {
		s.current[observation.TrackID] = observation
	}
}

func (s *Store) restoreCurrentFromSegments() error {
	if len(s.manifests) == 0 {
		return nil
	}
	latest := s.manifests[len(s.manifests)-1]
	for tile := range latest.Blocks {
		records, err := readBlock(s.segmentDirectory, latest, tile, s.cache)
		if err != nil {
			return err
		}
		for _, record := range records {
			s.updateCurrent(record)
		}
	}
	return nil
}

func (s *Store) finalizerLoop() {
	defer s.wg.Done()
	for {
		select {
		case <-s.stop:
			return
		case item := <-s.finalize:
			manifest, err := writeSegment(s.segmentDirectory, append([]model.Observation(nil), item.records...))
			if err != nil {
				s.mu.Lock()
				s.incompleteUntil = time.Now().UTC().Add(s.options.HistoryWindow)
				s.mu.Unlock()
				continue
			}
			if err := os.Remove(item.walPath); err != nil && !errors.Is(err, os.ErrNotExist) {
				continue
			}
			s.mu.Lock()
			delete(s.pending, item.walPath)
			s.manifests = append(s.manifests, manifest)
			sort.Slice(s.manifests, func(i, j int) bool { return s.manifests[i].Start.Before(s.manifests[j].Start) })
			s.mu.Unlock()
		}
	}
}

func (s *Store) maintenanceLoop() {
	defer s.wg.Done()
	syncTicker := time.NewTicker(time.Second)
	cleanupTicker := time.NewTicker(time.Minute)
	defer syncTicker.Stop()
	defer cleanupTicker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-syncTicker.C:
			s.mu.Lock()
			if !s.closed {
				_ = s.active.Sync()
			}
			s.mu.Unlock()
		case now := <-cleanupTicker.C:
			s.cleanup(now.UTC())
		}
	}
}

func (s *Store) cleanup(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.manifests[:0]
	for _, manifest := range s.manifests {
		if manifest.End.Before(now.Add(-s.options.RetentionWindow)) {
			_ = os.Remove(filepath.Join(s.segmentDirectory, manifest.DataFile))
			_ = os.Remove(filepath.Join(s.segmentDirectory, manifest.ID+".manifest.json"))
			continue
		}
		kept = append(kept, manifest)
	}
	s.manifests = kept
	if s.options.EmergencyHistoryBytes <= 0 {
		return
	}
	var total int64
	for _, manifest := range s.manifests {
		for _, path := range []string{manifest.DataFile, manifest.ID + ".manifest.json"} {
			if info, err := os.Stat(filepath.Join(s.segmentDirectory, path)); err == nil {
				total += info.Size()
			}
		}
	}
	for total > s.options.EmergencyHistoryBytes && len(s.manifests) > 0 {
		oldest := s.manifests[0]
		for _, path := range []string{oldest.DataFile, oldest.ID + ".manifest.json"} {
			fullPath := filepath.Join(s.segmentDirectory, path)
			if info, err := os.Stat(fullPath); err == nil {
				total -= info.Size()
			}
			_ = os.Remove(fullPath)
		}
		s.manifests = s.manifests[1:]
		s.incompleteUntil = now.Add(s.options.HistoryWindow)
	}
}

func (s *Store) snapshotHistorySources() ([]SegmentManifest, map[string][]model.Observation, []model.Observation) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	manifests := append([]SegmentManifest(nil), s.manifests...)
	pending := make(map[string][]model.Observation, len(s.pending))
	for path, records := range s.pending {
		pending[path] = append([]model.Observation(nil), records...)
	}
	active := append([]model.Observation(nil), s.activeRecords...)
	return manifests, pending, active
}

func (s *Store) boundWindow(window time.Duration) time.Duration {
	if window <= 0 || window > s.options.HistoryWindow {
		return s.options.HistoryWindow
	}
	return window
}

func appendMatching(destination, records []model.Observation, from, to time.Time, trackID string, bbox *model.BoundingBox) []model.Observation {
	for _, record := range records {
		if record.ReceivedAt.Before(from) || record.ReceivedAt.After(to) {
			continue
		}
		if trackID != "" && record.TrackID != trackID {
			continue
		}
		if bbox != nil && !bbox.Contains(record.Latitude, record.Longitude) {
			continue
		}
		destination = append(destination, record)
	}
	return destination
}

func appendGrouped(grouped map[string][]model.Observation, records []model.Observation, from, to time.Time, bbox model.BoundingBox) {
	for _, record := range records {
		if record.ReceivedAt.Before(from) || record.ReceivedAt.After(to) || !bbox.Contains(record.Latitude, record.Longitude) {
			continue
		}
		grouped[record.TrackID] = append(grouped[record.TrackID], record)
	}
}

func sortDeduplicate(records []model.Observation) []model.Observation {
	sort.Slice(records, func(i, j int) bool {
		if records[i].FixTime.Equal(records[j].FixTime) {
			return records[i].ReceivedAt.Before(records[j].ReceivedAt)
		}
		return records[i].FixTime.Before(records[j].FixTime)
	})
	result := records[:0]
	var previousKey string
	for _, record := range records {
		key := strings.Join([]string{
			record.TrackID,
			record.FixTime.Format(time.RFC3339Nano),
			fmt.Sprintf("%.7f", record.Latitude),
			fmt.Sprintf("%.7f", record.Longitude),
		}, "|")
		if key == previousKey {
			continue
		}
		previousKey = key
		result = append(result, record)
	}
	return result
}

func downsample(records []model.Observation, limit int) []model.Observation {
	if limit <= 0 || len(records) <= limit {
		return records
	}
	if limit == 1 {
		return records[len(records)-1:]
	}
	selected := make(map[int]struct{}, limit)
	selected[0] = struct{}{}
	selected[len(records)-1] = struct{}{}
	for index, record := range records {
		if record.Discontinuity && len(selected) < limit {
			selected[index] = struct{}{}
			if index > 0 && len(selected) < limit {
				selected[index-1] = struct{}{}
			}
		}
	}
	for slot := 1; len(selected) < limit && slot < limit-1; slot++ {
		index := int(float64(slot) * float64(len(records)-1) / float64(limit-1))
		selected[index] = struct{}{}
	}
	indices := make([]int, 0, len(selected))
	for index := range selected {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	if len(indices) > limit {
		indices = indices[:limit]
	}
	result := make([]model.Observation, 0, len(indices))
	for _, index := range indices {
		result = append(result, records[index])
	}
	return result
}

func extendRange(start, end, candidateStart, candidateEnd time.Time) (time.Time, time.Time) {
	if start.IsZero() || candidateStart.Before(start) {
		start = candidateStart
	}
	if end.IsZero() || candidateEnd.After(end) {
		end = candidateEnd
	}
	return start, end
}
