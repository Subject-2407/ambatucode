import type { Language, TestScriptFramework } from "@ambatucode/shared";

/**
 * Starting points for test scripts.
 *
 * Every template is written against the same small, invented problem — a
 * `Shape` base and a `Rectangle` with a width, a height and an `area` — so an
 * Architect can read what each check does and then rename it to their own
 * problem. Each one follows the worker's conventions exactly: where the
 * submission is, which package a JUnit class sits in, where a custom runner
 * writes its report. A template that ignored them would fail every Coder.
 */
export type ScriptTemplate = {
  id: string;
  label: string;
  description: string;
  framework: TestScriptFramework;
  language: Language;
  path: string;
  content: string;
};

const JUNIT_STRUCTURE = `import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import org.junit.jupiter.api.Test;

/**
 * Structural checks: inheritance, abstract classes, access modifiers, method
 * signatures and constructors. Replace Shape, Rectangle and area with the names
 * your problem statement asks for.
 *
 * Classes are looked up by name while the tests run, not referenced directly,
 * so a submission missing one fails that test alone instead of failing to
 * compile. Keep this class in the default package, in a file named after it.
 */
public class StructureTest {
    private static Class<?> type(String name) {
        try {
            return Class.forName(name);
        } catch (ClassNotFoundException missing) {
            return fail("Expected a class named " + name);
        }
    }

    @Test
    void rectangleExtendsShape() {
        assertEquals(type("Shape"), type("Rectangle").getSuperclass());
    }

    @Test
    void shapeIsAbstract() {
        assertTrue(Modifier.isAbstract(type("Shape").getModifiers()), "Shape is not abstract");
    }

    @Test
    void rectangleFieldsArePrivate() {
        Field[] fields = type("Rectangle").getDeclaredFields();
        assertTrue(fields.length > 0, "Rectangle declares no fields");
        for (Field field : fields) {
            assertTrue(Modifier.isPrivate(field.getModifiers()), field.getName() + " is not private");
        }
    }

    @Test
    void rectangleHasPublicDoubleArea() throws NoSuchMethodException {
        Method area = type("Rectangle").getMethod("area");
        assertEquals(double.class, area.getReturnType(), "area() does not return double");
    }

    @Test
    void rectangleHasWidthHeightConstructor() throws NoSuchMethodException {
        type("Rectangle").getConstructor(double.class, double.class);
    }
}
`;

const JUNIT_BEHAVIOUR = `import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/**
 * Behaviour checks against the Coder's public API. Unlike the structural
 * template, this refers to Rectangle directly: if the submission has no such
 * class or method, the whole script fails to compile and is reported as one
 * failed test. Keep this class in the default package, in a file named after it.
 */
public class RectangleTest {
    private static final double EPSILON = 1e-9;

    @Test
    void areaIsWidthTimesHeight() {
        assertEquals(6.0, new Rectangle(2, 3).area(), EPSILON);
    }

    @Test
    void zeroWidthHasNoArea() {
        assertEquals(0.0, new Rectangle(0, 5).area(), EPSILON);
    }
}
`;

const PYTEST_STRUCTURE = `"""Structural checks: classes, inheritance, method signatures, privacy.

Replace Shape, Rectangle and area with the names your problem statement asks
for. The submission is main.py. Importing it runs its top-level code, so ask
Coders to keep anything that reads input under \`if __name__ == "__main__":\`.
"""

import inspect

import pytest

import main


def lookup(name):
    value = getattr(main, name, None)
    if not inspect.isclass(value):
        pytest.fail(f"Expected a class named {name}")
    return value


def test_rectangle_extends_shape():
    assert issubclass(lookup("Rectangle"), lookup("Shape"))


def test_shape_is_abstract():
    assert inspect.isabstract(lookup("Shape")), "Shape declares no abstract method"


def test_rectangle_constructor_takes_width_and_height():
    parameters = list(inspect.signature(lookup("Rectangle").__init__).parameters)
    assert parameters == ["self", "width", "height"]


def test_rectangle_defines_area():
    area = getattr(lookup("Rectangle"), "area", None)
    assert callable(area), "Rectangle has no area method"
    assert list(inspect.signature(area).parameters) == ["self"]


def test_rectangle_attributes_are_private():
    rectangle = lookup("Rectangle")(2, 3)
    public = [name for name in vars(rectangle) if not name.startswith("_")]
    assert public == [], f"Attributes without a leading underscore: {public}"
`;

