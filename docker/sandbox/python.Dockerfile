# Python 3.12 sandbox.
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
#
# The official slim image is kept rather than rebuilt from parts. It is already
# small, and it carries the shared libraries CPython's standard modules link
# against — ssl, sqlite3, ctypes — which a hand-assembled image would have to
# rediscover one import failure at a time.
FROM python:3.12.14-slim-trixie@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea

# The job process runs as 65534:65534 with a read-only root filesystem, so
# every writable path it can reach is the /tmp tmpfs the worker mounts.
#   HOME                    — Python and its libraries expect a writable home.
#   PYTHONDONTWRITEBYTECODE — __pycache__ writes would fail on the read-only root.
#   PYTHONUNBUFFERED        — output is captured up to a cap and the process may
#                             be killed at a limit; buffered output would be lost.
ENV HOME=/tmp \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# The test framework for Architect-authored pytest scripts, pinned and baked in:
# there is no network at execution time to install it then. It goes in before
# the hardening step, which removes pip.
RUN pip install --no-cache-dir pytest==9.1.1

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
