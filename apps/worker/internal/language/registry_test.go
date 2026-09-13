package language

import (
	"regexp"
	"strings"
	"testing"

	"github.com/Subject-2407/ambatucode/apps/worker/internal/contract"
)

// Every language the contract names must be runnable, or an Architect can
// offer a Coder a language that fails as a SYSTEM_ERROR halfway through an
// exercise — a failure that arrives at the worst moment and looks like theirs.
func TestEveryContractLanguageIsRegistered(t *testing.T) {
	for _, id := range []contract.Language{
		contract.LanguagePython,
		contract.LanguageJavaScript,
		contract.LanguageJava,
		contract.LanguageCPP,
	} {
		spec, err := Lookup(id)
		if err != nil {
			t.Fatalf("language %q is in the contract but not the registry: %v", id, err)
		}
		if spec.Image == "" || spec.SourceFile == "" || len(spec.RunCmd) == 0 {
			t.Fatalf("language %q has an incomplete spec: %+v", id, spec)
		}
	}
}

func TestLookupRejectsAnUnknownLanguage(t *testing.T) {
	if _, err := Lookup(contract.Language("rust")); err == nil {
		t.Fatal("an unregistered language must be an error, not a zero spec that runs nothing")
	}
}

// Compiled languages need a build step before anything runs; interpreted ones
// must not get one, or every job would fail on a command that does not exist.
func TestCompiledReportsWhoNeedsABuildStep(t *testing.T) {
	cases := map[contract.Language]bool{
		contract.LanguagePython:     false,
		contract.LanguageJavaScript: false,
		contract.LanguageJava:       true,
		contract.LanguageCPP:        true,
	}

	for id, want := range cases {
		spec, err := Lookup(id)
		if err != nil {
			t.Fatalf("lookup %q: %v", id, err)
		}
		if spec.Compiled() != want {
			t.Fatalf("%q Compiled() = %v, want %v", id, spec.Compiled(), want)
		}
	}
}

// Every path in a spec has to point inside the workspace the sandbox actually
// mounts. A drift here leaves a job unable to find its own source file.
func TestSpecPathsStayInsideTheWorkspace(t *testing.T) {
	for _, id := range []contract.Language{
		contract.LanguagePython,
		contract.LanguageJavaScript,
		contract.LanguageJava,
		contract.LanguageCPP,
	} {
		spec, _ := Lookup(id)
		for _, arg := range append(append([]string{}, spec.CompileCmd...), spec.RunCmd...) {
			if strings.HasPrefix(arg, "/") && !strings.HasPrefix(arg, WorkspaceDir) {
				t.Fatalf("%q references the absolute path %q outside %s", id, arg, WorkspaceDir)
			}
		}
	}
}

func TestImagesCoversEveryRegisteredLanguage(t *testing.T) {
	if got, want := len(Images()), len(Supported()); got != want {
		t.Fatalf("Images() has %d entries for %d languages", got, want)
	}
}

func TestAdaptJavaRenamesTheFileToMatchThePublicClass(t *testing.T) {
	spec, _ := Lookup(contract.LanguageJava)

	cases := []struct {
		name   string
		source string
		want   string
	}{
		{
			// Without this the JVM answers "class Solution is public, should be
			// declared in a file named Solution.java" — a compiler error about
			// the platform's own file naming that says nothing about the code.
			name:   "public class",
			source: "public class Solution { public static void main(String[] a) {} }",
			want:   "Solution",
		},
		{
			name:   "modifiers before class",
			source: "import java.util.*;\n\npublic final class Runner {}",
			want:   "Runner",
		},
		{
			name:   "indented declaration",
			source: "\t public abstract class Shape {}",
			want:   "Shape",
		},
		{
			// Package-private is perfectly legal Java and needs no rename.
			name:   "no public class",
			source: "class Main { public static void main(String[] a) {} }",
			want:   "Main",
		},
		{
			// "public" inside a comment or a string is not a declaration.
			name:   "the word public in prose",
			source: "// this public class is just a comment\nclass Main {}",
			want:   "Main",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			adapted := spec.For(testCase.source)

			if adapted.SourceFile != testCase.want+".java" {
				t.Fatalf("SourceFile = %q, want %q", adapted.SourceFile, testCase.want+".java")
			}
			if last := adapted.RunCmd[len(adapted.RunCmd)-1]; last != testCase.want {
				t.Fatalf("launched class = %q, want %q", last, testCase.want)
			}
		})
	}
}

// The one place participant source reaches a filename and an argument vector.
// It is not extracted and trusted — it is matched against the shape of a Java
// identifier, so nothing that is not one can come out at all.
func TestAdaptJavaCannotProduceAPathOrAFlag(t *testing.T) {
	identifier := regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`)
	spec, _ := Lookup(contract.LanguageJava)

	hostile := []string{
		"public class ../../etc/passwd {}",
		"public class /tmp/evil {}",
		"public class -Xshare:off {}",
		"public class Main;rm -rf / {}",
		"public class Main$(whoami) {}",
		"public class " + strings.Repeat("A", 4096) + " {}",
		"public class \n {}",
	}

	for _, source := range hostile {
		adapted := spec.For(source)

		name := strings.TrimSuffix(adapted.SourceFile, ".java")
		if !identifier.MatchString(name) {
			t.Fatalf("source %.40q produced the file name %q", source, adapted.SourceFile)
		}
		launched := adapted.RunCmd[len(adapted.RunCmd)-1]
		if !identifier.MatchString(launched) {
			t.Fatalf("source %.40q produced the launch argument %q", source, launched)
		}
	}
}

// A bounded read of the source, so a pathological file cannot be turned into a
// pathological filename.
func TestAdaptJavaIgnoresAnAbsurdlyLongClassName(t *testing.T) {
	spec, _ := Lookup(contract.LanguageJava)
	adapted := spec.For("public class " + strings.Repeat("A", 200) + " {}")

	if adapted.SourceFile != "Main.java" {
		t.Fatalf("SourceFile = %q, want the fixed default", adapted.SourceFile)
	}
}