const PYTEST_BEHAVIOUR = `"""Behaviour checks against the Coder's functions and classes.

The submission is main.py. If it has no Rectangle, every test here fails.
"""

import pytest

from main import Rectangle


def test_area_is_width_times_height():
    assert Rectangle(2, 3).area() == pytest.approx(6)


def test_zero_width_has_no_area():
    assert Rectangle(0, 5).area() == pytest.approx(0)
`;

const JEST_STRUCTURE = `/**
 * Structural checks: exported classes, inheritance, methods, private state.
 *
 * Replace Shape, Rectangle and area with the names your problem statement asks
 * for. The submission is main.js, and it must export what is tested, e.g.
 * \`module.exports = { Shape, Rectangle };\`
 */
const submission = require("./main");

function lookup(name) {
  const value = submission[name];
  if (typeof value !== "function") {
    throw new Error(\`Expected main.js to export a class named \${name}\`);
  }
  return value;
}

test("Rectangle extends Shape", () => {
  expect(lookup("Rectangle").prototype).toBeInstanceOf(lookup("Shape"));
});

test("Rectangle defines area()", () => {
  expect(typeof lookup("Rectangle").prototype.area).toBe("function");
});

test("Rectangle takes width and height", () => {
  expect(lookup("Rectangle").length).toBe(2);
});

test("Rectangle keeps its state private", () => {
  const Rectangle = lookup("Rectangle");
  expect(Object.keys(new Rectangle(2, 3))).toEqual([]);
});
`;

const JEST_BEHAVIOUR = `/**
 * Behaviour checks against what main.js exports.
 */
const { Rectangle } = require("./main");

test("area is width times height", () => {
  expect(new Rectangle(2, 3).area()).toBeCloseTo(6);
});

test("zero width has no area", () => {
  expect(new Rectangle(0, 5).area()).toBeCloseTo(0);
});
`;

const GOOGLETEST_STRUCTURE = `// Structural checks for C++: inheritance, abstract classes, private members,
// method signatures and constructors, all decided at compile time.
//
// Replace Shape, Rectangle, area and width_ with the names your problem
// statement asks for. The submission is included below; its main is renamed
// while these tests build, and GoogleTest supplies its own, so write no main.
//
// Every check here is a concept or a type trait, so a member that is missing
// or private makes a test fail instead of stopping the build. Naming a class
// the submission does not declare at all still fails the whole script, which
// is reported as one failed test.
#include <concepts>
#include <type_traits>

#include <gtest/gtest.h>

#include "main.cpp"

template <typename T>
concept HasPublicWidth = requires(T shape) { shape.width_; };

template <typename T>
concept HasDoubleArea = requires(const T& shape) {
    { shape.area() } -> std::same_as<double>;
};

TEST(Structure, RectangleExtendsShape) {
    EXPECT_TRUE((std::is_base_of_v<Shape, Rectangle>));
}

TEST(Structure, ShapeIsAbstract) {
    EXPECT_TRUE(std::is_abstract_v<Shape>);
}

TEST(Structure, AreaIsAConstMethodReturningDouble) {
    EXPECT_TRUE(HasDoubleArea<Rectangle>);
}

TEST(Structure, WidthIsNotPublic) {
    EXPECT_FALSE(HasPublicWidth<Rectangle>);
}

TEST(Structure, RectangleIsBuiltFromWidthAndHeight) {
    EXPECT_TRUE((std::is_constructible_v<Rectangle, double, double>));
    EXPECT_FALSE(std::is_default_constructible_v<Rectangle>);
}
`;

const GOOGLETEST_BEHAVIOUR = `// Behaviour checks: call the Coder's classes and functions directly.
//
// The submission is included below; its main is renamed while these tests
// build, and GoogleTest supplies its own, so write no main. If the submission
// lacks something named here, the script fails to build and is reported as
// one failed test.
#include <gtest/gtest.h>

#include "main.cpp"

TEST(Rectangle, AreaIsWidthTimesHeight) {
    EXPECT_DOUBLE_EQ(6.0, Rectangle(2, 3).area());
}

TEST(Rectangle, ZeroWidthHasNoArea) {
    EXPECT_DOUBLE_EQ(0.0, Rectangle(0, 5).area());
}
`;

