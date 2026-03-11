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

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="RocSphere API",
    description="ROC Compliance Tracker Backend",
    version="1.0.0"
)

# ── CORS — must be registered BEFORE routers ───────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── MongoDB ────────────────────────────────────────────────────────────────────
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")

try:
    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    client.admin.command("ping")
    db = client["rocsphere"]
    app.mongodb = db
    logger.info("✅ MongoDB connected successfully")
except (ConnectionFailure, ServerSelectionTimeoutError) as e:
    logger.error(f"❌ MongoDB connection failed: {e}")
    app.mongodb = None

# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return {"message": "RocSphere Backend Running"}


@app.get("/health")
def health():
    """
    Health check — ping this URL every 5 min via UptimeRobot (free)
    to keep the Render free-tier service awake and avoid fake CORS errors.
    Monitor URL: https://YOUR-BACKEND.onrender.com/health
    """
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
