from fastapi import APIRouter, HTTPException, Request, Depends, Query
from typing import Dict, Any, List
from pymongo import ASCENDING, DESCENDING
from datetime import datetime

from auth_dependency import get_current_user
from roc_due_engine import compliance_status
from roc_late_fee import calculate_late_fee

router = APIRouter(
    prefix="/roc",
    tags=["ROC Compliance"]
)

# ==========================================================
# Helper
# ==========================================================

def get_db(request: Request):
    return request.app.mongodb


# ==========================================================
# Companies List (Pagination + Search + Sorting)
# ==========================================================

@router.get("/companies")
def get_all_companies(
    request: Request,
    current_user: dict = Depends(get_current_user),

    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    sort_by: str = Query("updatedAt"),
    sort_order: str = Query("desc")
):
    db = get_db(request)
    firm_id = current_user["firm_id"]

    filter_query = {"firm_id": firm_id}

    if search:
        filter_query["$or"] = [
            {"companyName": {"$regex": search, "$options": "i"}},
            {"cin": {"$regex": search, "$options": "i"}}
        ]

    order = DESCENDING if sort_order == "desc" else ASCENDING
    skip = (page - 1) * limit

    total = db.roc_companies.count_documents(filter_query)

    companies = list(
        db.roc_companies
        .find(filter_query, {"_id": 0})
        .sort(sort_by, order)
        .skip(skip)
        .limit(limit)
    )

    return {
        "page": page,
        "limit": limit,
        "total": total,
        "total_pages": (total + limit - 1) // limit,
        "companies": companies
    }


# ==========================================================
# Get Single Company
# ==========================================================

@router.get("/companies/{cin}")
def get_company(
    cin: str,
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    db = get_db(request)

    company = db.roc_companies.find_one(
        {"cin": cin, "firm_id": current_user["firm_id"]},
        {"_id": 0}
    )

    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    return company


# ==========================================================
# Create / Update Company
# ==========================================================

@router.post("/companies")
def create_or_update_company(
    data: Dict[str, Any],
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    db = get_db(request)

    cin = data.get("cin")
    if not cin:
        raise HTTPException(status_code=400, detail="CIN is required")

    data["firm_id"] = current_user["firm_id"]
    data["updatedAt"] = datetime.utcnow().isoformat()

    db.roc_companies.update_one(
        {"cin": cin, "firm_id": current_user["firm_id"]},
        {"$set": data},
        upsert=True
    )

    return {"message": "Company saved successfully"}


# ==========================================================
# Delete Company (Owner Only Recommended)
# ==========================================================

@router.delete("/companies/{cin}")
def delete_company(
    cin: str,
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    db = get_db(request)

    result = db.roc_companies.delete_one(
        {"cin": cin, "firm_id": current_user["firm_id"]}
    )

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Company not found")

    return {"message": "Company deleted successfully"}


# ==========================================================
# Update Filing Status
# ==========================================================

@router.put("/companies/{cin}/filing-status/{rule_id}")
def update_filing_status(
    cin: str,
    rule_id: str,
    data: Dict[str, Any],
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    db = get_db(request)

    company = db.roc_companies.find_one(
        {"cin": cin, "firm_id": current_user["firm_id"]}
    )

    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    filing_status = company.get("filingStatus", {})

    filing_status[rule_id] = {
        "status": data.get("status", "pending"),
        "srn": data.get("srn", ""),
        "filedDate": data.get("filedDate", ""),
        "notes": data.get("notes", "")
    }

    db.roc_companies.update_one(
        {"cin": cin, "firm_id": current_user["firm_id"]},
        {"$set": {"filingStatus": filing_status}}
    )

    return {"message": "Filing status updated successfully"}


# ==========================================================
# Compliance Summary (Due + Late Fee)
# ==========================================================

@router.get("/companies/{cin}/compliance-summary")
def compliance_summary(
    cin: str,
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    db = get_db(request)

    company = db.roc_companies.find_one(
        {"cin": cin, "firm_id": current_user["firm_id"]},
        {"_id": 0}
    )

    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    rules = ["mgt7", "mgt7a", "aoc4", "adt1", "dpt3", "dir3k", "llp8", "llp11"]

    result = []

    for rule in rules:
        status_data = compliance_status(rule, company)

        late_fee_data = {"late_fee": 0}

        if status_data.get("status") == "overdue":
            late_fee_data = calculate_late_fee(
                rule,
                status_data.get("days_overdue", 0),
                company
            )

        result.append({
            "rule_id": rule,
            "due_date": status_data.get("due_date"),
            "status": status_data.get("status"),
            "days_remaining": status_data.get("days_remaining"),
            "days_overdue": status_data.get("days_overdue"),
            "late_fee": late_fee_data.get("late_fee", 0),
            "remarks": late_fee_data.get("remarks", "")
        })

    return {"compliance_summary": result}


# ==========================================================
# Firm Dashboard Summary
# ==========================================================

@router.get("/dashboard-summary")
def firm_dashboard_summary(
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    db = get_db(request)
    firm_id = current_user["firm_id"]

    companies = list(
        db.roc_companies.find(
            {"firm_id": firm_id},
            {"_id": 0}
        )
    )

    total_companies = len(companies)
    total_overdue = 0
    total_upcoming_30 = 0
    total_late_fee = 0
    total_compliances = 0
    total_filed = 0
    small_companies = 0

    for company in companies:

        if company.get("isSmallCompany") == "Yes":
            small_companies += 1

        filing_status = company.get("filingStatus", {})

        for rule_id, status_data in filing_status.items():
            total_compliances += 1

            if status_data.get("status") == "filed":
                total_filed += 1
                continue

            status_info = compliance_status(rule_id, company)

            if status_info.get("status") == "overdue":
                total_overdue += 1

                penalty = calculate_late_fee(
                    rule_id,
                    status_info.get("days_overdue", 0),
                    company
                )

                total_late_fee += penalty.get("late_fee", 0)

            elif status_info.get("status") == "upcoming":
                if status_info.get("days_remaining", 999) <= 30:
                    total_upcoming_30 += 1

    completion_rate = (
        (total_filed / total_compliances) * 100
        if total_compliances > 0 else 0
    )

    return {
        "total_companies": total_companies,
        "small_companies": small_companies,
        "non_small_companies": total_companies - small_companies,
        "total_overdue_forms": total_overdue,
        "due_within_30_days": total_upcoming_30,
        "total_late_fee_exposure": total_late_fee,
        "compliance_completion_percentage": round(completion_rate, 2)
    }
