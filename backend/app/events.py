"""In-process change feed that pushes "something changed" notices to connected consoles.

Writes happen on worker threads (FastAPI runs sync endpoints and the agent graph in a thread pool),
while subscribers are asyncio queues read by the SSE endpoint, so publishing hops onto each
subscriber's event loop with ``call_soon_threadsafe``.

Events carry only a *topic* (tickets, messages, conversations, actions, …), never record contents:
clients refetch through the normal authenticated endpoints, so the stream can't leak data a
client isn't allowed to read, and a dropped event only delays a refresh.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import AsyncIterator

# DB table -> topic the console subscribes to. Unlisted tables (webhook deliveries, order_state, …) aren't broadcast.
TOPICS = {
    "tickets": "tickets",
    "messages": "messages",
    "conversations": "conversations",
    "actions": "actions",
    "macros": "macros",
    "webhooks": "webhooks",
    "webhook_deliveries": "webhooks",
    "webhook_outbox": "webhooks",
    "audit_log": "audit",
    "workspace_settings": "settings",
    "users": "users",
    "kb": "kb",
    "eval_scenarios": "evals",
    "eval_runs": "evals",
}

_subscribers: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue[str]]] = set()
_lock = threading.Lock()


def publish(table: str) -> None:
    """Announce a change to ``table``. Safe to call from any thread; never blocks or raises."""
    topic = TOPICS.get(table)
    if not topic:
        return
    with _lock:
        targets = list(_subscribers)
    for loop, queue in targets:
        try:
            loop.call_soon_threadsafe(_offer, queue, topic)
        except RuntimeError:  # loop already closed; the subscriber is going away
            pass


def _offer(queue: asyncio.Queue[str], topic: str) -> None:
    # A stalled client shouldn't grow memory without bound; it will refetch everything on reconnect anyway.
    if not queue.full():
        queue.put_nowait(topic)


async def subscribe(batch_window: float = 0.25, keepalive: float = 15.0) -> AsyncIterator[set[str] | None]:
    """Yield sets of changed topics, coalescing bursts (one chat turn writes several tables).

    Yields ``None`` after ``keepalive`` seconds of silence so the caller can send a heartbeat.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=1000)
    entry = (loop, queue)
    with _lock:
        _subscribers.add(entry)
    try:
        while True:
            try:
                first = await asyncio.wait_for(queue.get(), timeout=keepalive)
            except TimeoutError:
                yield None
                continue
            topics = {first}
            await asyncio.sleep(batch_window)
            while not queue.empty():
                topics.add(queue.get_nowait())
            yield topics
    finally:
        with _lock:
            _subscribers.discard(entry)


def subscriber_count() -> int:
    with _lock:
        return len(_subscribers)
