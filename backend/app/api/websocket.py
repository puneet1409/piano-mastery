from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List
from pydantic import BaseModel
from datetime import datetime
import json
import base64
from app.tools.pitch_detection import analyze_audio_chunk
from app.agents.session_manager import get_session, create_session, end_session

class AudioEvent(BaseModel):
    type: str  # "audio_chunk", "note_detected", "analysis_complete"
    data: Dict
    timestamp: str

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[session_id] = websocket

    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]

    async def send_event(self, session_id: str, event: AudioEvent):
        if session_id in self.active_connections:
            ws = self.active_connections[session_id]
            await ws.send_json(event.dict())

    async def broadcast(self, event: AudioEvent):
        for connection in self.active_connections.values():
            await connection.send_json(event.dict())

manager = ConnectionManager()

async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time audio streaming and agent decisions."""
    await manager.connect(session_id, websocket)

    # Create or get practice session
    # TODO: Get student_id and goal_skill_id from authentication/request
    student_id = "test_student_001"
    goal_skill_id = "c_major_chord"

    practice_session = get_session(session_id)
    if not practice_session:
        practice_session = create_session(session_id, student_id, goal_skill_id)

        # Send session start confirmation
        start_event = AudioEvent(
            type="session_started",
            data={
                "session_id": session_id,
                "goal_skill": goal_skill_id,
                "message": "Practice session started!"
            },
            timestamp=datetime.utcnow().isoformat() + "Z"
        )
        await manager.send_event(session_id, start_event)

    try:
        while True:
            data = await websocket.receive_json()
            event = AudioEvent(**data)

            # Handle different event types
            if event.type == "audio_chunk":
                # Process audio chunk for pitch detection
                audio_data_b64 = event.data.get("audio")
                sample_rate = event.data.get("sample_rate", 44100)
                # Score-aware: client can send expected notes for better accuracy
                expected_notes = event.data.get("expected_notes")

                if audio_data_b64:
                    # Decode base64 audio data
                    audio_bytes = base64.b64decode(audio_data_b64)

                    # Analyze pitch (uses ProductionDetector with YIN v3)
                    result = analyze_audio_chunk(
                        audio_data=audio_bytes,
                        sample_rate=sample_rate,
                        dtype='float32',
                        expected_notes=expected_notes
                    )

                    # Send note detection event if pitch detected
                    if result['detected']:
                        response = AudioEvent(
                            type="note_detected",
                            data={
                                "note": result['note'],
                                "frequency": result['frequency'],
                                "confidence": result['confidence'],
                                # Telemetry for tuning
                                "detector": result.get('detector'),
                                "latency_ms": result.get('latency_ms')
                            },
                            timestamp=datetime.utcnow().isoformat() + "Z"
                        )
                        await manager.send_event(session_id, response)
                else:
                    # Send error response
                    response = AudioEvent(
                        type="error",
                        data={"message": "No audio data provided"},
                        timestamp=datetime.utcnow().isoformat() + "Z"
                    )
                    await manager.send_event(session_id, response)

            elif event.type == "attempt_complete":
                # Student finished an attempt, analyze and get agent decision
                audio_analysis = event.data

                # Process attempt through session manager and get agent decision
                decision = await practice_session.process_attempt(audio_analysis)

                # Send agent decision to frontend
                decision_event = AudioEvent(
                    type="agent_decision",
                    data=decision,
                    timestamp=datetime.utcnow().isoformat() + "Z"
                )
                await manager.send_event(session_id, decision_event)

            elif event.type == "get_session_summary":
                # Client requesting session summary
                summary = practice_session.get_session_summary()
                summary_event = AudioEvent(
                    type="session_summary",
                    data=summary,
                    timestamp=datetime.utcnow().isoformat() + "Z"
                )
                await manager.send_event(session_id, summary_event)

            else:
                # Echo back for other event types
                response = AudioEvent(
                    type="event_received",
                    data={"status": "processing", "original_type": event.type},
                    timestamp=datetime.utcnow().isoformat() + "Z"
                )
                await manager.send_event(session_id, response)

    except WebSocketDisconnect:
        # Clean up session on disconnect
        end_session(session_id)
        manager.disconnect(session_id)
