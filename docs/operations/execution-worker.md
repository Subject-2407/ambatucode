# Execution worker operations

How to build, ship, run, monitor, and recover the Ambatucode execution worker
(`apps/worker`) and its sandbox images. Written for whoever deploys a lab.

The worker is the only part of Ambatucode that talks to Docker. It pulls jobs
from Redis, runs participant code in single-use sandbox containers, and posts
results back to the LMS. It holds no database credentials.

## 1. What a worker host needs

| Requirement | Why |
| --- | --- |
| Docker Engine with seccomp support (any current Linux Engine; Docker Desktop for development) | The worker refuses to start on a daemon that cannot enforce a seccomp profile. |
| cgroup v2 (strongly recommended) | Memory-limit verdicts are attributed to the exact test case from the cgroup's `memory.events`. On cgroup v1 the worker falls back to the daemon's sticky OOM flag and stops trusting later cases in a submission once one runs out of memory. |
| The four sandbox images loaded locally | The worker never pulls. A missing image stops it at startup. |
| Network access to Redis and to the LMS result endpoint | Jobs arrive from Redis; results leave over HTTP. |
| Its own Docker daemon | At startup the worker removes every container carrying its label. Two workers sharing one daemon would destroy each other's running containers. |

Treat the worker host as privileged. Access to the Docker socket is equivalent
to root on that host, which is why no other Ambatucode service is given it.

Redis must run with append-only persistence (`appendonly yes`, as
`docker/compose/dev.yml` does). Without it a Redis restart empties the queues
and every submission waiting in them is lost.

## 2. Building the sandbox images

Build on a machine with internet access, from the repository root:

```bash
docker compose -f docker/compose/sandbox.yml build
```

| Image | Base (pinned by digest) | Size |
| --- | --- | --- |
| `ambatucode/sandbox-python:3.12` | `python:3.12.14-slim-trixie` | 208 MB |
| `ambatucode/sandbox-javascript:22` | `node:22.23.2-bookworm-slim` for the build, `debian:12.15-slim` at runtime | 349 MB |
| `ambatucode/sandbox-java:21` | `eclipse-temurin:21.0.12_8-jdk-noble` for jlink, `debian:12.15-slim` at runtime | 292 MB |
| `ambatucode/sandbox-cpp:12` | `debian:12.15-slim` | 289 MB |

Every `FROM` line carries a tag and a digest. The digest is what is built; the
tag is for people. The JUnit launcher is pinned by checksum, and Jest and
pytest by exact version.

What was taken out, and why it is safe:

- **Java** ships a `jlink` runtime holding the Java SE modules, `javac`, and
  what the JUnit console launcher needs, with a class-data-sharing archive.
  JVM startup is unchanged from the full JDK (measured: 10 launches in 309 ms
  against 312 ms).
- **JavaScript** carries only the `node` binary and Jest. npm, corepack, and
  yarn are left in the build stage.
- **C++** drops the C compiler, the link-time optimisation tools, the sanitizer
  runtimes, and documentation other than licence files. The worker never
  passes `-flto` or `-fsanitize`.
- **Python** keeps the official slim image, which already carries the shared
  libraries the standard library links against.

Package manager state (`/var/lib/dpkg`) is kept in every image so vulnerability
scanners can still read what is installed.

### Updating a base image

1. Resolve the new version's digest:
   `docker buildx imagetools inspect python:3.12.15-slim-trixie`.
2. Change both the tag and the digest on the `FROM` line.
3. Rebuild, then run the worker's Docker test suite (section 8) before the
   images go anywhere near a lab.

## 3. Moving images to an offline lab

On the build machine:

```bash
docker save \
  ambatucode/sandbox-python:3.12 \
  ambatucode/sandbox-javascript:22 \
  ambatucode/sandbox-java:21 \
  ambatucode/sandbox-cpp:12 \
  -o ambatucode-sandbox-images.tar
```

