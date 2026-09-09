package sandbox

import (
	"strings"
	"testing"
)

func TestCappedBufferStopsAtTheLimit(t *testing.T) {
	buf := &cappedBuffer{limit: 5}

	if _, err := buf.Write([]byte("abc")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if value, truncated := buf.result(); value != "abc" || truncated {
		t.Fatalf("got (%q, %v), want (\"abc\", false)", value, truncated)
	}

	if _, err := buf.Write([]byte("defgh")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	value, truncated := buf.result()
	if value != "abcde" {
		t.Fatalf("got %q, want %q", value, "abcde")
	}
	if !truncated {
		t.Fatal("expected the buffer to report truncation")
	}
}

// A short write would make stdcopy tear the stream down, turning a
// participant's runaway output into a worker-side failure. The buffer has to
// claim it consumed everything.
func TestCappedBufferNeverReportsAShortWrite(t *testing.T) {
	buf := &cappedBuffer{limit: 2}
	payload := []byte("abcdefghij")

	written, err := buf.Write(payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if written != len(payload) {
		t.Fatalf("reported %d bytes written, want %d", written, len(payload))
	}

	// Writes past the limit stay accepted rather than erroring.
	if written, err = buf.Write(payload); err != nil || written != len(payload) {
		t.Fatalf("second write reported (%d, %v)", written, err)
	}
}

// An infinite printer must not be able to exhaust worker memory: the cap is
// applied as bytes arrive, not after buffering everything.
func TestCappedBufferBoundsMemoryUnderFloodOfOutput(t *testing.T) {
	buf := &cappedBuffer{limit: 1024}
	chunk := []byte(strings.Repeat("x", 4096))

	for i := 0; i < 1000; i++ {
		if _, err := buf.Write(chunk); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	}

	value, truncated := buf.result()
	if len(value) != 1024 {
		t.Fatalf("retained %d bytes, want 1024", len(value))
	}
	if !truncated {
		t.Fatal("expected truncation to be reported")
	}
}

func TestCappedBufferWithZeroLimitRetainsNothing(t *testing.T) {
	buf := &cappedBuffer{limit: 0}
	if _, err := buf.Write([]byte("anything")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if value, truncated := buf.result(); value != "" || !truncated {
		t.Fatalf("got (%q, %v), want (\"\", true)", value, truncated)
	}
}
