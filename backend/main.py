from fastapi import FastAPI
from roc_router import router as roc_router
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
import os
import jwt

# Create app
app = FastAPI()

# CORS (OK for development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MongoDB connection
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
client = MongoClient(MONGO_URL)
db = client["rocsphere"]

# Make DB accessible to routers
app.mongodb = db


@app.get("/")
def home():
    return {"message": "RocSphere Backend Running"}

app.include_router(roc_router, prefix="/api")
