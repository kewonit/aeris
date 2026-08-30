package ingest

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestReadsbClientAcceptsAircraftAndACEnvelopes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"now":1700000000,"aircraft":[{"hex":"abc123","lat":12.5,"lon":77.6,"alt_baro":"ground"}]}`))
	}))
	defer server.Close()
	client := NewReadsbClient(server.URL, 4096, server.Client())
	envelope, _, err := client.Fetch(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(envelope.Entries()) != 1 || !envelope.Entries()[0].AltBaro.Ground {
		t.Fatal("readsb aircraft envelope was not decoded")
	}
}

func TestReadsbClientBoundsResponseSize(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(make([]byte, 1024))
	}))
	defer server.Close()
	client := NewReadsbClient(server.URL, 128, server.Client())
	if _, _, err := client.Fetch(context.Background()); err == nil {
		t.Fatal("expected oversized source response to fail")
	}
}

func TestReadsbClientSkipsMalformedAircraftWithoutDroppingSnapshot(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"now":1700000000,"aircraft":[{"hex":"bad001","lat":12.5,"lon":77.6,"gs":"not-a-number"},{"hex":"abc123","lat":12.5,"lon":77.6,"gs":450}]}`))
	}))
	defer server.Close()
	client := NewReadsbClient(server.URL, 4096, server.Client())
	envelope, _, err := client.Fetch(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	entries := envelope.Entries()
	if len(entries) != 1 || entries[0].Hex != "abc123" {
		t.Fatalf("expected only the valid aircraft, got %#v", entries)
	}
}

func TestEnvelopeResponseTimeSupportsSecondsAndMilliseconds(t *testing.T) {
	received := time.Unix(1_700_000_000, 0).UTC()
	if got := (ReadsbEnvelope{Now: 1_700_000_000}).ResponseTime(received); !got.Equal(received) {
		t.Fatalf("unexpected seconds response time %s", got)
	}
	if got := (ReadsbEnvelope{Now: 1_700_000_000_500}).ResponseTime(received); !got.Equal(received.Add(500 * time.Millisecond)) {
		t.Fatalf("unexpected millisecond response time %s", got)
	}
}