The four images share their Debian base, so the archive is far smaller than
their sum (228 MB on Docker Engine 29). Export the monitoring images the same
way if the lab runs them; they are pinned in `docker/compose/monitoring.yml`.

On each worker host:

```bash
docker load -i ambatucode-sandbox-images.tar
docker image ls --filter 'reference=ambatucode/sandbox-*'
```

## 4. Building and running the worker

The worker is a single static Go binary. Cross-compile for the lab host:

```bash
cd apps/worker
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o ambatucode-worker ./cmd/worker
```

It reads configuration from its environment only. A systemd unit, as one way to
run it:

```ini
[Unit]
Description=Ambatucode execution worker
After=docker.service network-online.target
Requires=docker.service

[Service]
User=ambatucode-worker
Group=docker
EnvironmentFile=/etc/ambatucode/worker.env
ExecStart=/usr/local/bin/ambatucode-worker
Restart=always
RestartSec=5
# Longer than WORKER_SHUTDOWN_GRACE_MS plus the worker's own 75 s interrupt
# window and 30 s release window, so a stop never kills a job mid-report.
TimeoutStopSec=150
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

On `SIGTERM` the worker stops claiming, lets running jobs finish within the
grace period, hands unfinished jobs back to their queue, removes its
containers, and exits. A second `SIGINT` kills it immediately.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6379` | The queue's Redis. |
| `WORKER_QUEUE_PREFIX` | `bull` | BullMQ key prefix; must match the LMS. |
| `EXECUTION_CALLBACK_URL` | `http://localhost:3000/api/internal/execution/result` | The LMS result endpoint. |
| `WORKER_HEALTH_ADDR` | `:3002` | `/healthz` and `/metrics`. |
| `WORKER_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `WORKER_CONCURRENCY` | `min(2 × CPUs, 16)` | Goroutines claiming work. |
| `WORKER_MAX_CONTAINERS` | `WORKER_CONCURRENCY` | Concurrent sandbox containers. |
| `WORKER_SUBMIT_RESERVED_CONTAINERS` | a quarter of the containers, at least 1 | Slots practice runs may never take. |
| `WORKER_LOCK_DURATION_MS` | `30000` | How long a claimed job stays owned without renewal. |
| `WORKER_STALLED_INTERVAL_MS` | `30000` | How often jobs from a dead worker are recovered. |
| `WORKER_MAX_STALLED_COUNT` | `1` | Recoveries before a job is failed as poisonous. |
| `WORKER_SHUTDOWN_GRACE_MS` | `30000` | Time running jobs get on `SIGTERM`. |

`DOCKER_HOST` and the other standard Docker client variables are honoured.

### Sizing

Each container is limited to one CPU, so container slots beyond the host's
CPU count queue on the CPU rather than finishing sooner. Size memory for the
worst case: slots × the largest memory limit an Architect may set (up to
2 048 MB), plus the daemon.

Measured on a 16-CPU, 8 GB Docker VM with 16 slots and the default limits,
100 submissions of three cases each (40 Python, 25 JavaScript, 20 Java, 15 C++)
enqueued at once:

| | Result |
| --- | --- |
| One submission alone | Python 0.86 s, JavaScript 0.87 s, Java 1.94 s, C++ 1.28 s |
| Whole burst graded and delivered | 22–28 s (about 210–270 submissions a minute) |
| Enqueue to result | p50 12–16 s, p95 21–27 s |
| Failures, duplicate deliveries, leftover containers | none |

Container pooling is not used and must not be: every execution gets a fresh
container. Pre-warming was considered and not adopted — one submission,
including creating and removing its container, completes in under a second,
and under a burst the wait is for CPU, which pre-warming does not add.

## 5. Health and metrics

`GET /healthz` answers `200` when Docker and Redis both answer, and `503`
otherwise, with the detail in its JSON body. Saturation is reported but never
fails the check: a fully busy worker is healthy.

`GET /metrics` serves Prometheus metrics:

| Metric | What it tells you |
| --- | --- |
| `jobs_processed_total{kind,status}` | Jobs executed to a result. |
| `job_duration_seconds{kind,language}` | Time to a result, excluding delivery. |
| `queue_wait_seconds{queue}` | How long a job waited to be claimed. |
| `containers_active` | Containers created and not yet removed. |
| `container_create_failures_total` | Containers the daemon would not create or start. |
| `result_delivery_failures_total{kind}` | Delivery rounds the LMS did not accept. |
| `claiming_paused` | 1 while the worker claims nothing because jobs cannot run. |

The health port carries nothing about job content, but keep it on the worker's
own network, never on the network Coders' browsers use.

### Prometheus and Grafana

```bash
docker compose -f docker/compose/monitoring.yml up -d
```

Grafana is on `http://localhost:3003` (set `GRAFANA_ADMIN_USER` and
`GRAFANA_ADMIN_PASSWORD`; both default to `admin`) with the worker dashboard as
its home page. Prometheus is on `http://localhost:9090`. Both bind to
localhost. The scrape target is `host.docker.internal:3002`; add a target per
worker in `docker/monitoring/prometheus/prometheus.yml`.

