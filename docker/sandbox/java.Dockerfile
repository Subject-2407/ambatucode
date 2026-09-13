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