const PYTHON_CUSTOM = `"""A custom runner: any checks at all, reported as JSON.

Write {"tests": [{"name": ..., "passed": ...}]} to the file named by the
AMBATUCODE_REPORT environment variable. The submission is main.py.
"""

import inspect
import json
import os

tests = []


def check(name, passed):
    tests.append({"name": name, "passed": bool(passed)})


try:
    import main
except BaseException:  # a syntax error or an exit() is still a result
    main = None
check("main.py imports", main is not None)

Rectangle = getattr(main, "Rectangle", None)
check("defines a Rectangle class", inspect.isclass(Rectangle))
check("Rectangle has an area method", callable(getattr(Rectangle, "area", None)))

with open(os.environ["AMBATUCODE_REPORT"], "w", encoding="utf-8") as report:
    json.dump({"tests": tests}, report)
`;

const NODE_CUSTOM = `/**
 * A custom runner: any checks at all, reported as JSON.
 *
 * Write {"tests": [{"name": ..., "passed": ...}]} to the file named by the
 * AMBATUCODE_REPORT environment variable. The submission is main.js.
 */
const fs = require("fs");

const tests = [];
const check = (name, passed) => tests.push({ name, passed: Boolean(passed) });

let submission = null;
try {
  submission = require("./main");
} catch {
  // A submission that throws while loading is still a result.
}
check("main.js loads", submission !== null);

const Rectangle = submission?.Rectangle;
check("exports a Rectangle class", typeof Rectangle === "function");
check("Rectangle has an area method", typeof Rectangle?.prototype?.area === "function");

fs.writeFileSync(process.env.AMBATUCODE_REPORT, JSON.stringify({ tests }));
`;

const JAVA_CUSTOM = `import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * A custom runner: any checks at all, reported as JSON.
 *
 * Its main method writes {"tests": [{"name": ..., "passed": ...}]} to the file
 * named by the AMBATUCODE_REPORT environment variable. It is compiled with the
 * submission's classes, in the default package, in a file named after it.
 */
public class Check {
    private static final List<String> results = new ArrayList<>();

    private static void check(String name, boolean passed) {
        results.add("{\\"name\\":\\"" + name + "\\",\\"passed\\":" + passed + "}");
    }

    private static Class<?> find(String name) {
        try {
            return Class.forName(name);
        } catch (ClassNotFoundException missing) {
            return null;
        }
    }

    public static void main(String[] args) throws Exception {
        Class<?> rectangle = find("Rectangle");
        check("declares a Rectangle class", rectangle != null);
        check("Rectangle is not abstract",
            rectangle != null && !Modifier.isAbstract(rectangle.getModifiers()));

        String report = "{\\"tests\\":[" + String.join(",", results) + "]}";
        Files.writeString(Path.of(System.getenv("AMBATUCODE_REPORT")), report);
    }
}
`;

const CPP_CUSTOM = `// A custom runner for C++: runs the Coder's compiled program and checks what
// it prints.
//
// C++ has no reflection, so a runner cannot inspect classes the way JUnit or
// pytest can; it checks behaviour through the program's input and output.
// The program's path is in AMBATUCODE_PROGRAM. Results go, as
// {"tests": [{"name": ..., "passed": ...}]}, to the file named by
// AMBATUCODE_REPORT.
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <unistd.h>

struct Result {
    std::string name;
    bool passed;
};

// Runs the program with the given stdin and returns what it printed. The
// input is written to a file rather than into the command line, so nothing in
// it is ever read by the shell.
static std::string run(const std::string& input) {
    char path[] = "/tmp/ambatucode-input-XXXXXX";
    int fd = mkstemp(path);
    if (fd < 0) return "";
    std::FILE* file = fdopen(fd, "w");
    std::fputs(input.c_str(), file);
    std::fclose(file);

    std::string command = std::string(std::getenv("AMBATUCODE_PROGRAM")) + " < " + path;
    std::string output;
    if (std::FILE* pipe = popen(command.c_str(), "r")) {
        char buffer[256];
        while (std::fgets(buffer, sizeof buffer, pipe)) output += buffer;
        pclose(pipe);
    }
    std::remove(path);
    return output;
}

static std::string trimmed(std::string value) {
    while (!value.empty() && (value.back() == '\\n' || value.back() == ' ')) value.pop_back();
    return value;
}

int main() {
    std::vector<Result> results;
    results.push_back({"area of a 2 by 3 rectangle", trimmed(run("2 3\\n")) == "6"});
    results.push_back({"area of a 0 by 5 rectangle", trimmed(run("0 5\\n")) == "0"});

    std::ostringstream json;
    json << "{\\"tests\\":[";
    for (std::size_t i = 0; i < results.size(); ++i) {
        json << (i ? "," : "") << "{\\"name\\":\\"" << results[i].name
             << "\\",\\"passed\\":" << (results[i].passed ? "true" : "false") << "}";
    }
    json << "]}";
    std::ofstream(std::getenv("AMBATUCODE_REPORT")) << json.str();
}
`;

