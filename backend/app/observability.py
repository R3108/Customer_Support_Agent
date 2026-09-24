"""Request context, structured logging, Prometheus metrics and HTTP hardening.

Every request gets a request ID (the caller's ``X-Request-ID`` when it looks sane, otherwise a fresh one),
echoed in the response and attached to every log line, so one ID ties together the access log, agent logs,
webhook deliveries and audit entries of a single request.

Metrics are a small dependency-free Prometheus registry exposed at ``GET /metrics``.
"""

from __future__ import annotations

import contextvars
import json
import logging
import re
import secrets
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .config import get_settings

log = logging.getLogger("relay.http")


# ---------------------------------------------------------------- request context
@dataclass
class RequestContext:
    """Per-request facts shared with code that has no access to the Request (audit log, logging).

    The object is mutable on purpose: FastAPI runs sync dependencies and endpoints in *copies* of the context,
    so a dependency can't set a new context variable the endpoint would see, but it can fill in this object.
    """

    request_id: str
    ip: str | None = None
    method: str | None = None
    path: str | None = None
    actor: str | None = None  # filled in once the caller is authenticated (deps.current_principal)
    actor_kind: str | None = None


_ctx: contextvars.ContextVar[RequestContext | None] = contextvars.ContextVar("relay_request", default=None)
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


def current() -> RequestContext | None:
    return _ctx.get()


def new_request_id() -> str:
    return f"req_{secrets.token_hex(8)}"


def client_ip(peer: str | None, forwarded_for: str | None) -> str | None:
    """The caller's IP. X-Forwarded-For is only trusted when explicitly enabled (it's trivially spoofable otherwise)."""
    if forwarded_for and get_settings().trust_proxy_headers:
        return forwarded_for.split(",")[0].strip() or peer
    return peer


# ---------------------------------------------------------------- logging
class _ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        ctx = _ctx.get()
        record.request_id = ctx.request_id if ctx else "-"
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line, for log pipelines (Loki, CloudWatch, Datadog…)."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
        }
        if http := getattr(record, "http", None):
            payload["http"] = http
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.addFilter(_ContextFilter())
    if get_settings().log_format.lower() == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s [%(request_id)s]: %(message)s"))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)


# ---------------------------------------------------------------- metrics
def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _labels(names: tuple[str, ...], values: tuple[str, ...], extra: str = "") -> str:
    parts = [f'{n}="{_escape(v)}"' for n, v in zip(names, values)]
    if extra:
        parts.append(extra)
    return "{" + ",".join(parts) + "}" if parts else ""


class _Metric:
    kind = ""

    def __init__(self, name: str, help_text: str, labels: Iterable[str] = ()):
        self.name, self.help, self.label_names = name, help_text, tuple(labels)
        self._lock = threading.Lock()
        REGISTRY.append(self)

    def _key(self, labels: dict[str, Any]) -> tuple[str, ...]:
        return tuple(str(labels.get(n, "")) for n in self.label_names)

    def samples(self) -> list[str]:
        raise NotImplementedError

    def render(self) -> str:
        return "\n".join([f"# HELP {self.name} {self.help}", f"# TYPE {self.name} {self.kind}", *self.samples()])


class Counter(_Metric):
    kind = "counter"

    def __init__(self, name: str, help_text: str, labels: Iterable[str] = ()):
        super().__init__(name, help_text, labels)
        self._values: dict[tuple[str, ...], float] = {}

    def inc(self, amount: float = 1.0, **labels: Any) -> None:
        key = self._key(labels)
        with self._lock:
            self._values[key] = self._values.get(key, 0.0) + amount

    def value(self, **labels: Any) -> float:
        with self._lock:
            return self._values.get(self._key(labels), 0.0)

    def samples(self) -> list[str]:
        with self._lock:
            return [f"{self.name}{_labels(self.label_names, k)} {v:g}" for k, v in sorted(self._values.items())]


class Gauge(_Metric):
    """A gauge set directly, or computed at scrape time from ``fn`` (returning {label tuple: value})."""

    kind = "gauge"

    def __init__(self, name: str, help_text: str, labels: Iterable[str] = (),
                 fn: Callable[[], dict[tuple[str, ...], float]] | None = None):
        super().__init__(name, help_text, labels)
        self._values: dict[tuple[str, ...], float] = {}
        self._fn = fn

    def set(self, value: float, **labels: Any) -> None:
        with self._lock:
            self._values[self._key(labels)] = value

    def samples(self) -> list[str]:
        if self._fn:
            try:
                values = self._fn()
            except Exception:  # noqa: BLE001 - a failing probe must not break the whole scrape
                return []
        else:
            with self._lock:
                values = dict(self._values)
        return [f"{self.name}{_labels(self.label_names, k)} {v:g}" for k, v in sorted(values.items())]


