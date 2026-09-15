package seccomp

import (
	"encoding/json"
	"slices"
	"testing"
)

type rule struct {
	Names    []string `json:"names"`
	Action   string   `json:"action"`
	ErrnoRet int      `json:"errnoRet"`
	Includes struct {
		Caps []string `json:"caps"`
	} `json:"includes"`
}

type profile struct {
	DefaultAction string `json:"defaultAction"`
	Syscalls      []rule `json:"syscalls"`
}

func decode(t *testing.T, raw string) profile {
	t.Helper()
	var p profile
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatalf("decode profile: %v", err)
	}
	return p
}

// allowedWithoutCapabilities reports whether some rule allows the syscall for
// a container holding no capabilities, which is every sandbox container.
func allowedWithoutCapabilities(p profile, name string) bool {
	for _, r := range p.Syscalls {
		if r.Action != "SCMP_ACT_ALLOW" || len(r.Includes.Caps) > 0 {
			continue
		}
		if slices.Contains(r.Names, name) {
			return true
		}
	}
	return false
}

func TestBaseProfileDeniesEverySyscallItRemoves(t *testing.T) {
	raw, err := Build(nil)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	p := decode(t, raw)

	if p.DefaultAction != "SCMP_ACT_ERRNO" {
		t.Fatalf("default action = %q, want deny by default", p.DefaultAction)
	}
	for _, name := range BaseDenied {
		if allowedWithoutCapabilities(p, name) {
			t.Errorf("%s is still allowed", name)
		}
	}

	last := p.Syscalls[len(p.Syscalls)-1]
	if last.Action != "SCMP_ACT_ERRNO" || last.ErrnoRet != enosys {
		t.Fatalf("denial rule = %+v, want SCMP_ACT_ERRNO with ENOSYS", last)
	}
	for _, name := range BaseDenied {
		if !slices.Contains(last.Names, name) {
			t.Errorf("%s is missing from the explicit denial rule", name)
		}
	}
}

// These are the syscalls a container escape is built from. Docker's default
// already denies them to a capability-less container; the test exists so an
// upgrade of the embedded profile that quietly allowed one fails here.
func TestEscapePrimitivesStayDeniedWithoutCapabilities(t *testing.T) {
	raw, err := Build(nil)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	p := decode(t, raw)

	for _, name := range []string{
		"bpf", "io_uring_enter", "io_uring_register", "io_uring_setup", "keyctl",
		"add_key", "request_key", "mount", "umount2", "perf_event_open", "setns",
		"unshare", "userfaultfd", "kexec_load", "init_module", "finit_module",
		"open_by_handle_at", "pidfd_getfd", "kcmp", "chroot", "pivot_root",
	} {
		if allowedWithoutCapabilities(p, name) {
			t.Errorf("%s is allowed for a container without capabilities", name)
		}
	}
}

func TestExtraDenialsNarrowAndNeverWiden(t *testing.T) {
	base, err := Build(nil)
	if err != nil {
		t.Fatalf("build base: %v", err)
	}
	narrowed, err := Build([]string{"memfd_create", "ptrace", " ", "memfd_create"})
	if err != nil {
		t.Fatalf("build narrowed: %v", err)
	}

	b, n := decode(t, base), decode(t, narrowed)
	if !allowedWithoutCapabilities(b, "memfd_create") {
		t.Fatal("the base profile should still allow memfd_create")
	}
	if allowedWithoutCapabilities(n, "memfd_create") {
		t.Fatal("an extra denial did not remove memfd_create")
	}
	for _, r := range b.Syscalls {
		if r.Action != "SCMP_ACT_ALLOW" || len(r.Includes.Caps) > 0 {
			continue
		}
		for _, name := range r.Names {
			if name != "memfd_create" && !allowedWithoutCapabilities(n, name) {
				t.Errorf("narrowing removed %s, which was not asked for", name)
			}
		}
	}
}

func TestBuildIsStableForEquivalentInputs(t *testing.T) {
	first, err := Build([]string{"pkey_alloc", "memfd_create"})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	second, err := Build([]string{"memfd_create", "pkey_alloc", "memfd_create"})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if first != second {
		t.Fatal("the same denials in a different order built a different profile")
	}
}
