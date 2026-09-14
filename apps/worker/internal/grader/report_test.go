package grader

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"
)

// Captured from pytest 9.1.1 in the sandbox image.
const pytestReport = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="1" skipped="1" tests="3" time="0.028"><testcase classname="tests.test_main" name="test_adds" time="0.004" /><testcase classname="tests.test_main" name="test_wrong" time="0.001"><failure message="assert 4 == 5">def test_wrong():
&gt;       assert add(2, 2) == 5</failure></testcase><testcase classname="tests.test_main" name="test_later" time="0.000"><skipped message="not yet" /></testcase></testsuite></testsuites>`

// pytest's report when the Coder's module does not import.
const pytestCollectionError = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="1" failures="0" skipped="0" tests="1" time="0.174"><testcase classname="" name="tests.test_main" time="0.000"><error message="collection failure">SyntaxError: expected ':'</error></testcase></testsuite></testsuites>`

// The JUnit Platform console launcher's legacy report, trimmed of properties.
const junitReport = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="JUnit Jupiter" tests="2" skipped="0" failures="1" errors="0" time="0.078">
<properties><property name="java.version" value="21"/></properties>
<testcase name="adds()" classname="SolutionTest" time="0.021"/>
<testcase name="wrong()" classname="SolutionTest" time="0.004">
<failure message="expected: &lt;5&gt; but was: &lt;4&gt;" type="org.opentest4j.AssertionFailedError">stack</failure>
</testcase>
</testsuite>`

// Captured from Jest 30.5.1: one suite with a pass, a failure, and a skip, and
// one suite that failed to load.
const jestSample = `{"numTotalTests":3,"testResults":[
{"name":"/workspace/checks/add.check.js","status":"failed","assertionResults":[
 {"fullName":"adds","status":"passed","duration":4},
 {"fullName":"group wrong","status":"failed","duration":2},
 {"fullName":"later","status":"pending","duration":null}]},
{"name":"/workspace/checks/broken.check.js","status":"failed","message":"Cannot find module","assertionResults":[]}
]}`

func TestParsePytestReport(t *testing.T) {
	tests, err := ParseReport(ReportJUnitXML, []byte(pytestReport))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	want := []ScriptTest{
		{Name: "tests.test_main.test_adds", Passed: true, DurationMs: 4},
		{Name: "tests.test_main.test_wrong", Passed: false, DurationMs: 1},
	}
	assertTests(t, tests, want)
}

// A Coder's syntax error is a failed test, not a platform failure.
func TestParsePytestCollectionErrorAsAFailedTest(t *testing.T) {
	tests, err := ParseReport(ReportJUnitXML, []byte(pytestCollectionError))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	assertTests(t, tests, []ScriptTest{{Name: "tests.test_main", Passed: false}})
}

func TestParseJUnitConsoleReport(t *testing.T) {
	tests, err := ParseReport(ReportJUnitXML, []byte(junitReport))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	want := []ScriptTest{
		{Name: "SolutionTest.adds()", Passed: true, DurationMs: 21},
		{Name: "SolutionTest.wrong()", Passed: false, DurationMs: 4},
	}
	assertTests(t, tests, want)
}

// Captured from GoogleTest 1.12 in the C++ sandbox image: a pass, a failure, a
// disabled test, and a skipped one.
const googleTestReport = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="4" failures="1" disabled="1" errors="0" time="0" timestamp="2026-09-14T08:05:33.946" name="AllTests">
  <testsuite name="Rectangle" tests="4" failures="1" disabled="1" skipped="1" errors="0" time="0" timestamp="2026-09-14T08:05:33.946">
    <testcase name="Area" file="t.cpp" line="2" status="run" result="completed" time="0" timestamp="2026-09-14T08:05:33.946" classname="Rectangle" />
    <testcase name="Wrong" file="t.cpp" line="3" status="run" result="completed" time="0" timestamp="2026-09-14T08:05:33.946" classname="Rectangle">
      <failure message="t.cpp:3&#x0A;Expected equality of these values:&#x0A;  5&#x0A;  2 * 2&#x0A;    Which is: 4" type=""><![CDATA[t.cpp:3
Expected equality of these values:
  5
  2 * 2
    Which is: 4]]></failure>
    </testcase>
    <testcase name="DISABLED_Later" file="t.cpp" line="4" status="notrun" result="suppressed" time="0" timestamp="1970-01-01T00:00:00.000" classname="Rectangle" />
    <testcase name="Skips" file="t.cpp" line="5" status="run" result="skipped" time="0" timestamp="2026-09-14T08:05:33.946" classname="Rectangle">
      <skipped message="t.cpp:5&#x0A;not yet"><![CDATA[t.cpp:5
not yet]]></skipped>
    </testcase>
  </testsuite>
</testsuites>`

