import pytest
from app.tools.drill_generator import generate_drill

def test_generate_isolate_beat_drill():
    drill = generate_drill(
        drill_id="isolate_beat_4",
        parameters={"target_beat": 4, "tempo_reduction": 20}
    )

    assert drill["drill_id"] == "isolate_beat_4"
    assert drill["tempo"] == 30  # 50 - 20
    assert "beat 4" in drill["instructions"].lower()
    assert drill["success_criteria"]["attempts_required"] > 0

def test_generate_slow_tempo_drill():
    drill = generate_drill(
        drill_id="slow_tempo",
        parameters={"tempo_reduction": 30}
    )

    assert drill["tempo"] == 20  # 50 - 30
