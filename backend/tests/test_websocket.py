import pytest
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocket
from app.api.websocket import websocket_endpoint

@pytest.mark.asyncio
async def test_websocket_connection():
    # This will be tested with TestClient once implemented
    pass

def test_audio_event_schema():
    from app.api.websocket import AudioEvent

    event = AudioEvent(
        type="audio_chunk",
        data={"samples": [0.1, 0.2, -0.1], "sample_rate": 44100},
        timestamp="2026-01-24T10:00:00Z"
    )

    assert event.type == "audio_chunk"
    assert event.data["sample_rate"] == 44100
