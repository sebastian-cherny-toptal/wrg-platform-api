# Heap diagnostics in Railway

Deploy this API revision to enable basic monitoring. No additional dependency,
public endpoint, or inspector port is required. Use LOG_LEVEL=info to see all
records (warn also shows pressure and large request growth warnings).

Production currently starts Node with `--max-old-space-size=3000` in both
Dockerfile and package.json. The monitor reports the actual V8 heap limit rather
than assuming that value. It does not change memory limits or restart behavior.

## Following memory usage

Filter Railway deploy logs by `heap_status`. A record is emitted at startup and
every 30 seconds, with a warning when heap use reaches 80% of the actual limit.
Each record includes instance hostname, PID, process uptime, and:

- `heapUsedMb`, `heapTotalMb`, `heapLimitMb`, `heapUsedPercent`: occupied heap,
  allocated heap capacity, limit, and percentage used.
- `rssMb`: resident memory of the whole process, for comparison with Railway.
- `externalMb`: memory associated with JavaScript objects outside the heap.
- `arrayBuffersMb`: array/buffer backing memory, already included in externalMb.
  Do not add these fields together.
- `heapDeltaMb`: change since the previous periodic reading.
- `spaces`: V8 space breakdown. Persistent growth in old_space or
  large_object_space after garbage collections warrants investigation.
- `gc.count`, `gc.durationMs`, `gc.longestPauseMs`: garbage collection events,
  total elapsed collection time, and longest event since the previous reading.
  Observer delivery is asynchronous; these are approximate interval statistics.
- `activeRequests` and `activeRequestSample`: count and up to ten active request
  IDs, methods, route templates, and ages. Metadata storage is capped at 100
  requests. Requests beyond that cap still contribute to the total count.

Existing `http request completed` records now have a `memory` object including
start/end heap readings and `heapDeltaMb`. Filter `heap_request_growth` for
requests during which heap increased by at least 50 MiB. Use the request ID to
find the existing HTTP record and its endpoint. Wildcard compatibility routes
appear as `*` in the monitor; the HTTP record includes the endpoint path.

Request deltas measure the **whole process during a request**, not allocations
owned by that request. Concurrent requests, background jobs, and GC all affect
these readings. Positive deltas are clues, not proof of a leak. Requests that
lose their response connection are removed from active tracking as well.

All memory fields ending in Mb are MiB (1024 * 1024 bytes), rounded to two decimals.
Compare records from the same instance and uptime before drawing conclusions.
Periodic logs may miss short allocation spikes or stop during event-loop stalls.

## Finding allocation locations

For a diagnostic deployment, set this Railway variable and redeploy:

```
HEAP_ALLOCATION_SAMPLING=true
```

Look for `heap_sampling_started`, then filter by `heap_allocations`. The in-process
V8 sampling profiler samples allocations at an average interval of 1 MiB and
logs the top 20 allocation call sites with up to five caller frames, source file
paths, line numbers, and estimated live memory. Paths refer to deployed JavaScript
(e.g. dist files), not necessarily original TypeScript lines.

Estimates describe sampled allocations still live since profiler startup; they
are not exact object counts, do not include allocations before startup or all
native/external memory, and do not identify which references retain an object.
Recent objects may remain until the next collection. Follow repeated profiles
while exercising the suspected report workflow and compare periods of inactivity.
If a site repeatedly grows, inspect that code's result sizes, caches, listeners,
and object lifetimes. Exact retaining paths require a separate heap-snapshot
investigation; this feature does not take full heap snapshots.

Profiling has overhead and materializes profile metadata. It is off by default;
turn it off after gathering evidence. Profile retrieval is skipped at or above
HEAP_MONITOR_WARN_PERCENT to avoid extra work near the heap limit. The basic
memory/GC logs continue. `heap_sampling_error` indicates profiling failed while
basic monitoring remains available. No object contents, request bodies, headers,
or query values are added by the monitor.

## Configuration

| Railway variable               | Default | Meaning                                           |
| ------------------------------ | ------- | ------------------------------------------------- |
| HEAP_MONITOR_ENABLED           | true    | Enable monitoring and request memory fields       |
| HEAP_MONITOR_INTERVAL_MS       | 30000   | Periodic log/profile interval, 1000–3600000 ms    |
| HEAP_MONITOR_WARN_PERCENT      | 80      | Heap warning and profile-skip threshold, 1–99     |
| HEAP_MONITOR_REQUEST_GROWTH_MB | 50      | Positive process heap change for request warnings |
| HEAP_ALLOCATION_SAMPLING       | false   | Opt into allocation-location estimates            |

