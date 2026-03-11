from fastapi import APIRouter, HTTPException, Request, Query
from typing import Dict, Any, Optional
from pymongo import ASCENDING, DESCENDING
from datetime import datetime


# ───────────────────────────────────────────────────────────────────────
# Router Configuration
# ───────────────────────────────────────────────────────────────────────

router = APIRouter(
    prefix="/roc",
    tags=["ROC Compliance"]
)

FIRM_ID = "default"


# ───────────────────────────────────────────────────────────────────────
# Database Access Helper
# ───────────────────────────────────────────────────────────────────────

def get_db(request: Request):
    """
    Safely fetch MongoDB instance from FastAPI app state.
    """
    db = request.app.state.mongodb

    if db is None:
        raise HTTPException(
            status_code=500,
            detail="Database connection not available"
        )

    return db


# ───────────────────────────────────────────────────────────────────────
# Get All Companies
# ───────────────────────────────────────────────────────────────────────

@router.get("/companies")
def get_all_companies(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    search: Optional[str] = Query(None),
    sort_by: str = Query("updatedAt"),
    sort_order: str = Query("desc")
):

    db = get_db(request)

    filter_query = {"firm_id": FIRM_ID}

    if search:
        filter_query["$or"] = [
            {"companyName": {"$regex": search, "$options": "i"}},
            {"cin": {"$regex": search, "$options": "i"}}
        ]

    order = DESCENDING if sort_order == "desc" else ASCENDING

    skip = (page - 1) * limit

    companies_cursor = (
        db.roc_companies
        .find(filter_query, {"_id": 0})
        .sort(sort_by, order)
        .skip(skip)
        .limit(limit)
    )

    companies = list(companies_cursor)

    return companies


# ───────────────────────────────────────────────────────────────────────
# Get Single Company
# ───────────────────────────────────────────────────────────────────────

@router.get("/companies/{cin}")
def get_company(cin: str, request: Request):

    db = get_db(request)

    company = db.roc_companies.find_one(
        {"cin": cin, "firm_id": FIRM_ID},
        {"_id": 0}
    )

    if not company:
        raise HTTPException(
            status_code=404,
            detail="Company not found"
        )

    return company


# ───────────────────────────────────────────────────────────────────────
# Create or Update Company
# ───────────────────────────────────────────────────────────────────────

@router.post("/companies")
def create_or_update_company(data: Dict[str, Any], request: Request):

    db = get_db(request)

    cin = data.get("cin")

    if not cin:
        raise HTTPException(
            status_code=400,
            detail="CIN is required"
        )

    data["firm_id"] = FIRM_ID
    data["updatedAt"] = datetime.utcnow().isoformat()

    db.roc_companies.update_one(
        {"cin": cin, "firm_id": FIRM_ID},
        {"$set": data},
        upsert=True
    )

    return {
        "success": True,
        "message": "Company saved successfully"
    }


# ───────────────────────────────────────────────────────────────────────
# Delete Company
# ───────────────────────────────────────────────────────────────────────

@router.delete("/companies/{cin}")
def delete_company(cin: str, request: Request):

    db = get_db(request)

    result = db.roc_companies.delete_one(
        {"cin": cin, "firm_id": FIRM_ID}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Company not found"
        )

    return {
        "success": True,
        "message": "Company deleted successfully"
    }


# ───────────────────────────────────────────────────────────────────────
# Update Filing Status
# ───────────────────────────────────────────────────────────────────────

@router.put("/filing-status/{cin}")
def update_filing_status(cin: str, data: Dict[str, Any], request: Request):

    db = get_db(request)

    company = db.roc_companies.find_one(
        {"cin": cin, "firm_id": FIRM_ID}
    )

    if not company:
        raise HTTPException(
            status_code=404,
            detail="Company not found"
        )

    rule_id = data.get("rule_id")

    if not rule_id:
        raise HTTPException(
            status_code=400,
            detail="rule_id is required"
        )

    filing_status = company.get("filingStatus", {})

    filing_status[rule_id] = {
        "status": data.get("status", "pending"),
        "srn": data.get("srn", ""),
        "filedDate": data.get("filedDate", ""),
        "notes": data.get("notes", "")
    }

    db.roc_companies.update_one(
        {"cin": cin, "firm_id": FIRM_ID},
        {"$set": {"filingStatus": filing_status}}
    )

    return {
        "success": True,
        "message": "Filing status updated successfully"
    }
