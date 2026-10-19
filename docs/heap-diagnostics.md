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
