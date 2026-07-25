from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from src.auth.database import get_db
from src.auth.models import User
import os
from authlib.integrations.starlette_client import OAuth
from dotenv import load_dotenv

load_dotenv()

oauth_router = APIRouter()

# OAuth config
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
# Use unified redirect env var name
GOOGLE_REDIRECT_URI = os.getenv("REDIRECT_URI", os.getenv("GOOGLE_REDIRECT_URI"))

# Authlib OAuth registry
oauth = OAuth()
oauth.register(
    name='google',
    client_id=GOOGLE_CLIENT_ID,
    client_secret=GOOGLE_CLIENT_SECRET,
    access_token_url='https://oauth2.googleapis.com/token',
    access_token_params=None,
    authorize_url='https://accounts.google.com/o/oauth2/v2/auth',
    authorize_params={
        'access_type': 'offline',
        'prompt': 'consent',
        'include_granted_scopes': 'true',
    },
    api_base_url='https://www.googleapis.com/oauth2/v2/',
    client_kwargs={
        'scope': 'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/forms https://www.googleapis.com/auth/presentations https://www.googleapis.com/auth/tasks'
    },
)

@oauth_router.get("/api/auth/google/login")
async def google_login(request: Request):
    redirect_uri = GOOGLE_REDIRECT_URI
    return await oauth.google.authorize_redirect(request, redirect_uri)

@oauth_router.get("/api/auth/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    try:
        token = await oauth.google.authorize_access_token(request)
        user_info = await oauth.google.parse_id_token(request, token)
        # user_info contains: sub (google_id), email, name, picture, etc.
        google_id = user_info["sub"]
        email = user_info["email"]
        name = user_info.get("name", "")
        # Check if user exists
        user = db.query(User).filter(User.google_id == google_id).first()
        if not user:
            # Check if email already exists (from password signup)
            user = db.query(User).filter(User.email == email).first()
            if user:
                user.google_id = google_id
                user.google_access_token = token["access_token"]
            else:
                user = User(
                    email=email,
                    name=name,
                    google_id=google_id,
                    google_access_token=token["access_token"],
                )
                db.add(user)
        else:
            user.google_access_token = token["access_token"]
        db.commit()
        db.refresh(user)
        # Return a mock token and user info (replace with real JWT in production)
        # In production, redirect to frontend with token as query param or set cookie
        return {
            "access_token": "mock-google-jwt-token",
            "token_type": "bearer",
            "user": {
                "email": user.email,
                "name": user.name
            }
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Google OAuth failed: {str(e)}")
