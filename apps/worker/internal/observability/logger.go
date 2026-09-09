// Package observability builds the worker's structured logger.
package observability

import (
	"log/slog"
	"os"
)

// Never log source code, test inputs, expected outputs, or the callback token.
// The first is untrusted participant work, the next two are grading data that
// must never leave the worker, and the last is a credential. There is no
// redacting handler to lean on — the rule is enforced by not passing them to a
// log call in the first place.

// NewLogger returns a JSON logger on stdout at the requested level.
func NewLogger(level string) *slog.Logger {
	var parsed slog.Level
	switch level {
	case "debug":
		parsed = slog.LevelDebug
	case "warn":
		parsed = slog.LevelWarn
	case "error":
		parsed = slog.LevelError
	default:
		parsed = slog.LevelInfo
	}

	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: parsed})
	return slog.New(handler)
}
