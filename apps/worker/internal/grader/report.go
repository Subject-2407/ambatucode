package grader

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path"
	"regexp"
	"strconv"
	"strings"
)

// ReportFormat is the machine-readable shape a test framework reports in.
type ReportFormat string

const (
	// ReportJUnitXML is written by pytest's --junit-xml and by the JUnit
	// Platform console launcher.
	ReportJUnitXML ReportFormat = "junit-xml"
	// ReportJestJSON is written by Jest's --json --outputFile.
	ReportJestJSON ReportFormat = "jest-json"
	// ReportCustomJSON is the format a CUSTOM test script writes itself:
	//
	//	{"tests": [{"name": "adds two numbers", "passed": true}]}
	ReportCustomJSON ReportFormat = "custom-json"
)

const (
	// maxScriptTests bounds what one script can put into grading history. A
	// script that reports more is misbehaving, not thorough.
	maxScriptTests = 1000
	// maxTestNameLength keeps a single test's name to a readable row.
	maxTestNameLength = 200
	// maxDetailLength keeps a failure's explanation to a readable paragraph.
	// Only a CUSTOM script's own message can approach it; everything else is
	// built here from a fixed vocabulary.
	maxDetailLength = 400
)

// ScriptTest is one test a framework reported.
type ScriptTest struct {
	Name       string
	Passed     bool
	DurationMs float64
	// Detail says why a failing test failed, in words and with no value from
	// the assertion in them. See FailureDetail on the contract for why the
	// framework's own message is not what travels.
	Detail string
}

// ErrNoTests means the report parsed but recorded nothing that ran. A script
// that tests nothing cannot grade anything, so the caller treats it as a
// failed script rather than a pass.
var ErrNoTests = errors.New("the test framework found no tests to run; check that the tests sit where the file name says and use the framework's own annotations")

// ParseReport reads a framework report into tests.
//
// Skipped, pending, and todo tests are left out: the Architect chose not to
// run them, so they neither earn nor cost the Coder anything.
func ParseReport(format ReportFormat, data []byte) ([]ScriptTest, error) {
	var (
		tests []ScriptTest
		err   error
	)
	switch format {
	case ReportJUnitXML:
		tests, err = parseJUnitXML(data)
	case ReportJestJSON:
		tests, err = parseJestJSON(data)
	case ReportCustomJSON:
		tests, err = parseCustomJSON(data)
	default:
		return nil, fmt.Errorf("unknown report format %q", format)
	}
	if err != nil {
		return nil, err
	}
	if len(tests) == 0 {
		return nil, ErrNoTests
	}
	if len(tests) > maxScriptTests {
		return nil, fmt.Errorf("the test report records %d tests, more than the %d allowed", len(tests), maxScriptTests)
	}
	for i := range tests {
		tests[i].Name = bound(tests[i].Name, maxTestNameLength)
		tests[i].Detail = bound(tests[i].Detail, maxDetailLength)
	}
	return tests, nil
}

type junitSuites struct {
	Suites []junitSuite `xml:"testsuite"`
}

type junitSuite struct {
	Cases  []junitCase  `xml:"testcase"`
	Suites []junitSuite `xml:"testsuite"`
}

type junitCase struct {
	ClassName string `xml:"classname,attr"`
	Name      string `xml:"name,attr"`
	// Status is GoogleTest's: a disabled test is status="notrun" and carries
	// no <skipped> element, so without it a disabled test would count as passed.
	Status  string        `xml:"status,attr"`
	Time    string        `xml:"time,attr"`
	Failure *junitOutcome `xml:"failure"`
	Error   *junitOutcome `xml:"error"`
	Skipped *struct{}     `xml:"skipped"`
}

// junitOutcome is a <failure> or an <error>. Message is read but never
// forwarded: those are the framework's own words, and they quote the value the
// test expected. Type and the element body say what kind of failure it was,
// which is all a Coder is told.
type junitOutcome struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Body    string `xml:",chardata"`
}