| Alert | Meaning | What to do |
| --- | --- | --- |
| `WorkerDown` | `/metrics` has not answered for a minute. | Nothing is grading; submissions wait in Redis. Start the worker. |
| `ResultsNotDelivered` | The LMS is refusing or not answering. | The worker holds graded results and claims nothing new. Bring `apps/web` back within 30 minutes of the oldest submission. |
| `ClaimingPaused` | Jobs cannot run, almost always the daemon. | Check `systemctl status docker`. Grading resumes on its own. |
| `ContainerCreateFailures` | The daemon refuses to create containers. | Check daemon logs, disk space, and that the images are loaded. |
| `SubmissionsWaitingLong` | p95 wait for submissions above two minutes for five minutes. | The lab needs more worker capacity. |
| `ContainersNotReturningToZero` | Containers stay open while nothing runs. | A leak. Check the reaper's log lines and `docker ps -a --filter label=ambatucode.worker=1`. |

## 6. Sandbox security controls

Every container runs with no network, a read-only root filesystem, a non-root
user, all capabilities dropped, `no-new-privileges`, CPU, memory, process,
file-descriptor, and file-size limits, and a size-capped scratch mount. None
of these can be switched off by configuration.

Every container also runs under a seccomp profile built from Docker's own
default (embedded from `moby/profiles` v0.2.3) with syscalls removed, never
added:

- For every language: `ptrace`, `process_vm_readv`, `process_vm_writev`,
  `vmsplice`, `name_to_handle_at`, `memfd_secret`.
- For Python and C++ additionally: `memfd_create` and the protection-key calls
  (`pkey_alloc`, `pkey_free`, `pkey_mprotect`). JavaScript and Java keep them:
  their JIT runtimes use protection keys to guard their own code.

Removed syscalls return `ENOSYS`, so runtimes that probe for optional kernel
features fall back cleanly. A language's narrowing lives in its registry entry
(`apps/worker/internal/language/registry.go`).

## 7. When something fails

The worker is built so that no outage of a dependency loses a submission or
grades one as a platform failure. Each behaviour below is covered by an
automated check (section 8).

### The LMS is unreachable

Practice run results are dropped; the Coder presses Run again. A graded
submission's result is held and retried, backing off to every 30 seconds, until
the LMS accepts it or the job's callback token expires 30 minutes after it was
enqueued. While results are held their slots stay taken, so the worker stops
claiming new work, which waits in Redis.

Action: restore `apps/web`. Past 30 minutes, the LMS closes out the expired
submission as `SYSTEM_ERROR` and the Architect can reset the attempt.

### The Docker daemon is unreachable or restarts

