package queue

import "fmt"

// keys mirrors BullMQ's QueueKeys. The layout is `<prefix>:<queue>:<type>`,
// and the empty type yields the trailing-colon prefix the Lua scripts expect
// as their first ARGV.
//
// These names are not ours to choose — they are the layout `apps/web` writes
// and that BullMQ tooling reads. Renaming one here silently detaches the
// worker from the producer.
type keys struct {
	base string // "bull:execution-run:"
}

func newKeys(prefix, queueName string) keys {
	return keys{base: fmt.Sprintf("%s:%s:", prefix, queueName)}
}

func (k keys) of(kind string) string { return k.base + kind }

// job returns the per-job hash key. Job ids come from the producer and are
// used verbatim; they are never interpolated anywhere but here.
func (k keys) job(jobID string) string { return k.base + jobID }

func (k keys) prefix() string          { return k.base }
func (k keys) wait() string            { return k.of("wait") }
func (k keys) active() string          { return k.of("active") }
func (k keys) prioritized() string     { return k.of("prioritized") }
func (k keys) events() string          { return k.of("events") }
func (k keys) stalled() string         { return k.of("stalled") }
func (k keys) limiter() string         { return k.of("limiter") }
func (k keys) delayed() string         { return k.of("delayed") }
func (k keys) paused() string          { return k.of("paused") }
func (k keys) meta() string            { return k.of("meta") }
func (k keys) priorityCounter() string { return k.of("pc") }
func (k keys) marker() string          { return k.of("marker") }
func (k keys) completed() string       { return k.of("completed") }
func (k keys) failed() string          { return k.of("failed") }

// metrics is split per outcome, matching `toKey('metrics:' + target)`.
func (k keys) metrics(target string) string { return k.of("metrics:" + target) }