// A disabled GoogleTest test carries no <skipped>; it must not count as passed.
func TestParseGoogleTestReport(t *testing.T) {
	tests, err := ParseReport(ReportJUnitXML, []byte(googleTestReport))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	assertTests(t, tests, []ScriptTest{
		{Name: "Rectangle.Area", Passed: true},
		{Name: "Rectangle.Wrong", Passed: false},
	})
}

func TestParseJestReport(t *testing.T) {
	tests, err := ParseReport(ReportJestJSON, []byte(jestSample))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	want := []ScriptTest{
		{Name: "adds", Passed: true, DurationMs: 4},
		{Name: "group wrong", Passed: false, DurationMs: 2},
		{Name: "broken.check.js (failed to run)", Passed: false},
	}
	assertTests(t, tests, want)
}

func TestParseCustomReport(t *testing.T) {
	tests, err := ParseReport(ReportCustomJSON,
		[]byte(`{"tests":[{"name":"adds","passed":true},{"name":"rejects negatives","passed":false}]}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	assertTests(t, tests, []ScriptTest{
		{Name: "adds", Passed: true},
		{Name: "rejects negatives", Passed: false},
	})
}

// The custom format is ours: a missing verdict is a script bug, never a pass.
func TestParseCustomReportRejectsIncompleteEntries(t *testing.T) {
	for _, report := range []string{
		`{"tests":[{"name":"adds"}]}`,
		`{"tests":[{"passed":true}]}`,
		`{"tests":[{"name":"  ","passed":true}]}`,
		`not json`,
	} {
		if _, err := ParseReport(ReportCustomJSON, []byte(report)); err == nil {
			t.Errorf("accepted %s", report)
		}
	}
}

// A script that ran nothing cannot grade anything.
func TestParseReportWithNoTestsIsAnError(t *testing.T) {
	cases := map[ReportFormat]string{
		ReportJUnitXML:   `<testsuites><testsuite tests="0"></testsuite></testsuites>`,
		ReportJestJSON:   `{"testResults":[]}`,
		ReportCustomJSON: `{"tests":[]}`,
	}
	for format, report := range cases {
		if _, err := ParseReport(format, []byte(report)); !errors.Is(err, ErrNoTests) {
			t.Errorf("%s: error = %v, want ErrNoTests", format, err)
		}
	}
}

func TestParseReportRejectsMalformedAndOversizedReports(t *testing.T) {
	if _, err := ParseReport(ReportJUnitXML, []byte(`<html></html>`)); err == nil {
		t.Error("accepted a JUnit report with the wrong root")
	}
	if _, err := ParseReport(ReportJestJSON, []byte(`{`)); err == nil {
		t.Error("accepted truncated Jest JSON")
	}

	var many strings.Builder
	many.WriteString(`{"tests":[`)
	for i := 0; i <= maxScriptTests; i++ {
		if i > 0 {
			many.WriteString(",")
		}
		fmt.Fprintf(&many, `{"name":"t%d","passed":true}`, i)
	}
	many.WriteString(`]}`)
	if _, err := ParseReport(ReportCustomJSON, []byte(many.String())); err == nil {
		t.Error("accepted more tests than allowed")
	}
}

func TestParseReportBoundsLongNamesOnARuneBoundary(t *testing.T) {
	long := strings.Repeat("é", maxTestNameLength)
	tests, err := ParseReport(ReportCustomJSON, []byte(`{"tests":[{"name":"`+long+`","passed":true}]}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !utf8.ValidString(tests[0].Name) {
		t.Fatal("bounding the name produced invalid UTF-8")
	}
	if len(tests[0].Name) > maxTestNameLength+len("…") {
		t.Fatalf("name is %d bytes", len(tests[0].Name))
	}
}

func assertTests(t *testing.T, got, want []ScriptTest) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d tests %+v, want %d", len(got), got, len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("test %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}
