"""Offline safety tests: no API key, screenshots or external call required."""
import base64
import pytest
from pydantic import ValidationError
from app.copilot_vision import VisionRequest, Target, ModelResult, confirmed_nol_step

def request(image):
    return VisionRequest(providerId="cityline", locale="ko", quantity=1,
                         currency="HKD", budgetMinor=100000,
                         imageBase64=base64.b64encode(image).decode())

def test_only_bounded_jpeg_is_accepted():
    assert len(request(bytes.fromhex("ffd8ff")+b"0"*120+bytes.fromhex("ffd9")).jpeg()) == 125
    with pytest.raises(ValueError):
        request(b"not a JPEG"*20).jpeg()
    with pytest.raises(ValidationError):
        VisionRequest(providerId="cityline", quantity=1, currency="HKD",
                      budgetMinor=100000, imageBase64="a"*2_100_001)

def test_no_sensitive_controls_can_be_returned():
    ok=Target(x=.4,y=.3,label="Section A",reason="Matches price",confidence=.91,kind="seat")
    assert ok.x == .4
    for label in ("PAY NOW","Login","CAPTCHA", "queue","결제 확인", "https://evil.com"):
        with pytest.raises(ValidationError):
            Target(x=.4,y=.3,label=label,reason="good",confidence=.9,kind="seat")
    with pytest.raises(ValidationError):
        Target(x=1.1,y=.3,label="Section A",reason="good",confidence=.9,kind="seat")
    assert ModelResult(status="uncertain",targets=[]).targets == []
    sample=bytes.fromhex("ffd8ff")+b"0"*120+bytes.fromhex("ffd9")
    assert request(sample).stage == "selecting"
    assert VisionRequest(providerId="nol",quantity=1,currency="KRW",budgetMinor=300000,
                         stage="preparing",imageBase64=base64.b64encode(sample).decode()).stage == "preparing"
    with pytest.raises(ValidationError):
        VisionRequest(providerId="nol",quantity=1,currency="KRW",budgetMinor=300000,
                      stage="checkout",imageBase64=base64.b64encode(sample).decode())


def test_nol_detailed_stage_metadata_is_strict_and_read_only():
    samples = {
        "event_detail": "event",
        "performance_date": "selecting",
        "seat_map": "selecting",
        "price_quantity": "selecting",
        "seat_conflict": "selecting",
        "sold_out": "selecting",
        "cart_review": "checkout",
    }
    for substep, stage in samples.items():
        response = ModelResult(status="candidates", targets=[],
                               screenStage=stage, stageConfidence=.99,
                               nolScreenStep=substep, nolStepConfidence=.99)
        assert confirmed_nol_step("nol", response) == (substep, .99)
        assert confirmed_nol_step("cityline", response) == ("unknown", 0)
        assert response.targets == []

    challenge = ModelResult(status="human_required", targets=[],
                            screenStage="unknown", stageConfidence=.99,
                            nolScreenStep="human_gate", nolStepConfidence=.99)
    assert confirmed_nol_step("nol", challenge) == ("human_gate", .99)


def test_nol_stage_mismatch_low_confidence_or_unknown_never_promotes_a_substep():
    for kw in [
        dict(screenStage="event", stageConfidence=.99,
             nolScreenStep="seat_map", nolStepConfidence=.99),
        dict(screenStage="selecting", stageConfidence=.96,
             nolScreenStep="seat_map", nolStepConfidence=.99),
        dict(screenStage="selecting", stageConfidence=.99,
             nolScreenStep="seat_map", nolStepConfidence=.96),
        dict(screenStage="selecting", stageConfidence=.99,
             nolScreenStep="unknown", nolStepConfidence=.99),
    ]:
        response = ModelResult(status="candidates", targets=[], **kw)
        assert confirmed_nol_step("nol", response) == ("unknown", 0)

    with pytest.raises(ValidationError):
        ModelResult(status="candidates", targets=[], nolScreenStep="fake")
    with pytest.raises(ValidationError):
        ModelResult(status="candidates", targets=[], nolStepConfidence=1.1)
