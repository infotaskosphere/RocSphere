from fastapi import APIRouter, HTTPException, Request
from datetime import datetime
from typing import Dict, Any
from roc_due_engine import compliance_status
from roc_late_fee import calculate_late_fee

router = APIRouter(
    prefix="/roc",
    tags=["ROC Compliance"]
)

# ==============================
# Helper
# ==============================

def get_db(request: Request):
    return request.app.mongodb


# ==============================
# Company CRUD
# ==============================

@router.get("/companies")
def get_all_companies(request: Request):
    db = get_db(request)
    companies = list(db.roc_companies.find({}, {"_id": 0}))
    return {"companies": companies}


@router.get("/companies/{cin}")
def get_company(cin: str, request: Request):
    db = get_db(request)
    company = db.roc_companies.find_one({"cin": cin}, {"_id": 0})

    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    return company


@router.post("/companies")
def create_or_update_company(data: Dict[str, Any], request: Request):
    db = get_db(request)

    cin = data.get("cin")
    if not cin:
        raise HTTPException(status_code=400, detail="CIN is required")

    data["updatedAt"] = datetime.utcnow().isoformat()

    db.roc_companies.update_one(
        {"cin": cin},
        {"$set": data},
        upsert=True
    )

    return {"message": "Company saved successfully"}


@router.delete("/companies/{cin}")
def delete_company(cin: str, request: Request):
    db = get_db(request)

    result = db.roc_companies.delete_one({"cin": cin})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Company not found")

    return {"message": "Company deleted successfully"}


# ==============================
# Filing Status Update
# ==============================

@router.put("/companies/{cin}/filing-status/{rule_id}")
def update_filing_status(
    cin: str,
    rule_id: str,
    data: Dict[str, Any],
    request: Request
):
    db = get_db(request)

    company = db.roc_companies.find_one({"cin": cin})
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
        {"cin": cin},
        {"$set": {"filingStatus": filing_status}}
    )

    return {"message": "Filing status updated successfully"}


# ==============================
# Financial Data Update
# ==============================

@router.put("/companies/{cin}/financials")
def update_financials(
    cin: str,
    data: Dict[str, Any],
    request: Request
):
    db = get_db(request)

    company = db.roc_companies.find_one({"cin": cin})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    update_fields = {}

    for field in ["turnover", "networth", "netProfit"]:
        if field in data:
            update_fields[field] = data[field]

    if not update_fields:
        raise HTTPException(status_code=400, detail="No valid fields provided")

    db.roc_companies.update_one(
        {"cin": cin},
        {"$set": update_fields}
    )

    return {"message": "Financial data updated successfully"}


# ==============================
# Document Storage
# ==============================

@router.post("/companies/{cin}/documents")
def add_document(
    cin: str,
    document: Dict[str, Any],
    request: Request
):
    db = get_db(request)

    company = db.roc_companies.find_one({"cin": cin})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    documents = company.get("documents", [])
    documents.append(document)

    db.roc_companies.update_one(
        {"cin": cin},
        {"$set": {"documents": documents}}
    )

    return {"message": "Document added successfully"}


# ==============================
# Due Date + Late Fee Summary
# ==============================

@router.get("/companies/{cin}/compliance-summary")
def compliance_summary(cin: str, request: Request):
    db = get_db(request)

    company = db.roc_companies.find_one({"cin": cin}, {"_id": 0})

    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    rules = [
        "mgt7", "mgt7a", "aoc4", "adt1",
        "dpt3", "dir3k", "llp8", "llp11"
    ]

    result = []

    for rule in rules:
        status_data = compliance_status(rule, company)

        late_fee = 0
        if status_data.get("status") == "overdue":
            late_fee = calculate_late_fee(
                rule,
                status_data.get("days_overdue", 0)
            )

        result.append({
            "rule_id": rule,
            "due_date": status_data.get("due_date"),
            "status": status_data.get("status"),
            "days_remaining": status_data.get("days_remaining"),
            "days_overdue": status_data.get("days_overdue"),
            "late_fee": late_fee
        })

    return {"compliance_summary": result}


# ==============================
# Dashboard Exposure Stats
# ==============================

@router.get("/dashboard-stats")
def dashboard_stats(request: Request):
    db = get_db(request)

    companies = list(db.roc_companies.find({}, {"_id": 0}))

    total_overdue = 0
    total_late_fee = 0

    rules = ["mgt7", "mgt7a", "aoc4", "dpt3", "dir3k"]

    for company in companies:
        for rule in rules:
            status_data = compliance_status(rule, company)

            if status_data.get("status") == "overdue":
                total_overdue += 1
                total_late_fee += calculate_late_fee(
                    rule,
                    status_data.get("days_overdue", 0)
                )

    return {
        "total_companies": len(companies),
        "total_overdue_forms": total_overdue,
        "total_late_fee_exposure": total_late_fee
    }
