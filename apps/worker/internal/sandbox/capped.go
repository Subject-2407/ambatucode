package sandbox

// cappedBuffer accepts at most `limit` bytes and silently discards the rest.
//
// The cap is applied as bytes arrive rather than after buffering, because a
// program printing in an infinite loop must not be able to exhaust the
// worker's memory. It never returns a short write: reporting one would make
// stdcopy tear the stream down and turn a participant's runaway output into a
// worker-side error.
type cappedBuffer struct {
	limit     int64
	written   int64
	buf       []byte
	truncated bool
}

func (c *cappedBuffer) Write(p []byte) (int, error) {
	remaining := c.limit - c.written
	if remaining <= 0 {
		c.truncated = true
		return len(p), nil
	}

	take := int64(len(p))
	if take > remaining {
		take = remaining
		c.truncated = true
	}
	c.buf = append(c.buf, p[:take]...)
	c.written += take
	return len(p), nil
}

func (c *cappedBuffer) result() (string, bool) {
	return string(c.buf), c.truncated
}
