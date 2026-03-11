from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from roc_router import router as roc_router
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
import os
import logging

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── FastAPI App ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="RocSphere API",
    description="ROC Compliance Tracker Backend",
    version="1.0.0"
)


# ── CORS Configuration (Render Frontend Allowed) ──────────────────────────────
FRONTEND_URL = os.getenv(
    "FRONTEND_URL",
    "https://roc-sphere-frontend.onrender.com"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── MongoDB Configuration ─────────────────────────────────────────────────────
MONGO_URL = os.getenv("MONGO_URL")

if not MONGO_URL:
    logger.warning("⚠ MONGO_URL not set — using localhost fallback")
    MONGO_URL = "mongodb://localhost:27017"


try:
    client = MongoClient(
        MONGO_URL,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=10000,
        socketTimeoutMS=10000
    )

    # Test connection
    client.admin.command("ping")

    db = client["rocsphere"]
    app.mongodb = db

    logger.info("✅ MongoDB connected successfully")

except (ConnectionFailure, ServerSelectionTimeoutError) as e:

    logger.error(f"❌ MongoDB connection failed: {e}")

    app.mongodb = None

# ── Root ───────────────────────────────────────────────────────────────────────
@app.get("/")
def home():
    return {"message": "RocSphere Backend Running"}

# ── Health check (ping this from UptimeRobot every 5 min to stay awake) ────────
# UptimeRobot URL: https://rocsphere.onrender.com/health
@app.get("/health")
def health():
    mongo_ok = False
    try:
        if app.mongodb is not None:
            app.mongodb.client.admin.command("ping")
            mongo_ok = True
    except Exception:
        pass
    return {
        "status": "ok",
        "mongodb": "connected" if mongo_ok else "disconnected",
    }

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(roc_router, prefix="/api")
