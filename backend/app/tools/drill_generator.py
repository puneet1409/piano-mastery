import json
from typing import Dict, Any
from pathlib import Path

# Load drill playbook
PLAYBOOK_PATH = Path(__file__).parent.parent.parent / "data" / "drill_playbook.json"
with open(PLAYBOOK_PATH) as f:
    DRILL_PLAYBOOK = json.load(f)

def generate_drill(drill_id: str, parameters: Dict[str, Any]) -> Dict:
    """Generate drill configuration from playbook template."""

    if drill_id not in DRILL_PLAYBOOK["drills"]:
        raise ValueError(f"Unknown drill ID: {drill_id}")

    template = DRILL_PLAYBOOK["drills"][drill_id]

    # Apply parameter defaults
    drill_params = {}
    for param_name, param_config in template["parameters"].items():
        if param_name in parameters:
            drill_params[param_name] = parameters[param_name]
        elif "default" in param_config:
            drill_params[param_name] = param_config["default"]
        elif param_config.get("required"):
            raise ValueError(f"Missing required parameter: {param_name}")

    # Calculate final tempo
    tempo_reduction = drill_params.get("tempo_reduction", 0)
    final_tempo = template["base_tempo"] - tempo_reduction

    # Build drill configuration
    drill = {
        "drill_id": drill_id,
        "name": template["name"],
        "description": template["description"],
        "tempo": final_tempo,
        "pattern": template["pattern"],
        "parameters": drill_params,
        "success_criteria": template["success_criteria"],
        "visual_aids": template.get("visual_aids", {}),
        "instructions": f"{template['description']}. Tempo: {final_tempo} BPM."
    }

    return drill

def validate_drill_success(
    drill: Dict,
    attempts: list[Dict]
) -> tuple[bool, str]:
    """Check if drill success criteria are met."""

    criteria = drill["success_criteria"]
    required_attempts = criteria["attempts_required"]
    consecutive = criteria.get("consecutive", False)

    if len(attempts) < required_attempts:
        return False, f"Need {required_attempts - len(attempts)} more successful attempts"

    # Check timing deviation
    if "timing_deviation" in criteria:
        max_deviation = int(criteria["timing_deviation"].replace("<", "").replace("ms", ""))

        valid_attempts = []
        for attempt in attempts:
            avg_deviation = sum(abs(t) for t in attempt.get("timing", [])) / len(attempt.get("timing", [1]))
            if avg_deviation < max_deviation:
                valid_attempts.append(attempt)

        if consecutive:
            # Check if last N attempts were all successful
            if len(valid_attempts) >= required_attempts and valid_attempts[-required_attempts:] == attempts[-required_attempts:]:
                return True, "Drill mastered! Well done."
            else:
                return False, f"Good progress. Keep going!"
        else:
            # Just need N successful attempts total
            if len(valid_attempts) >= required_attempts:
                return True, "Drill mastered!"

    return False, "Keep practicing"
