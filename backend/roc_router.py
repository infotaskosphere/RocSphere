from fastapi import APIRouter, HTTPException, Request, Query
from typing import Dict, Any, Optional
from pymongo import ASCENDING, DESCENDING
from datetime import datetime
from roc_reminder import (
    send_email_reminder,
    send_whatsapp_reminder,
    build_reminder_text,
    build_reminder_html,
    build_whatsapp_message,
)


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


# ───────────────────────────────────────────────────────────────────────
# Send Reminder  (Email and/or WhatsApp)
# ───────────────────────────────────────────────────────────────────────

@router.post("/send-reminder")
def send_reminder(data: Dict[str, Any], request: Request):
    """
    Trigger a manual reminder for one compliance item.

    Expected payload:
    {
        "channel":       "email" | "whatsapp" | "both",
        "to_email":      "client@example.com",        // required for email/both
        "to_phone":      "+919876543210",              // required for whatsapp/both
        "company_name":  "Acme Pvt Ltd",
        "form":          "AOC-4",
        "form_title":    "Financial Statements Filing",
        "due_date":      "29/10/2025",
        "days_left":     12,                           // int or null
        "notes":         "Optional notes"
    }
    """
    channel      = data.get("channel", "email")
    to_email     = (data.get("to_email") or "").strip()
    to_phone     = (data.get("to_phone") or "").strip()
    company_name = data.get("company_name", "")
    form         = data.get("form", "")
    form_title   = data.get("form_title", "")
    due_date     = data.get("due_date", "-")
    days_left    = data.get("days_left")   # can be None / int
    notes        = data.get("notes", "")

    # ── Validate ─────────────────────────────────────────────────────────
    if channel in ("email", "both") and not to_email:
        raise HTTPException(status_code=400, detail="to_email is required for email channel")
    if channel in ("whatsapp", "both") and not to_phone:
        raise HTTPException(status_code=400, detail="to_phone is required for whatsapp channel")

    results = {}

    # ── Email ─────────────────────────────────────────────────────────────
    if channel in ("email", "both"):
        subject = (
            f"[OVERDUE] {form} — {company_name}" if (days_left is not None and days_left < 0)
            else f"[DUE TODAY] {form} — {company_name}" if days_left == 0
            else f"[Reminder] {form} due {due_date} — {company_name}"
        )
        body_text = build_reminder_text(company_name, form, form_title, due_date, days_left, notes)
        body_html = build_reminder_html(company_name, form, form_title, due_date, days_left, notes)
        results["email"] = send_email_reminder(to_email, subject, body_text, body_html)

    # ── WhatsApp ──────────────────────────────────────────────────────────
    if channel in ("whatsapp", "both"):
        message = build_whatsapp_message(company_name, form, form_title, due_date, days_left)
        results["whatsapp"] = send_whatsapp_reminder(to_phone, message)

    # ── Log reminder in DB ────────────────────────────────────────────────
    try:
        db = request.app.state.mongodb
        if db is not None:
            db.reminder_log.insert_one({
                "company_name": company_name,
                "form":         form,
                "due_date":     due_date,
                "channel":      channel,
                "to_email":     to_email,
                "to_phone":     to_phone,
                "results":      results,
                "sentAt":       datetime.utcnow().isoformat(),
                "firm_id":      FIRM_ID,
            })
    except Exception:
        pass  # log failure should never block reminder response

    # ── Response ──────────────────────────────────────────────────────────
    any_success = any(v.get("success") for v in results.values())
    all_success = all(v.get("success") for v in results.values())

    return {
        "success":     all_success,
        "any_success": any_success,
        "results":     results,
    }


# ───────────────────────────────────────────────────────────────────────
# Get Reminder Log for a company
# ───────────────────────────────────────────────────────────────────────

@router.get("/reminder-log/{cin}")
def get_reminder_log(cin: str, request: Request):
    """Return last 50 reminders sent for a given company name / cin."""
    db = get_db(request)
    # We log by company_name; also support CIN lookup via companies collection
    company = db.roc_companies.find_one({"cin": cin, "firm_id": FIRM_ID}, {"_id": 0})
    company_name = company.get("companyName", "") if company else ""

    logs = list(
        db.reminder_log.find(
            {"company_name": company_name, "firm_id": FIRM_ID},
            {"_id": 0}
        )
        .sort("sentAt", DESCENDING)
        .limit(50)
    )
    return logs
