from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

class MasteryLevel(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    PROFICIENT = "PROFICIENT"
    MASTERED = "MASTERED"

class TestCriteria(BaseModel):
    notes: List[str]
    timing_pattern: Optional[List[int]] = None
    tempo: int
    bars: int
    success_threshold: Dict[str, Dict[str, Any]]

class CommonError(BaseModel):
    type: str
    pattern: str
    drill: str
    parameters: Dict[str, Any]

class VisualAids(BaseModel):
    keyboard_highlight: List[str]
    sheet_music: Optional[str] = None
    reference_audio: Optional[str] = None

class Skill(BaseModel):
    skill_id: str
    name: str
    level: int
    prerequisites: List[str]
    encompasses: Dict[str, float]
    test_criteria: TestCriteria
    common_errors: List[CommonError] = []
    visual_aids: Optional[VisualAids] = None

    # Runtime state
    mastery_status: MasteryLevel = MasteryLevel.NOT_STARTED
    fluency: int = 0

    def get_encompassing_credit(self, prereq_skill_id: str) -> float:
        return self.encompasses.get(prereq_skill_id, 0.0)

    def is_unlocked(self, skill_statuses: Dict[str, MasteryLevel]) -> bool:
        for prereq_id in self.prerequisites:
            prereq_status = skill_statuses.get(prereq_id, MasteryLevel.NOT_STARTED)
            if prereq_status == MasteryLevel.NOT_STARTED:
                return False
        return True

    def update_mastery(self, new_fluency: int) -> MasteryLevel:
        self.fluency = max(0, min(100, new_fluency))
        if self.fluency >= 80:
            self.mastery_status = MasteryLevel.MASTERED
        elif self.fluency >= 50:
            self.mastery_status = MasteryLevel.PROFICIENT
        else:
            self.mastery_status = MasteryLevel.NOT_STARTED
        return self.mastery_status
