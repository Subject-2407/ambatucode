# Java 21 sandbox.
#
# Built locally and never pulled at execution time — the platform has to run
# fully offline, and the worker resolves this image by tag and fails loudly if
# it is missing rather than reaching for a registry.
#
# Build context is the repository root:
#   docker compose -f docker/compose/sandbox.yml build
#
# Every base image is pinned by digest. The tag beside it is for humans; the
# digest is what gets built, so a lab image is exactly the one that was tested.
# Updating a base means changing both, rebuilding, and rerunning the worker's
# Docker test suite before the images are exported to a lab.

# A full JDK is roughly 300 MB, most of it tooling a graded program never
# touches: jshell, jpackage, the debugger, and every module's man pages and
# headers. jlink assembles a runtime holding only what runs here.
FROM eclipse-temurin:21.0.12_8-jdk-noble@sha256:2fc8306f51cd8c1582b972213f3115300074084ec4f9060448454f04ecbd941b AS jdk

# java.se is the whole standard API a Coder may reasonably import. jdk.compiler
# is javac. jdk.jfr, jdk.unsupported and jdk.zipfs are what the JUnit Platform
# console launcher reaches for (jdeps); jdk.charsets keeps non-UTF-8 charsets a
# program may name. The CDS archive keeps JVM startup — paid once per test case
# — as fast as the full JDK's.
RUN jlink \
      --add-modules java.se,jdk.compiler,jdk.jfr,jdk.unsupported,jdk.zipfs,jdk.charsets \
      --strip-debug \
      --no-man-pages \
      --no-header-files \
      --compress=zip-6 \
      --generate-cds-archive \
      --output /opt/runtime

# The same Debian base as the C++ and JavaScript images, so the three share a
# layer on disk and in an exported image archive. Temurin binaries target an
# old glibc and run on it unchanged.
FROM debian:12.15-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

# The job process runs as 65534:65534 with a read-only root filesystem, so
# every writable path it can reach is a tmpfs the worker mounts.
#
#   HOME        — the JVM writes hsperfdata and crash logs under it, and a
#                 read-only default home fails the launch outright.
#   LANG        — slim Debian ships no locales; C.UTF-8 is built into glibc and
#                 keeps file names and console output UTF-8.
#   JAVA_TOOL_OPTIONS — headless, because there is no display and an AWT
#                 initialisation would otherwise stall until it gave up. The
#                 file.encoding pin makes a Coder's UTF-8 output survive a
#                 container with no locale configured.
#
# The JVM is not given a heap ceiling here: the worker sets a cgroup memory
# limit per job, and a hard -Xmx baked into the image would silently override
# whatever an Architect configured for their assessment.
ENV JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 \
    HOME=/tmp \
    JAVA_TOOL_OPTIONS="-Djava.awt.headless=true -Dfile.encoding=UTF-8"

COPY --from=jdk /opt/runtime /opt/java/openjdk

# The JUnit Platform console launcher runs Architect-authored JUnit Jupiter
# scripts. Pinned by checksum and baked in: there is no network at execution
# time, and a jar that changed upstream must fail the build, not a grading run.
ADD --checksum=sha256:e62b96ac475dbcde8599ea905d088f65d90778f86e259b856a49fa5c4ea256ec \
    https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/6.1.3/junit-platform-console-standalone-6.1.3.jar \
    /opt/junit/junit-platform-console-standalone.jar
RUN chmod 0444 /opt/junit/junit-platform-console-standalone.jar

COPY docker/sandbox/base/harden.sh /tmp/harden.sh
RUN sh /tmp/harden.sh && rm -f /tmp/harden.sh

WORKDIR /workspace
USER 65534:65534

# No ENTRYPOINT and no meaningful CMD. The worker supplies an explicit argument
# vector for every execution; participant source code is never interpolated
# into a shell string, so there is nothing here for a shell to re-parse.
CMD ["java", "--version"]

LABEL ambatucode.sandbox="1" \
      ambatucode.language="java"
