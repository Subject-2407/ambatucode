package grader

import (
	"testing"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
)

func TestCompare(t *testing.T) {
	cases := []struct {
		name     string
		mode     contract.ComparisonMode
		expected string
		actual   string
		want     bool
	}{
		{"exact matches", contract.ComparisonExact, "42\n", "42\n", true},
		{"exact rejects a trailing newline", contract.ComparisonExact, "42", "42\n", false},

		{"trimmed ignores a trailing newline", contract.ComparisonTrimmed, "42", "42\n", true},
		{"trimmed ignores trailing spaces per line", contract.ComparisonTrimmed, "a\nb", "a   \nb  \n\n", true},
		{"trimmed keeps leading space significant", contract.ComparisonTrimmed, "a", "  a", false},

		{"token ignores whitespace shape", contract.ComparisonToken, "1 2  3", "1\n2\t3\n", true},
		{"token respects order", contract.ComparisonToken, "1 2 3", "1 3 2", false},
		{"token respects count", contract.ComparisonToken, "1 2", "1 2 3", false},

		{"numeric tolerant accepts float drift", contract.ComparisonNumericTolerant, "0.1000000", "0.10000001", true},
		{"numeric tolerant rejects real difference", contract.ComparisonNumericTolerant, "1.0", "1.1", false},
		{"numeric tolerant compares words exactly", contract.ComparisonNumericTolerant, "yes 1.0", "no 1.0", false},
		{"numeric tolerant scales with magnitude", contract.ComparisonNumericTolerant, "1000000.0", "1000000.0000005", true},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := Compare(testCase.mode, testCase.expected, testCase.actual)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != testCase.want {
				t.Fatalf("Compare(%s, %q, %q) = %v, want %v",
					testCase.mode, testCase.expected, testCase.actual, got, testCase.want)
			}
		})
	}
}

// A Coder on Windows whose program emits \r\n must not fail on line endings.
func TestCompareNormalizesWindowsLineEndingsInEveryMode(t *testing.T) {
	modes := []contract.ComparisonMode{
		contract.ComparisonExact,
		contract.ComparisonTrimmed,
		contract.ComparisonToken,
		contract.ComparisonNumericTolerant,
	}
	for _, mode := range modes {
		got, err := Compare(mode, "a\nb\n", "a\r\nb\r\n")
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", mode, err)
		}
		if !got {
			t.Fatalf("%s: CRLF output should match LF expectation", mode)
		}
	}
}

func TestCompareRejectsUnknownMode(t *testing.T) {
	if _, err := Compare(contract.ComparisonMode("FUZZY"), "a", "a"); err == nil {
		t.Fatal("expected an error for an unimplemented mode rather than a silent fail")
	}
}