For a first investigation, keep the defaults and enable allocation sampling.
Collect logs covering normal operation, report requests, and the quiet period
afterward. Check whether the post-GC baseline grows over repeated operations,
and whether allocation locations explain that growth before changing heap limits.

## PostgreSQL history and graphs

The API now saves a compact numeric sample at startup and every **30 seconds**,
independently of the configurable heap log interval. `HEAP_MONITOR_ENABLED=false`
also disables history collection. Sampling is automatic when monitoring is on;
`HEAP_ALLOCATION_SAMPLING` is not required for history.

The `ServerStat` table requires migration `20261019210000_server_stats`. Railway's
existing pre-deploy migration command applies it before the new API starts. For
other deployment methods, run `npm run db:deploy:production` first. Existing logs
are not backfilled; history begins with this deployment.

Only numeric memory/GC/request-count readings are stored. Allocation stacks and
request data remain in logs. Each process gets a unique `processStartId`, recorded
in the `server_stats_started` log alongside its hostname and start timestamp.
This distinguishes restarts even when the hostname and PID are reused.

### Querying history

Use an administrator or super-administrator bearer access token:

```bash
curl --get "$API_BASE_URL/admin/serverStats" \
  --header "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  --data-urlencode 'timeStart=2026-10-19T14:00:00Z' \
  --data-urlencode 'timeEnd=2026-10-19T19:00:00Z' \
  --data-urlencode 'interval=1m'
```

- `timeStart` is inclusive; `timeEnd` is exclusive. Both accept ISO 8601 dates with
  a timezone (`Z` or an explicit offset). Use URL encoding for `+` offsets.
- The default range is the last hour. The maximum requested range is 30 days;
  samples older than the current retention cutoff are excluded even if cleanup
  has not deleted them yet.
- `interval` accepts `30s` (default), `1m`, `5m`, `15m`, or `1h`.
- Optional `instanceId` and `processStartId` filters isolate a replica or process.
- Results are capped at 10,000 points. Queries exceeding that return HTTP 400
  asking for a coarser interval, narrower range, or instance/process filter.
  Results are never silently truncated. Unknown or invalid parameters return 400.
- No token returns 401; an authenticated client account returns 403.

The JSON response contains query metadata, units, and a `points` array. Each point
is a UTC time bucket **for one process run**, with `capturedAt` (bucket start),
`instanceId`, `processStartId`, `processStartedAt`, and:

| Fields                                     | Meaning                                                |
| ------------------------------------------ | ------------------------------------------------------ |
| `sampleCount`                              | Number of persisted readings represented by this point |
| `uptimeSeconds`                            | Highest sampled process uptime in the bucket           |
| `heapUsedMbAvg`, `heapUsedMbMax`           | Average and highest sampled heap usage                 |
| `heapTotalMbMax`, `heapLimitMb`            | Highest allocated heap capacity and heap limit         |
| `heapUsedPercentAvg`, `heapUsedPercentMax` | Average and highest heap percentage                    |
| `rssMbAvg`, `rssMbMax`                     | Average and highest resident process memory            |
| `externalMbMax`, `arrayBuffersMbMax`       | Highest external and array/buffer readings             |
| `activeRequestsMax`                        | Highest sampled active request count                   |
| `gcCount`, `gcDurationMs`                  | Total GC events and elapsed GC time across readings    |
| `gcLongestPauseMs`                         | Longest observed GC event                              |

These peaks are maxima of 30-second **samples**, not continuous measurements.
A bucket's start can precede timeStart if the first included sample falls partway
through a bucket. GC measurements cover the interval before each sample; the first
sample covers only the time since monitoring began. Observer delivery is
asynchronous. GC elapsed time should not be interpreted as exact CPU time.

For graphs, plot capturedAt against heapUsedMbAvg and heapUsedMbMax with heapLimitMb
as the ceiling. Draw each processStartId as its own series so a restart does not
look like garbage collection. Missing samples remain gaps; they are not zeros.
For a 30-day graph, request `interval=15m` or `1h`.

### Retention and failure behavior

Successful writes delete up to 1,000 expired records per sample, with a **30-day**
cutoff. This bounds cleanup work and drains older backlogs gradually. Physical
cleanup pauses while the API is down or PostgreSQL is unavailable; the history
endpoint still excludes records outside retention when it is available again.

There is at most one sample transaction in flight per process and no retry queue.
Writes are best effort: slow or unavailable PostgreSQL produces
`server_stats_skipped` / `server_stats_write_failed` logs, and heap logs continue.
SQL statements have a five-second timeout; transactions also have acquisition and
execution timeouts. Queries have the same time bounds. The last sample before a
fatal crash may be missing. This history is diagnostic telemetry, not an uptime
monitor independent of the application.
