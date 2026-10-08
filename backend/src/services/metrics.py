"""Small dependency-free process metrics for health checks and alert scraping."""
from collections import defaultdict
from threading import Lock

_lock = Lock()
_requests = defaultdict(int)
_latency_ms = defaultdict(float)


def observe_request(method: str, path: str, status: int, duration_ms: float) -> None:
    # Keep labels bounded: never expose user IDs or arbitrary query strings.
    key = (method, path.split("?", 1)[0], str(status // 100))
    with _lock:
        _requests[key] += 1
        _latency_ms[key] += duration_ms


def prometheus_text() -> str:
    lines = [
        "# TYPE autodeskai_http_requests_total counter",
        "# TYPE autodeskai_http_request_duration_ms_total counter",
    ]
    with _lock:
        for (method, path, family), count in sorted(_requests.items()):
            labels = f'method="{method}",path="{path}",status_family="{family}xx"'
            lines.append(f"autodeskai_http_requests_total{{{labels}}} {count}")
            lines.append(f"autodeskai_http_request_duration_ms_total{{{labels}}} {_latency_ms[(method, path, family)]:.3f}")
    return "\n".join(lines) + "\n"
