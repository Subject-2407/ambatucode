package queue

import (
	"strings"
	"testing"
)

// The -N suffix carries BullMQ's own declared KEYS count. Reading it wrong
// shifts every KEY by one, which Redis will happily execute.
func TestKeyCountFromName(t *testing.T) {
	cases := map[string]int{
		"moveToActive-11.lua":           11,
		"moveToFinished-14.lua":         14,
		"moveJobFromActiveToWait-9.lua": 9,
	}
	for filename, want := range cases {
		got, err := keyCountFromName(filename)
		if err != nil {
			t.Fatalf("%s: %v", filename, err)
		}
		if got != want {
			t.Fatalf("%s: got %d keys, want %d", filename, got, want)
		}
	}

	if _, err := keyCountFromName("noSuffix.lua"); err == nil {
		t.Fatal("expected an error for a filename with no key count")
	}
}

func TestLoadScriptReadsEveryVendoredScript(t *testing.T) {
	for _, filename := range []string{
		"moveToActive-11.lua",
		"moveToFinished-14.lua",
		"moveJobFromActiveToWait-9.lua",
	} {
		loaded, err := loadScript(filename)
		if err != nil {
			t.Fatalf("%s: %v", filename, err)
		}
		if loaded.numKeys == 0 || loaded.source == "" {
			t.Fatalf("%s loaded empty: %+v", filename, loaded)
		}
		// An unresolved directive means the fragments were never spliced in,
		// and the Lua would fail at runtime inside Redis.
		if strings.Contains(loaded.source, "@include") {
			t.Fatalf("%s still contains an unresolved @include", filename)
		}
	}
}

// The fragments close over `local rcall = redis.call` from the parent body.
// Hoisting them above that line yields "attempted to access nonexistent global
// variable 'rcall'" — a failure that only appears once Redis runs the script,
// so it is asserted here instead.
func TestVendoredScriptsDefineRcallBeforeTheFragmentsThatUseIt(t *testing.T) {
	loaded, err := loadScript("moveToActive-11.lua")
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	rcall := strings.Index(loaded.source, "local rcall = redis.call")
	definition := strings.Index(loaded.source, "local function prepareJobForProcessing")
	usage := strings.Index(loaded.source, "return prepareJobForProcessing(")

	if rcall == -1 || definition == -1 || usage == -1 {
		t.Fatalf("expected rcall (%d), the definition (%d) and the call site (%d) to all be present",
			rcall, definition, usage)
	}
	if rcall > definition {
		t.Fatal("rcall is assigned after the fragment that closes over it")
	}
	if definition > usage {
		t.Fatal("prepareJobForProcessing is called before it is defined")
	}
}

// A fragment pulled in by two others must appear once; a second `local
// function` of the same name would shadow rather than fail, hiding the bug.
func TestVendoredScriptsDefineEachFragmentOnce(t *testing.T) {
	loaded, err := loadScript("moveToFinished-14.lua")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if count := strings.Count(loaded.source, "local function removeJobKeys"); count != 1 {
		t.Fatalf("removeJobKeys defined %d times, want 1", count)
	}
}
