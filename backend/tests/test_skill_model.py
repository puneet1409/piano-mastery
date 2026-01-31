import pytest
from app.models.skill import Skill, MasteryLevel

def test_skill_creation():
    skill = Skill(
        skill_id="K0.1",
        name="Find Middle C",
        level=0,
        prerequisites=[],
        encompasses={},
        test_criteria={
            "notes": ["C4"],
            "tempo": 60,
            "bars": 1,
            "success_threshold": {
                "proficient": {
                    "pitch_accuracy": ">70%",
                    "consecutive_attempts": 3
                }
            }
        }
    )

    assert skill.skill_id == "K0.1"
    assert skill.mastery_status == MasteryLevel.NOT_STARTED
    assert skill.fluency == 0

def test_skill_encompasses_calculation():
    skill = Skill(
        skill_id="L3.2",
        name="G Bass + Chord on 1 and 4",
        level=3,
        prerequisites=["L3.1", "R2.3"],
        encompasses={"L3.1": 0.8, "R2.3": 0.6},
        test_criteria={
            "notes": ["G2", "C3", "E3", "G3"],
            "tempo": 80,
            "bars": 2,
            "success_threshold": {
                "proficient": {
                    "pitch_accuracy": ">70%",
                    "consecutive_attempts": 3
                }
            }
        }
    )

    credit = skill.get_encompassing_credit("L3.1")
    assert credit == 0.8
