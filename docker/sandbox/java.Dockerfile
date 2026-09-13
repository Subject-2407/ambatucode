# Java 21 sandbox.
#
# Built locally and never pulled at execution time — the platform has to run
# fully offline, and the worker resolves this image by tag and fails loudly if
# it is missing rather than reaching for a registry.
#
# Build context is the repository root:
#   docker compose -f docker/compose/sandbox.yml build
FROM eclipse-temurin:21-jdk-noble

# The job process runs as 65534:65534 with a read-only root filesystem, so
# every writable path it can reach is a tmpfs the worker mounts.
#
#   HOME        — the JVM writes hsperfdata and crash logs under it, and a
#                 read-only default home fails the launch outright.
#   JAVA_TOOL_OPTIONS — headless, because there is no display and an AWT
#                 initialisation would otherwise stall until it gave up. The
#                 file.encoding pin makes a Coder's UTF-8 output survive a
#                 container with no locale configured.
#
# The JVM is not given a heap ceiling here: the worker sets a cgroup memory
# limit per job, and a hard -Xmx baked into the image would silently override
# whatever an Architect configured for their assessment.
ENV HOME=/tmp \
    JAVA_TOOL_OPTIONS="-Djava.awt.headless=true -Dfile.encoding=UTF-8"

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
