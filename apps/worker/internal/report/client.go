// Package report delivers execution results back to the LMS.
//
// This is the worker's only write path. It holds no database credentials, so a
// result that never reaches this endpoint is a graded submission lost — which
// is the worst outcome the pipeline has. Prefer reporting twice over not at
// all: the backend's ingest is idempotent.
package report

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
)

const (
	tokenHeader = "x-execution-callback-token"
	maxAttempts = 5
	baseBackoff = 250 * time.Millisecond
)

// ErrRejected marks a 4xx from the callback. It is a contract bug on one side
// or the other and must not be retried — retrying would just hammer the LMS
// with a payload it has already refused.
var ErrRejected = errors.New("callback rejected the result")

type Client struct {
	http   *http.Client
	url    string
	logger *slog.Logger
}

func New(url string, logger *slog.Logger) *Client {
	return &Client{
		http:   &http.Client{Timeout: 30 * time.Second},
		url:    url,
		logger: logger,
	}
}

// Send posts one result, retrying transient failures with exponential backoff.
func (c *Client) Send(ctx context.Context, result contract.Result, callbackToken string) error {
	body, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("encode result for job %s: %w", result.JobID, err)
	}

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		err := c.post(ctx, body, callbackToken)
		if err == nil {
			return nil
		}
		if errors.Is(err, ErrRejected) {
			// Loud on purpose: a 4xx means the shapes disagree, and that is a
			// defect to fix rather than a condition to wait out.
			c.logger.Error("result callback rejected the payload",
				slog.String("jobId", result.JobID),
				slog.String("error", err.Error()))
			return err
		}
		lastErr = err

		if attempt == maxAttempts {
			break
		}
		delay := baseBackoff * time.Duration(1<<(attempt-1))
		select {
		case <-ctx.Done():
			return fmt.Errorf("report job %s: %w", result.JobID, ctx.Err())
		case <-time.After(delay):
		}
	}

	return fmt.Errorf("report job %s after %d attempts: %w", result.JobID, maxAttempts, lastErr)
}

func (c *Client) post(ctx context.Context, body []byte, callbackToken string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build callback request: %w", err)
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set(tokenHeader, callbackToken)

	response, err := c.http.Do(request)
	if err != nil {
		return fmt.Errorf("post result: %w", err)
	}
	defer response.Body.Close()

	// Drain before closing so the connection can be reused rather than reset
	// under a burst of results.
	snippet, _ := io.ReadAll(io.LimitReader(response.Body, 2048))

	switch {
	case response.StatusCode >= 200 && response.StatusCode < 300:
		return nil
	case response.StatusCode >= 400 && response.StatusCode < 500:
		return fmt.Errorf("%w: status %d: %s", ErrRejected, response.StatusCode, snippet)
	default:
		return fmt.Errorf("callback returned status %d: %s", response.StatusCode, snippet)
	}
}
