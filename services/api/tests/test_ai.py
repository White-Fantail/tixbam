import json
import pytest
from pydantic import ValidationError
from app.ai import AdviceContext, AdviceOutput, PolicyInput, TASKS, policy_data


def test_policy_registry_is_stable_and_defaults_disabled():
    assert set(TASKS) == {"rehearsal_guidance", "page_recovery", "seat_review", "planner_v1", "copilot_vision"}
    for task in TASKS:
        data = policy_data(task, None)
        assert data["enabled"] is False
        assert data["model"]
    assert PolicyInput(model="openai/gpt-4.1-mini").timeout_seconds == 6
    with pytest.raises(ValidationError):
        PolicyInput(model="https://evil.example")
    with pytest.raises(ValidationError):
        PolicyInput(model="safe/model", timeout_seconds=99)


def test_context_is_strict_and_no_secrets_or_large_payload():
    okay = AdviceContext(stage="tickets", locale="en", signals={"stageIndex":3,"available":True})
    assert okay.locale == "en"
    for value in ["https://example.com/order", "someone@example.com",
                  "Bearer ABC", "my password is 123", "4111 1111 1111 1111"]:
        with pytest.raises(ValidationError):
            AdviceContext(stage="tickets", issue=value)
    with pytest.raises(ValidationError):
        AdviceContext(stage="tickets", signals={"cookie":"private value"})
    with pytest.raises(ValidationError):
        AdviceContext(stage="tickets", signals={"nested":{"secret":"no"}})
    with pytest.raises(ValidationError):
        AdviceContext(stage="tickets", signals={"long": "x"*101})


def test_output_never_accepts_execution_instructions():
    result = AdviceOutput.model_validate({
        "summary": "Review your budget", "tips": ["Keep the queue intact"],
        "risk": "caution", "next_step": "review"
    })
    assert result.next_step == "review"
    with pytest.raises(ValidationError):
        AdviceOutput.model_validate({
          "summary":"Click checkout", "tips":["x"], "risk":"info", "next_step":"click"
        })
