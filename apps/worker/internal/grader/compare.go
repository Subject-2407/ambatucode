// Package grader decides whether a program's output matches what was expected.
//
// It reports pass or fail per test case and nothing more. Turning those into a
// 0–100 score is the backend's job — scoring policy lives with the assessment
// configuration, not with the thing that ran the code.
package grader

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
)

// relativeEpsilon is the tolerance for NUMERIC_TOLERANT comparisons.
const relativeEpsilon = 1e-6

// Compare reports whether actual satisfies expected under the given mode.
//
// Every mode normalizes CRLF to LF first. A Coder on Windows whose program
// emits \r\n must not fail a test case for a line ending.
func Compare(mode contract.ComparisonMode, expected, actual string) (bool, error) {
	expected = normalizeNewlines(expected)
	actual = normalizeNewlines(actual)

	switch mode {
	case contract.ComparisonExact:
		return expected == actual, nil
	case contract.ComparisonTrimmed:
		return trimOutput(expected) == trimOutput(actual), nil
	case contract.ComparisonToken:
		return equalTokens(strings.Fields(expected), strings.Fields(actual), false), nil
	case contract.ComparisonNumericTolerant:
		return equalTokens(strings.Fields(expected), strings.Fields(actual), true), nil
	default:
		// Reaching here means the contract gained a mode the worker does not
		// implement. Failing loudly beats silently marking the case wrong.
		return false, fmt.Errorf("unsupported comparison mode %q", mode)
	}
}

func normalizeNewlines(value string) string {
	return strings.ReplaceAll(value, "\r\n", "\n")
}

// trimOutput strips trailing whitespace from each line and drops trailing
// blank lines. This is the sensible default for a teaching context: a stray
// final newline is not a wrong answer.
func trimOutput(value string) string {
	lines := strings.Split(value, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimRight(line, " \t\r\v\f")
	}
	for len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return strings.Join(lines, "\n")
}

func equalTokens(expected, actual []string, tolerant bool) bool {
	if len(expected) != len(actual) {
		return false
	}
	for i := range expected {
		if expected[i] == actual[i] {
			continue
		}
		if !tolerant || !numbersClose(expected[i], actual[i]) {
			return false
		}
	}
	return true
}

// numbersClose compares two tokens as numbers within a relative epsilon.
// A token pair where either side is not numeric is not close — under
// NUMERIC_TOLERANT, non-numeric tokens are still compared exactly.
func numbersClose(expected, actual string) bool {
	expectedValue, err := strconv.ParseFloat(expected, 64)
	if err != nil {
		return false
	}
	actualValue, err := strconv.ParseFloat(actual, 64)
	if err != nil {
		return false
	}
	if math.IsNaN(expectedValue) || math.IsNaN(actualValue) {
		return false
	}
	if math.IsInf(expectedValue, 0) || math.IsInf(actualValue, 0) {
		return expectedValue == actualValue
	}

	diff := math.Abs(expectedValue - actualValue)
	// Scale the tolerance to the magnitude being compared, falling back to an
	// absolute epsilon near zero where a relative one is meaningless.
	scale := math.Max(math.Abs(expectedValue), math.Abs(actualValue))
	if scale < 1 {
		return diff <= relativeEpsilon
	}
	return diff <= relativeEpsilon*scale
}
