package observability

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics is the worker's Prometheus instrumentation.
//
// Every method is safe on a nil *Metrics, so packages that record a metric do
// not need a registry in their unit tests — a nil receiver records nothing.
//
// Labels are limited to values the worker defines itself: job kind, status,
// language, and queue name. A job id or anything from a payload would give
// each submission its own time series, and cardinality that grows with
// participants is how a metrics endpoint takes a worker down.
type Metrics struct {
	registry *prometheus.Registry

	jobsProcessed           *prometheus.CounterVec
	jobDuration             *prometheus.HistogramVec
	containersActive        prometheus.Gauge
	queueWait               *prometheus.HistogramVec
	containerCreateFailures prometheus.Counter
	resultDeliveryFailures  *prometheus.CounterVec
	claimingPaused          prometheus.Gauge
}

func NewMetrics() *Metrics {
	m := &Metrics{
		registry: prometheus.NewRegistry(),
		jobsProcessed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "jobs_processed_total",
			Help: "Jobs executed to a result, by job kind and reported status.",
		}, []string{"kind", "status"}),
		jobDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name: "job_duration_seconds",
			Help: "Time from starting a job to having its result, excluding delivery.",
			// A Python run finishes in well under a second; a Java submission with
			// many cases and a script can take most of its wall clock.
			Buckets: []float64{0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30, 60, 120},
		}, []string{"kind", "language"}),
		containersActive: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "containers_active",
			Help: "Sandbox containers this worker has created and not yet removed.",
		}),
		queueWait: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name: "queue_wait_seconds",
			Help: "Time a job spent claimable before this worker claimed it.",
			// Waits stretch into minutes exactly when it matters: a burst of
			// submissions queueing behind a saturated pool.
			Buckets: []float64{0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600},
		}, []string{"queue"}),
		containerCreateFailures: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "container_create_failures_total",
			Help: "Sandbox containers the Docker daemon failed to create or start.",
		}),
		resultDeliveryFailures: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "result_delivery_failures_total",
			Help: "Delivery rounds to the LMS that failed after their quick retries. A submission's result is held and retried; a run's is dropped.",
		}, []string{"kind"}),
		claimingPaused: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "claiming_paused",
			Help: "1 while the worker claims no jobs because they cannot run, such as with the Docker daemon unreachable.",
		}),
	}

	m.registry.MustRegister(
		m.jobsProcessed,
		m.jobDuration,
		m.containersActive,
		m.queueWait,
		m.containerCreateFailures,
		m.resultDeliveryFailures,
		m.claimingPaused,
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)
	return m
}

// Handler serves the registry in the Prometheus exposition format.
func (m *Metrics) Handler() http.Handler {
	if m == nil {
		return http.NotFoundHandler()
	}
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

// JobProcessed records a job that ran to a reportable result.
func (m *Metrics) JobProcessed(kind, language, status string, duration time.Duration) {
	if m == nil {
		return
	}
	m.jobsProcessed.WithLabelValues(kind, status).Inc()
	m.jobDuration.WithLabelValues(kind, language).Observe(duration.Seconds())
}

// JobRejected records a job that never ran — an unparseable payload or one the
// stalled check gave up on — and was closed out as a system error.
func (m *Metrics) JobRejected(kind, status string) {
	if m == nil {
		return
	}
	m.jobsProcessed.WithLabelValues(kind, status).Inc()
}

func (m *Metrics) ContainerOpened() {
	if m == nil {
		return
	}
	m.containersActive.Inc()
}

func (m *Metrics) ContainerClosed() {
	if m == nil {
		return
	}
	m.containersActive.Dec()
}

func (m *Metrics) ContainerCreateFailed() {
	if m == nil {
		return
	}
	m.containerCreateFailures.Inc()
}

// QueueWait records how long a claimed job had been claimable.
func (m *Metrics) QueueWait(queue string, wait time.Duration) {
	if m == nil || wait < 0 {
		return
	}
	m.queueWait.WithLabelValues(queue).Observe(wait.Seconds())
}

// ResultDeliveryFailed records a delivery round the LMS did not accept.
func (m *Metrics) ResultDeliveryFailed(kind string) {
	if m == nil {
		return
	}
	m.resultDeliveryFailures.WithLabelValues(kind).Inc()
}

// ClaimingPaused flags whether the pool has stopped claiming jobs.
func (m *Metrics) ClaimingPaused(paused bool) {
	if m == nil {
		return
	}
	if paused {
		m.claimingPaused.Set(1)
		return
	}
	m.claimingPaused.Set(0)
}
