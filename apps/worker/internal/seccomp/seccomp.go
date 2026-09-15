// Package seccomp builds the syscall filter every sandbox container runs under.
//
// The starting point is Docker's own default profile, embedded verbatim from
// github.com/moby/profiles/seccomp v0.2.3 (docker-default.json). It is already
// restrictive, and it is maintained by people who track which syscalls real
// runtimes need — so rather than a hand-written allowlist that a JVM or g++
// update can silently break, this package only ever takes things away from it.
//
// What it takes away is what the default still allows and no graded program
// has a reason to call. Each removed syscall answers ENOSYS rather than EPERM:
// runtimes probe optional kernel features and fall back cleanly on "not
// implemented", where "not permitted" is sometimes treated as fatal.
//
// There is no way to build a profile that allows more than the default, and no
// way to ask for no profile at all.
package seccomp

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"sync"
)

//go:embed docker-default.json
var dockerDefault []byte

// enosys is Linux's "function not implemented".
const enosys = 38

// BaseDenied is removed for every language.
var BaseDenied = []string{
	// Reading or writing another process's memory. Nothing a Coder submits
	// debugs a sibling process, and pid namespaces are the only other thing
	// standing between these calls and every process in the container.
	"ptrace",
	"process_vm_readv",
	"process_vm_writev",
	// A long history of kernel memory-corruption bugs, and no use in a
	// program that reads stdin and writes stdout.
	"vmsplice",
	// File handles bypass path-based checks; opening by handle is already
	// capability-gated, and producing one serves nothing here.
	"name_to_handle_at",
	// Memory hidden from the kernel's own direct map is a feature for hiding
	// secrets from an attacker, and useful to one for exactly that reason.
	"memfd_secret",
}

var cache sync.Map

// Build returns the profile JSON for a language, which may deny extra syscalls
// on top of BaseDenied.
func Build(extraDenied []string) (string, error) {
	denied := normalize(append(slices.Clone(BaseDenied), extraDenied...))
	key := strings.Join(denied, ",")
	if cached, ok := cache.Load(key); ok {
		return cached.(string), nil
	}

	profile, err := build(denied)
	if err != nil {
		return "", err
	}
	cache.Store(key, profile)
	return profile, nil
}

func build(denied []string) (string, error) {
	var profile map[string]any
	if err := json.Unmarshal(dockerDefault, &profile); err != nil {
		return "", fmt.Errorf("parse embedded seccomp profile: %w", err)
	}
	if profile["defaultAction"] != "SCMP_ACT_ERRNO" {
		return "", fmt.Errorf("embedded seccomp profile must deny by default, got %v", profile["defaultAction"])
	}

	rules, ok := profile["syscalls"].([]any)
	if !ok {
		return "", fmt.Errorf("embedded seccomp profile has no syscall rules")
	}

	kept := make([]any, 0, len(rules)+1)
	for _, raw := range rules {
		rule, ok := raw.(map[string]any)
		if !ok {
			return "", fmt.Errorf("embedded seccomp profile has a malformed rule")
		}
		names, _ := rule["names"].([]any)
		remaining := make([]any, 0, len(names))
		for _, name := range names {
			if text, ok := name.(string); ok && slices.Contains(denied, text) {
				continue
			}
			remaining = append(remaining, name)
		}
		// Every syscall a rule named was denied; an empty rule would match
		// nothing and only confuse whoever reads the generated profile.
		if len(remaining) == 0 {
			continue
		}
		rule["names"] = remaining
		kept = append(kept, rule)
	}

	// Stated explicitly rather than left to the default action, so the answer
	// is ENOSYS and not the default's EPERM.
	names := make([]any, len(denied))
	for i, name := range denied {
		names[i] = name
	}
	kept = append(kept, map[string]any{
		"names":    names,
		"action":   "SCMP_ACT_ERRNO",
		"errnoRet": enosys,
	})
	profile["syscalls"] = kept

	encoded, err := json.Marshal(profile)
	if err != nil {
		return "", fmt.Errorf("encode seccomp profile: %w", err)
	}
	return string(encoded), nil
}

func normalize(names []string) []string {
	seen := make(map[string]struct{}, len(names))
	out := make([]string, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if _, dup := seen[name]; dup {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}
