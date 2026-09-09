# Python 3.12 sandbox.
#
# Built locally and never pulled at execution time — the platform has to run
# fully offline, and the worker resolves this image by tag and fails loudly if
# it is missing rather than reaching for a registry.
#
# Build context is the repository root:
#   docker compose -f docker/compose/sandbox.yml build
FROM python:3.12-slim

# The job process runs as 65534:65534 with a read-only root filesystem, so
# every writable path it can reach is the /tmp tmpfs the worker mounts.
#   HOME                    — Python and its libraries expect a writable home.
#   PYTHONDONTWRITEBYTECODE — __pycache__ writes would fail on the read-only root.
#   PYTHONUNBUFFERED        — output is captured up to a cap and the process may
#                             be killed at a limit; buffered output would be lost.
ENV HOME=/tmp \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY docker/sandbox/base/harden.sh /tmp/harden.sh
RUN sh /tmp/harden.sh && rm -f /tmp/harden.sh

WORKDIR /workspace
USER 65534:65534

# No ENTRYPOINT and no meaningful CMD. The worker supplies an explicit argument
# vector for every execution; participant source code is never interpolated
# into a shell string, so there is nothing here for a shell to re-parse.
CMD ["python3", "--version"]

LABEL ambatucode.sandbox="1" \
      ambatucode.language="python"
