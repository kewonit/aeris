package store

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"

	"github.com/kewonit/aeris/services/adsb-relay/internal/model"
)

const (
	walHeaderSize     = 8
	maxWALRecordBytes = 256 << 10
)

var ErrWALCorrupt = errors.New("WAL record is corrupt")

type WALWriter struct {
	path string
	file *os.File
	buf  *bufio.Writer
}

func OpenWAL(path string) (*WALWriter, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, err
	}
	return &WALWriter{path: path, file: file, buf: bufio.NewWriterSize(file, 64<<10)}, nil
}

func (w *WALWriter) Path() string { return w.path }

func (w *WALWriter) Append(observation model.Observation) error {
	payload, err := json.Marshal(observation)
	if err != nil {
		return err
	}
	if len(payload) == 0 || len(payload) > maxWALRecordBytes {
		return errors.New("normalized observation exceeds WAL record limit")
	}
	var header [walHeaderSize]byte
	binary.BigEndian.PutUint32(header[:4], uint32(len(payload)))
	binary.BigEndian.PutUint32(header[4:], crc32.ChecksumIEEE(payload))
	if _, err := w.buf.Write(header[:]); err != nil {
		return err
	}
	_, err = w.buf.Write(payload)
	return err
}

func (w *WALWriter) Sync() error {
	if err := w.buf.Flush(); err != nil {
		return err
	}
	return w.file.Sync()
}

func (w *WALWriter) Close() error {
	flushErr := w.buf.Flush()
	syncErr := w.file.Sync()
	closeErr := w.file.Close()
	return errors.Join(flushErr, syncErr, closeErr)
}

func ReadWAL(path string) (records []model.Observation, truncated bool, err error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, false, err
	}
	defer file.Close()
	reader := bufio.NewReaderSize(file, 64<<10)
	for {
		var header [walHeaderSize]byte
		_, readErr := io.ReadFull(reader, header[:])
		if errors.Is(readErr, io.EOF) {
			return records, false, nil
		}
		if errors.Is(readErr, io.ErrUnexpectedEOF) {
			return records, true, nil
		}
		if readErr != nil {
			return nil, false, readErr
		}
		length := binary.BigEndian.Uint32(header[:4])
		checksum := binary.BigEndian.Uint32(header[4:])
		if length == 0 || length > maxWALRecordBytes {
			return nil, false, fmt.Errorf("%w: invalid record length", ErrWALCorrupt)
		}
		payload := make([]byte, length)
		if _, readErr := io.ReadFull(reader, payload); errors.Is(readErr, io.EOF) || errors.Is(readErr, io.ErrUnexpectedEOF) {
			return records, true, nil
		} else if readErr != nil {
			return nil, false, readErr
		}
		if crc32.ChecksumIEEE(payload) != checksum {
			return nil, false, fmt.Errorf("%w: checksum mismatch", ErrWALCorrupt)
		}
		var observation model.Observation
		if err := json.Unmarshal(payload, &observation); err != nil {
			return nil, false, fmt.Errorf("%w: invalid JSON", ErrWALCorrupt)
		}
		if err := observation.Validate(); err != nil {
			return nil, false, fmt.Errorf("%w: %v", ErrWALCorrupt, err)
		}
		records = append(records, observation)
	}
}
