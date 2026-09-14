package grader

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path"
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
)

// ScriptTest is one test a framework reported.
type ScriptTest struct {
	Name       string
	Passed     bool
	DurationMs float64
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
		tests[i].Name = boundName(tests[i].Name)
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
	Status  string    `xml:"status,attr"`
	Time    string    `xml:"time,attr"`
	Failure *struct{} `xml:"failure"`
	Error   *struct{} `xml:"error"`
	Skipped *struct{} `xml:"skipped"`
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
			*into = append(*into, ScriptTest{
				Name:       name,
				Passed:     testCase.Failure == nil && testCase.Error == nil,
				DurationMs: seconds * 1000,
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
			tests = append(tests, ScriptTest{Name: path.Base(suite.Name) + " (failed to run)"})
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
			tests = append(tests, ScriptTest{
				Name:       assertion.FullName,
				Passed:     assertion.Status == "passed",
				DurationMs: duration,
			})
		}
	}
	return tests, nil
}

type customReport struct {
	Tests []struct {
		Name   string `json:"name"`
		Passed *bool  `json:"passed"`
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
		tests = append(tests, ScriptTest{Name: test.Name, Passed: *test.Passed})
	}
	return tests, nil
}

func boundName(name string) string {
	name = strings.TrimSpace(name)
	if len(name) <= maxTestNameLength {
		return name
	}
	// Cut on a rune boundary so a multi-byte name stays valid UTF-8.
	cut := maxTestNameLength
	for cut > 0 && (name[cut]&0xC0) == 0x80 {
		cut--
	}
	return name[:cut] + "…"
}
