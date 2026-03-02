from fastapi import Request, HTTPException
import jwt
import os

SECRET = os.getenv("JWT_SECRET", "supersecret")

def get_current_user(request: Request):
    token = request.headers.get("Authorization")

    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        token = token.replace("Bearer ", "")
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
        return payload
    except:
        raise HTTPException(status_code=401, detail="Invalid token")