A job that fails while the daemon does not answer is not reported. It returns
to its queue without spending an attempt, the worker stops claiming (the
`claiming_paused` metric reads 1, `/healthz` answers 503), and it probes the
daemon every two seconds. When the daemon answers, grading resumes. Containers
stopped by a restart are removed by the reaper once their deadline passes,
within about two minutes.

Runbook:

1. Leave the worker running. Do not restart it to "unstick" grading — it
   resumes by itself, and a restart while the daemon is down fails at startup.
2. Restart the daemon: `sudo systemctl restart docker`.
3. Confirm recovery: `curl -s localhost:3002/healthz` returns `"status":"ok"`,
   and `claiming_paused` returns to 0.
4. Within a few minutes, `docker ps -a --filter label=ambatucode.worker=1`
   should show only containers of jobs currently running.

An exec cut off by a restart often does not fail — its stream hangs until the
test case's deadline. The worker tells that apart from a program that ran out
of time: a genuine timeout always leaves a running container to kill, so a
kill that fails marks the job as interrupted by the outage, never as
`TIME_LIMIT_EXCEEDED`.

To verify this on a host before a lab relies on it, run the restart check
(section 8). It restarts the daemon, so run it when nothing else on that
daemon matters. It has passed against a full Docker Desktop restart, which
also took Redis down, with containers running mid-case.

### Redis restarts

The worker reconnects on its own. A job whose lock lapsed during the restart is
returned to its queue by the stalled check, which takes one to two minutes
with the default lock and interval, and graded again; if its result had already
been delivered, the LMS ignores the duplicate. In the automated check, a
restart with 17 of 20 submissions still in flight left every one graded within
about 90 seconds.
Without append-only persistence the queue itself would not survive, so check
that first if submissions vanished.

### The worker crashes or is killed

On restart it removes every container it left behind before claiming anything.
Jobs it was holding are recovered by the stalled check on any worker. A job
that keeps killing its worker is failed after `WORKER_MAX_STALLED_COUNT`
recoveries and reported as `SYSTEM_ERROR`, rather than taking every worker down
in turn.

### Reading the log

The worker logs JSON to stdout, one event per line, with `jobId`, `kind`,
`language`, `status`, and `durationMs` where they apply. It never logs source
code, test inputs, expected outputs, or callback tokens.

| Message | Meaning |
| --- | --- |
| `job executed` | A job ran to a result. |
| `LMS unreachable; holding the result and retrying` | Section 7, LMS. |
| `pausing job claims` / `resuming job claims` | Section 7, Docker. |
| `reaped a container that outlived its job` | A container a job could not remove itself. A steady stream is a leak. |
| `job failed permanently; no retries remain` | A submission no worker will try again. Needs an operator. |

## 8. Verification suites

Run from `apps/worker` with the dev dependencies and images in place:

```bash
docker compose -f docker/compose/dev.yml up -d
docker compose -f docker/compose/sandbox.yml build

go test ./...                                   # unit tests
go test -tags "docker redis" -p 1 ./...         # sandbox, threat cases, queue
go test -tags load  -timeout 30m -v ./e2e/      # 100 concurrent submissions
go test -tags chaos -timeout 30m -v ./e2e/      # LMS, Docker, Redis outages
CHAOS_DOCKER_RESTART_COMMAND="sudo systemctl restart docker" \
  go test -tags daemonrestart -timeout 30m -v ./e2e/   # real daemon restart
```

Stop any other worker on the same daemon first. The load and outage suites
start their own worker, whose startup sweep would remove another worker's
containers.

The load test's bound is derived rather than fixed: it measures one submission
per language alone, computes the best possible time for the burst across the
available slots, and fails if the burst takes more than three times that plus
30 seconds. `LOAD_SUBMISSIONS`, `LOAD_CONTAINERS`, and `LOAD_BOUND_FACTOR`
adjust it.