class Histogram(_Metric):
    kind = "histogram"

    def __init__(self, name: str, help_text: str, labels: Iterable[str] = (), buckets: Iterable[float] = ()):
        super().__init__(name, help_text, labels)
        self.buckets = tuple(sorted(buckets))
        self._counts: dict[tuple[str, ...], list[int]] = {}
        self._sums: dict[tuple[str, ...], float] = {}

    def observe(self, value: float, **labels: Any) -> None:
        key = self._key(labels)
        with self._lock:
            counts = self._counts.setdefault(key, [0] * (len(self.buckets) + 1))
            for i, bound in enumerate(self.buckets):
                if value <= bound:
                    counts[i] += 1
            counts[-1] += 1  # +Inf
            self._sums[key] = self._sums.get(key, 0.0) + value

    def samples(self) -> list[str]:
        lines: list[str] = []
        with self._lock:
            for key, counts in sorted(self._counts.items()):
                for bound, count in zip((*self.buckets, float("inf")), counts):
                    le = "+Inf" if bound == float("inf") else f"{bound:g}"
                    le_label = f'le="{le}"'
                    lines.append(f"{self.name}_bucket{_labels(self.label_names, key, le_label)} {count}")
                lines.append(f"{self.name}_sum{_labels(self.label_names, key)} {self._sums[key]:g}")
                lines.append(f"{self.name}_count{_labels(self.label_names, key)} {counts[-1]}")
        return lines


REGISTRY: list[_Metric] = []

LATENCY_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30)
HTTP_REQUESTS = Counter("relay_http_requests_total", "HTTP requests by route template and status.", ("method", "route", "status"))
HTTP_LATENCY = Histogram("relay_http_request_duration_seconds", "Time to first response byte.", ("method", "route"), LATENCY_BUCKETS)
AGENT_NODE_LATENCY = Histogram("relay_agent_node_duration_seconds", "Time spent in each LangGraph agent node.", ("node",), LATENCY_BUCKETS)
CHAT_TURNS = Counter("relay_chat_turns_total", "Customer turns by outcome.", ("outcome",))
LLM_CALLS = Counter("relay_llm_calls_total", "Structured LLM calls by outcome.", ("outcome",))
LLM_TOKENS = Counter("relay_llm_tokens_total", "LLM tokens consumed.", ("direction",))
WEBHOOK_ATTEMPTS = Counter("relay_webhook_attempts_total", "Webhook delivery attempts by result.", ("result",))
PII_REDACTIONS = Counter("relay_pii_redactions_total", "Sensitive values masked in customer messages.", ("kind",))
_STARTED = time.time()


def render_metrics() -> str:
    return "\n".join(m.render() for m in REGISTRY) + "\n"


def uptime_seconds() -> float:
    return round(time.time() - _STARTED, 1)


# ---------------------------------------------------------------- middleware
def _route_template(scope: dict[str, Any]) -> str:
    route = scope.get("route")
    return getattr(route, "path", None) or "unmatched"  # never the raw path: unbounded label cardinality


def _security_headers(scope: dict[str, Any], existing: set[bytes]) -> list[tuple[bytes, bytes]]:
    headers = [
        (b"x-content-type-options", b"nosniff"),
        (b"referrer-policy", b"no-referrer"),
        (b"x-frame-options", b"DENY"),
    ]
    if scope["path"].startswith(("/api/admin", "/api/auth")):
        headers.append((b"cache-control", b"no-store"))  # console data must not sit in shared or browser caches
    if get_settings().hsts_enabled:
        headers.append((b"strict-transport-security", b"max-age=31536000; includeSubDomains"))
    return [(k, v) for k, v in headers if k not in existing]


class ObservabilityMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware) so it doesn't buffer SSE streams and context variables flow to handlers."""

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        supplied = headers.get("x-request-id", "")
        ctx = RequestContext(
            request_id=supplied if _REQUEST_ID.match(supplied) else new_request_id(),
            ip=client_ip((scope.get("client") or (None,))[0], headers.get("x-forwarded-for")),
            method=scope["method"],
            path=scope["path"],
        )
        token = _ctx.set(ctx)
        started = time.perf_counter()
        responded = False

        def record(status: int) -> None:
            elapsed = time.perf_counter() - started
            route = _route_template(scope)
            HTTP_REQUESTS.inc(method=ctx.method, route=route, status=str(status))
            HTTP_LATENCY.observe(elapsed, method=ctx.method, route=route)
            if route not in ("/metrics", "/api/health/live", "/api/health/ready"):  # probes would drown the log
                log.info("%s %s %s %.0fms", ctx.method, ctx.path, status, elapsed * 1000,
                         extra={"http": {"method": ctx.method, "path": ctx.path, "route": route, "status": status,
                                         "duration_ms": round(elapsed * 1000, 1), "ip": ctx.ip, "actor": ctx.actor}})

        async def send_wrapper(message: dict[str, Any]) -> None:
            nonlocal responded
            if message["type"] == "http.response.start" and not responded:
                responded = True
                raw = list(message.get("headers", []))
                present = {k.lower() for k, _ in raw}
                raw.append((b"x-request-id", ctx.request_id.encode()))
                message["headers"] = raw + _security_headers(scope, present)
                record(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            if not responded:
                record(500)
            raise
        finally:
            _ctx.reset(token)