// parseJUnitXML accepts either root: pytest writes <testsuites>, the JUnit
// console launcher writes a bare <testsuite>. A failed import or a test file
// that would not load appears as a testcase carrying <error>, so it counts as
// a failed test rather than vanishing.
func parseJUnitXML(data []byte) ([]ScriptTest, error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return nil, errors.New("the JUnit report has no root element")
		}
		if err != nil {
			return nil, fmt.Errorf("read the JUnit report: %w", err)
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}

		var suites []junitSuite
		switch start.Name.Local {
		case "testsuites":
			var root junitSuites
			if err := decoder.DecodeElement(&root, &start); err != nil {
				return nil, fmt.Errorf("decode the JUnit report: %w", err)
			}
			suites = root.Suites
		case "testsuite":
			var root junitSuite
			if err := decoder.DecodeElement(&root, &start); err != nil {
				return nil, fmt.Errorf("decode the JUnit report: %w", err)
			}
			suites = []junitSuite{root}
		default:
			return nil, fmt.Errorf("the JUnit report's root is <%s>, not a test suite", start.Name.Local)
		}

		var tests []ScriptTest
		collectJUnit(suites, &tests)
		return tests, nil
	}
}

func collectJUnit(suites []junitSuite, into *[]ScriptTest) {
	for _, suite := range suites {
		for _, testCase := range suite.Cases {
			if testCase.Skipped != nil || testCase.Status == "notrun" {
				continue
			}
			name := testCase.Name
			if testCase.ClassName != "" {
				name = testCase.ClassName + "." + testCase.Name
			}
			seconds, _ := strconv.ParseFloat(testCase.Time, 64)
			passed := testCase.Failure == nil && testCase.Error == nil
			detail := ""
			switch {
			case passed:
			case testCase.Failure != nil:
				detail = describeJUnitOutcome(testCase.Failure, false)
			default:
				detail = describeJUnitOutcome(testCase.Error, true)
			}
			*into = append(*into, ScriptTest{
				Name:       name,
				Passed:     passed,
				DurationMs: seconds * 1000,
				Detail:     detail,
			})
		}
		collectJUnit(suite.Suites, into)
	}
}

type jestReport struct {
	TestResults []struct {
		Name             string `json:"name"`
		Status           string `json:"status"`
		AssertionResults []struct {
			FullName string   `json:"fullName"`
			Status   string   `json:"status"`
			Duration *float64 `json:"duration"`
			// Read to classify the failure, never forwarded: Jest prints the
			// value it expected straight into it.
			FailureMessages []string `json:"failureMessages"`
		} `json:"assertionResults"`
	} `json:"testResults"`
}

// parseJestJSON reads Jest's JSON report. A suite that failed to load —
// a require that threw, a syntax error — reports no assertions at all, and is
// recorded as one failed test so the failure is counted.
func parseJestJSON(data []byte) ([]ScriptTest, error) {
	var report jestReport
	if err := json.Unmarshal(data, &report); err != nil {
		return nil, fmt.Errorf("decode the Jest report: %w", err)
	}

	var tests []ScriptTest
	for _, suite := range report.TestResults {
		if len(suite.AssertionResults) == 0 && suite.Status == "failed" {
			tests = append(tests, ScriptTest{
				Name:   path.Base(suite.Name) + " (failed to run)",
				Detail: detailSuiteFailedToLoad,
			})
			continue
		}
		for _, assertion := range suite.AssertionResults {
			if assertion.Status != "passed" && assertion.Status != "failed" {
				continue
			}
			duration := 0.0
			if assertion.Duration != nil {
				duration = *assertion.Duration
			}
			passed := assertion.Status == "passed"
			detail := ""
			if !passed {
				detail = describeJestFailure(assertion.FailureMessages)
			}
			tests = append(tests, ScriptTest{
				Name:       assertion.FullName,
				Passed:     passed,
				DurationMs: duration,
				Detail:     detail,
			})
		}
	}
	return tests, nil
}

type customReport struct {
	Tests []struct {
		Name   string `json:"name"`
		Passed *bool  `json:"passed"`
		// Message is the one failure text that reaches a Coder verbatim. A
		// CUSTOM script is the Architect's own program and this field is theirs
		// to write, so what it says is feedback they chose to give rather than a
		// framework spilling what it was holding.
		Message string `json:"message"`
	} `json:"tests"`
}

// parseCustomJSON is deliberately strict. The format is ours, so a test with
// no name or no verdict is a script bug worth surfacing, not a pass to guess.
func parseCustomJSON(data []byte) ([]ScriptTest, error) {
	var report customReport
	if err := json.Unmarshal(data, &report); err != nil {
		return nil, fmt.Errorf("decode the custom test report: %w", err)
	}

	tests := make([]ScriptTest, 0, len(report.Tests))
	for i, test := range report.Tests {
		if strings.TrimSpace(test.Name) == "" {
			return nil, fmt.Errorf("custom test report entry %d has no name", i)
		}
		if test.Passed == nil {
			return nil, fmt.Errorf("custom test report entry %d (%s) has no passed verdict", i, test.Name)
		}
		detail := ""
		if !*test.Passed {
			detail = strings.TrimSpace(test.Message)
		}
		tests = append(tests, ScriptTest{Name: test.Name, Passed: *test.Passed, Detail: detail})
	}
	return tests, nil
}

