import hmac
import os
from typing import Annotated
from fastapi import Header, HTTPException

def admin_required(x_admin_key: Annotated[str | None, Header()] = None):
    expected = os.getenv("TIXBAM_ADMIN_API_KEY", "")
    if not expected or not x_admin_key or not hmac.compare_digest(x_admin_key, expected):
        raise HTTPException(status_code=401, detail="Administrator API key required")
