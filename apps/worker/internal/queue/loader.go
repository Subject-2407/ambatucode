package queue

import (
	"embed"
	"fmt"
	"strconv"
	"strings"
)

//go:embed lua/*.lua
var luaFS embed.FS

// script is one loadable BullMQ command: its source and the number of KEYS it
// expects, which the vendoring step encodes in the filename.
type script struct {
	name    string
	source  string
	numKeys int
}

// loadScript reads one vendored script.
//
// The Lua arrives already flattened by BullMQ's own build, so there are no
// `@include` directives to resolve here. That is deliberate: the fragments
// have to be spliced in at the exact points the directives sat — after the
// `local rcall = redis.call` they close over — and reproducing that ordering
// by hand produces Lua that only fails once Redis runs it.
func loadScript(filename string) (script, error) {
	numKeys, err := keyCountFromName(filename)
	if err != nil {
		return script{}, err
	}

	raw, err := luaFS.ReadFile("lua/" + filename)
	if err != nil {
		return script{}, fmt.Errorf("read lua %s: %w", filename, err)
	}
	source := string(raw)

	if strings.Contains(source, "@include") {
		return script{}, fmt.Errorf(
			"%s contains an unresolved @include; re-run scripts/revendor-bullmq-lua.mjs", filename,
		)
	}

	return script{name: filename, source: source, numKeys: numKeys}, nil
}

// keyCountFromName reads the `-N` suffix the vendoring step writes from
// BullMQ's own declared key count. Guessing this wrong silently shifts every
// KEY by one, which Redis will happily execute.
func keyCountFromName(filename string) (int, error) {
	base := strings.TrimSuffix(filename, ".lua")
	dash := strings.LastIndex(base, "-")
	if dash == -1 {
		return 0, fmt.Errorf("script %q has no -N key count suffix", filename)
	}
	numKeys, err := strconv.Atoi(base[dash+1:])
	if err != nil {
		return 0, fmt.Errorf("script %q has a non-numeric key count suffix: %w", filename, err)
	}
	return numKeys, nil
}