export const SCRIPT_TEMPLATES: readonly ScriptTemplate[] = [
  {
    id: "junit-structure",
    label: "Class structure",
    description:
      "Inheritance, abstract classes, private fields, method and constructor signatures.",
    framework: "JUNIT",
    language: "java",
    path: "StructureTest.java",
    content: JUNIT_STRUCTURE,
  },
  {
    id: "junit-behaviour",
    label: "Behaviour",
    description: "Unit tests that call the Coder's classes and check the results.",
    framework: "JUNIT",
    language: "java",
    path: "RectangleTest.java",
    content: JUNIT_BEHAVIOUR,
  },
  {
    id: "pytest-structure",
    label: "Class structure",
    description: "Classes, inheritance, abstract bases, signatures and private attributes.",
    framework: "PYTEST",
    language: "python",
    path: "test_structure.py",
    content: PYTEST_STRUCTURE,
  },
  {
    id: "pytest-behaviour",
    label: "Behaviour",
    description: "Unit tests that call the Coder's functions and classes.",
    framework: "PYTEST",
    language: "python",
    path: "test_rectangle.py",
    content: PYTEST_BEHAVIOUR,
  },
  {
    id: "jest-structure",
    label: "Class structure",
    description: "Exported classes, inheritance, methods and private state.",
    framework: "JEST",
    language: "javascript",
    path: "structure.test.js",
    content: JEST_STRUCTURE,
  },
  {
    id: "jest-behaviour",
    label: "Behaviour",
    description: "Unit tests against what main.js exports.",
    framework: "JEST",
    language: "javascript",
    path: "rectangle.test.js",
    content: JEST_BEHAVIOUR,
  },
  {
    id: "googletest-structure",
    label: "Class structure",
    description:
      "Inheritance, abstract classes, private members and signatures, checked with concepts and type traits.",
    framework: "GOOGLETEST",
    language: "cpp",
    path: "structure_test.cpp",
    content: GOOGLETEST_STRUCTURE,
  },
  {
    id: "googletest-behaviour",
    label: "Behaviour",
    description: "Unit tests that call the Coder's classes and functions.",
    framework: "GOOGLETEST",
    language: "cpp",
    path: "rectangle_test.cpp",
    content: GOOGLETEST_BEHAVIOUR,
  },
  {
    id: "custom-python",
    label: "Custom runner",
    description: "Any checks you like, reported as JSON.",
    framework: "CUSTOM",
    language: "python",
    path: "check.py",
    content: PYTHON_CUSTOM,
  },
  {
    id: "custom-javascript",
    label: "Custom runner",
    description: "Any checks you like, reported as JSON.",
    framework: "CUSTOM",
    language: "javascript",
    path: "check.js",
    content: NODE_CUSTOM,
  },
  {
    id: "custom-java",
    label: "Custom runner",
    description: "Any checks you like, reported as JSON.",
    framework: "CUSTOM",
    language: "java",
    path: "Check.java",
    content: JAVA_CUSTOM,
  },
  {
    id: "custom-cpp",
    label: "Input and output runner",
    description: "Runs the compiled program with inputs and checks what it prints.",
    framework: "CUSTOM",
    language: "cpp",
    path: "check.cpp",
    content: CPP_CUSTOM,
  },
];

export function templatesFor(framework: TestScriptFramework, language: Language): ScriptTemplate[] {
  return SCRIPT_TEMPLATES.filter(
    (template) => template.framework === framework && template.language === language,
  );
}
