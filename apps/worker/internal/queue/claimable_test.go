package queue

import (
	"testing"
	"time"
)

func TestClaimableSinceAddsTheDelayToTheEnqueueTime(t *testing.T) {
	got := claimableSince("1757900000000", "2000")
	if want := time.UnixMilli(1757900002000); !got.Equal(want) {
		t.Fatalf("claimableSince = %v, want %v", got, want)
	}
}

func TestClaimableSinceToleratesAMissingDelay(t *testing.T) {
	got := claimableSince("1757900000000", "")
	if want := time.UnixMilli(1757900000000); !got.Equal(want) {
		t.Fatalf("claimableSince = %v, want %v", got, want)
	}
}

// The value only feeds a metric; a hash that does not carry it must not turn
// into an error on the claim path.
func TestClaimableSinceIsZeroWithoutATimestamp(t *testing.T) {
	for _, timestamp := range []string{"", "not-a-number", "0", "-5"} {
		if got := claimableSince(timestamp, "0"); !got.IsZero() {
			t.Errorf("claimableSince(%q) = %v, want zero", timestamp, got)
		}
	}
}
