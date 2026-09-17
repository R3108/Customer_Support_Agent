import os
import tempfile
from pathlib import Path

import pytest

_tmp = Path(tempfile.mkdtemp(prefix="relay-tests-"))
os.environ["RELAY_LLM_PROVIDER"] = "offline"
os.environ["RELAY_DATABASE_PATH"] = str(_tmp / "relay.db")
os.environ["RELAY_CHECKPOINT_PATH"] = str(_tmp / "checkpoints.db")
os.environ["RELAY_ADMIN_API_KEY"] = ""
os.environ["RELAY_CHAT_RATE_LIMIT_PER_MINUTE"] = "1000"
os.environ["RELAY_WEBHOOK_ASYNC"] = "false"


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def chat(client):
    """Send messages within one conversation and return the assistant reply payloads."""

    class Conversation:
        def __init__(self, customer_id=None):
            self.customer_id = customer_id
            self.id = None

        def send(self, text):
            res = client.post("/api/chat", json={"message": text, "conversation_id": self.id, "customer_id": self.customer_id})
            assert res.status_code == 200, res.text
            body = res.json()
            self.id = body["conversation"]["id"]
            return body

    return Conversation
