package store

import (
	"bytes"
	"compress/gzip"
	"container/list"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
)

const (
	segmentVersion       = 1
	maxDecompressedBlock = 64 << 20
)

type BlockRef struct {
	Offset int64  `json:"offset"`
	Length int64  `json:"length"`
	CRC32  uint32 `json:"crc32"`
}

type SegmentManifest struct {
	Version  int                 `json:"version"`
	ID       string              `json:"id"`
	Start    time.Time           `json:"start"`
	End      time.Time           `json:"end"`
	DataFile string              `json:"dataFile"`
	Blocks   map[string]BlockRef `json:"blocks"`
	Tracks   map[string][]string `json:"tracks"`
	Count    int                 `json:"count"`
}

func writeSegment(directory string, records []model.Observation) (SegmentManifest, error) {
	if len(records) == 0 {
		return SegmentManifest{}, errors.New("cannot write an empty segment")
	}
	sort.Slice(records, func(i, j int) bool { return records[i].ReceivedAt.Before(records[j].ReceivedAt) })
	start := records[0].ReceivedAt.UTC()
	end := records[len(records)-1].ReceivedAt.UTC()
	id := fmt.Sprintf("segment-%d-%d", start.UnixNano(), end.UnixNano())
	dataName := id + ".seg"
	dataPath := filepath.Join(directory, dataName)
	temporaryData := dataPath + ".tmp"

	groups := make(map[string][]model.Observation)
	tracks := make(map[string]map[string]struct{})
	for _, record := range records {
		tile := model.TileKey(record.Latitude, record.Longitude)
		groups[tile] = append(groups[tile], record)
		if tracks[record.TrackID] == nil {
			tracks[record.TrackID] = make(map[string]struct{})
		}
		tracks[record.TrackID][tile] = struct{}{}
	}
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	file, err := os.OpenFile(temporaryData, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return SegmentManifest{}, err
	}
	cleanup := true
	defer func() {
		_ = file.Close()
		if cleanup {
			_ = os.Remove(temporaryData)
		}
	}()
	manifest := SegmentManifest{
		Version:  segmentVersion,
		ID:       id,
		Start:    start,
		End:      end,
		DataFile: dataName,
		Blocks:   make(map[string]BlockRef, len(groups)),
		Tracks:   make(map[string][]string, len(tracks)),
		Count:    len(records),
	}
	var offset int64
	for _, key := range keys {
		payload, err := json.Marshal(groups[key])
		if err != nil {
			return SegmentManifest{}, err
		}
		var compressed bytes.Buffer
		writer, err := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
		if err != nil {
			return SegmentManifest{}, err
		}
		if _, err := writer.Write(payload); err != nil {
			return SegmentManifest{}, err
		}
		if err := writer.Close(); err != nil {
			return SegmentManifest{}, err
		}
		block := compressed.Bytes()
		if _, err := file.Write(block); err != nil {
			return SegmentManifest{}, err
		}
		manifest.Blocks[key] = BlockRef{Offset: offset, Length: int64(len(block)), CRC32: crc32.ChecksumIEEE(block)}
		offset += int64(len(block))
	}
	for trackID, tileSet := range tracks {
		tileKeys := make([]string, 0, len(tileSet))
		for key := range tileSet {
			tileKeys = append(tileKeys, key)
		}
		sort.Strings(tileKeys)
		manifest.Tracks[trackID] = tileKeys
	}
	if err := file.Sync(); err != nil {
		return SegmentManifest{}, err
	}
	if err := file.Close(); err != nil {
		return SegmentManifest{}, err
	}
	if err := os.Rename(temporaryData, dataPath); err != nil {
		return SegmentManifest{}, err
	}
	cleanup = false
	if err := writeManifestAtomic(directory, manifest); err != nil {
		_ = os.Remove(dataPath)
		return SegmentManifest{}, err
	}
	if err := syncDirectory(directory); err != nil {
		return SegmentManifest{}, err
	}
	return manifest, nil
}