func bound(text string, limit int) string {
	text = strings.TrimSpace(text)
	if len(text) <= limit {
		return text
	}
	// Cut on a rune boundary so a multi-byte string stays valid UTF-8.
	cut := limit
	for cut > 0 && (text[cut]&0xC0) == 0x80 {
		cut--
	}
	return text[:cut] + "…"
}

// --- Why a test failed ------------------------------------------------------

// What a Coder is told, in the platform's words rather than the framework's.
//
// Every one of these is a shape, not a value: "an assertion failed" and "your
// code threw X" are facts about the Coder's own program, while "expected 5 but
// was 0" is the grading data invariant 8 keeps out of the browser. The test's
// name is the only thing that says which assertion it was, and whether a Coder
// sees that is the Architect's decision, not this file's.
const (
	detailAssertion         = "An assertion failed: what your code produced is not what this test expects."
	detailCouldNotRun       = "This test could not run against your code."
	detailSuiteFailedToLoad = "This test file could not be loaded against your code. Check that everything it uses is defined, and spelled the way the task asks for."
	detailUnknown           = "This test failed."
)

// throwablePattern finds a qualified exception or error name at the head of a
// line, which is how every framework here starts a stack trace. Only the class
// name is taken; the message that follows it is left where it is.
var throwablePattern = regexp.MustCompile(`(?m)^[ \t]*(?:[\w$]+\.)*([A-Za-z_][A-Za-z0-9_$]*(?:Error|Exception|Throwable))\b`)

// ansiPattern strips the colour Jest writes into its failure messages.
var ansiPattern = regexp.MustCompile("\x1b\\[[0-9;]*m")

// describeJUnitOutcome classifies a <failure> or an <error>.
//
// The type attribute is authoritative wherever a framework writes one: pytest
// and the JUnit console launcher both put the exception class there.
// GoogleTest leaves it empty on an assertion, which is why an unrecognised
// failure reads as an assertion rather than as nothing at all.
func describeJUnitOutcome(outcome *junitOutcome, isError bool) string {
	if outcome == nil {
		return detailUnknown
	}

	kind := simpleTypeName(outcome.Type)
	if kind == "" {
		kind = sniffThrowable(outcome.Body)
	}
	switch {
	case kind == "" && isError:
		return detailCouldNotRun
	case kind == "":
		return detailAssertion
	case isAssertionType(kind):
		return detailAssertion
	default:
		return "Your code threw " + kind + "."
	}
}

// describeJestFailure classifies a Jest failure. Jest reports a failed
// expectation and a thrown error through the same field, so the two are told
// apart by the matcher call it prints at the head of an expectation.
func describeJestFailure(messages []string) string {
	for _, message := range messages {
		plain := ansiPattern.ReplaceAllString(message, "")
		if strings.Contains(plain, "expect(") {
			return detailAssertion
		}
		if kind := sniffThrowable(plain); kind != "" {
			return "Your code threw " + kind + "."
		}
	}
	return detailUnknown
}

// identifierChars is every character a class name may be built from. A type
// name holding anything else came from somewhere this does not understand.
const identifierChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$"

// simpleTypeName drops the package or module a type name is qualified with.
func simpleTypeName(name string) string {
	name = strings.TrimSpace(name)
	if index := strings.LastIndex(name, "."); index >= 0 {
		name = name[index+1:]
	}
	if name == "" {
		return ""
	}
	// Anything that is not a plain identifier came from somewhere this does not
	// understand, and is not worth repeating to a Coder.
	if strings.ContainsFunc(name, func(char rune) bool {
		return !strings.ContainsRune(identifierChars, char)
	}) {
		return ""
	}
	return name
}

// sniffThrowable reads a class name out of the head of a stack trace. Only the
// first match is considered, and only the class name is returned.
func sniffThrowable(body string) string {
	match := throwablePattern.FindStringSubmatch(body)
	if match == nil {
		return ""
	}
	return match[1]
}

// isAssertionType reports whether a type name is a framework saying "the value
// was wrong" rather than "your code blew up".
func isAssertionType(kind string) bool {
	switch kind {
	case "AssertionError", "AssertionFailedError", "AssertionFailure",
		"ComparisonFailure", "MultipleFailuresError", "TestAbortedException":
		return true
	default:
		return false
	}
}
