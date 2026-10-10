"""Offline safety tests: no API key, screenshots or external call required."""
import base64
import pytest
from pydantic import ValidationError
from app.copilot_vision import VisionRequest, Target, ModelResult

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
