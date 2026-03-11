import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
from roc_router import router as roc_router

# ─────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# FastAPI App
# ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="RocSphere API",
    description="ROC Compliance Tracker Backend",
    version="1.0.0"
)

# ─────────────────────────────────────────────────────────────
# CORS
# ─────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://roc-sphere-frontend.onrender.com",
        "http://localhost:3000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────
# MongoDB Connection
# ─────────────────────────────────────────────────────────────
MONGO_URL = os.getenv("MONGO_URL")
try:
    client = MongoClient(
        MONGO_URL,
        serverSelectionTimeoutMS=5000
    )
    client.admin.command("ping")
    db = client["rocsphere"]
    app.state.mongodb = db
    logger.info("MongoDB connected successfully")
except (ConnectionFailure, ServerSelectionTimeoutError) as e:
    logger.error(f"MongoDB connection failed: {e}")
    app.state.mongodb = None

# ─────────────────────────────────────────────────────────────
# Root
# ─────────────────────────────────────────────────────────────
@app.get("/")
def home():
    return {"message": "RocSphere Backend Running"}

# ─────────────────────────────────────────────────────────────
# Health Check
# ─────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    mongo_ok = False
    try:
        if app.state.mongodb is not None:
            app.state.mongodb.client.admin.command("ping")
            mongo_ok = True
    except Exception:
        pass
    return {
        "status": "ok",
        "mongodb": "connected" if mongo_ok else "disconnected",
    }

# ─────────────────────────────────────────────────────────────
# Routers
# ─────────────────────────────────────────────────────────────
app.include_router(roc_router, prefix="/api")