func writeManifestAtomic(directory string, manifest SegmentManifest) error {
	payload, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	path := filepath.Join(directory, manifest.ID+".manifest.json")
	temporary := path + ".tmp"
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	cleanup := true
	defer func() {
		_ = file.Close()
		if cleanup {
			_ = os.Remove(temporary)
		}
	}()
	if _, err := file.Write(payload); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func loadManifests(directory string) ([]SegmentManifest, error) {
	paths, err := filepath.Glob(filepath.Join(directory, "*.manifest.json"))
	if err != nil {
		return nil, err
	}
	manifests := make([]SegmentManifest, 0, len(paths))
	for _, path := range paths {
		payload, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var manifest SegmentManifest
		if err := json.Unmarshal(payload, &manifest); err != nil {
			return nil, fmt.Errorf("decode %s: %w", filepath.Base(path), err)
		}
		if manifest.Version != segmentVersion || manifest.ID == "" || manifest.DataFile == "" {
			return nil, fmt.Errorf("unsupported segment manifest %s", filepath.Base(path))
		}
		if _, err := os.Stat(filepath.Join(directory, manifest.DataFile)); err != nil {
			return nil, fmt.Errorf("segment data missing for %s: %w", manifest.ID, err)
		}
		manifests = append(manifests, manifest)
	}
	sort.Slice(manifests, func(i, j int) bool { return manifests[i].Start.Before(manifests[j].Start) })
	return manifests, nil
}

type cacheEntry struct {
	key     string
	records []model.Observation
}

type blockCache struct {
	mu      sync.Mutex
	max     int
	entries map[string]*list.Element
	order   *list.List
}

func newBlockCache(max int) *blockCache {
	return &blockCache{max: max, entries: make(map[string]*list.Element), order: list.New()}
}

func (c *blockCache) get(key string) ([]model.Observation, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	element := c.entries[key]
	if element == nil {
		return nil, false
	}
	c.order.MoveToFront(element)
	return element.Value.(cacheEntry).records, true
}

func (c *blockCache) put(key string, records []model.Observation) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if element := c.entries[key]; element != nil {
		element.Value = cacheEntry{key: key, records: records}
		c.order.MoveToFront(element)
		return
	}
	element := c.order.PushFront(cacheEntry{key: key, records: records})
	c.entries[key] = element
	for c.order.Len() > c.max {
		oldest := c.order.Back()
		delete(c.entries, oldest.Value.(cacheEntry).key)
		c.order.Remove(oldest)
	}
}

func readBlock(directory string, manifest SegmentManifest, tile string, cache *blockCache) ([]model.Observation, error) {
	cacheKey := manifest.ID + ":" + tile
	if records, ok := cache.get(cacheKey); ok {
		return records, nil
	}
	reference, ok := manifest.Blocks[tile]
	if !ok {
		return nil, nil
	}
	if reference.Length <= 0 || reference.Length > maxDecompressedBlock {
		return nil, errors.New("invalid compressed block length")
	}
	file, err := os.Open(filepath.Join(directory, manifest.DataFile))
	if err != nil {
		return nil, err
	}
	defer file.Close()
	compressed := make([]byte, reference.Length)
	if _, err := file.ReadAt(compressed, reference.Offset); err != nil {
		return nil, err
	}
	if crc32.ChecksumIEEE(compressed) != reference.CRC32 {
		return nil, errors.New("segment block checksum mismatch")
	}
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, err
	}
	payload, err := io.ReadAll(io.LimitReader(reader, maxDecompressedBlock+1))
	closeErr := reader.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if len(payload) > maxDecompressedBlock {
		return nil, errors.New("decompressed segment block exceeded limit")
	}
	var records []model.Observation
	if err := json.Unmarshal(payload, &records); err != nil {
		return nil, err
	}
	cache.put(cacheKey, records)
	return records, nil
}

func manifestTilesForBBox(manifest SegmentManifest, bbox model.BoundingBox) []string {
	keys := make([]string, 0)
	for key := range manifest.Blocks {
		parts := strings.Split(key, "_")
		if len(parts) != 2 {
			continue
		}
		latCell, latErr := strconv.Atoi(parts[0])
		lonCell, lonErr := strconv.Atoi(parts[1])
		if latErr != nil || lonErr != nil {
			continue
		}
		centerLat := float64(latCell) + 0.5
		centerLon := float64(lonCell) + 0.5
		expanded := model.BoundingBox{
			West:  wrapLongitudeForTile(bbox.West - 1),
			South: bbox.South - 1,
			East:  wrapLongitudeForTile(bbox.East + 1),
			North: bbox.North + 1,
		}
		if expanded.Contains(centerLat, centerLon) {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys
}

func wrapLongitudeForTile(value float64) float64 {
	for value < -180 {
		value += 360
	}
	for value > 180 {
		value -= 360
	}
	return value
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
