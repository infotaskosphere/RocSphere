from backend.roc_due_engine import compliance_status
from backend.roc_late_fee import calculate_late_fee

@router.get("/companies/{cin}/compliance-summary")
async def get_compliance_summary(cin: str):
    company = await companies_collection.find_one({"cin": cin}, {"_id": 0})

    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    rules = [
        "mgt7", "mgt7a", "aoc4", "adt1",
        "dpt3", "dir3k", "llp8", "llp11"
    ]

    result = []

    for rule in rules:
        status_data = compliance_status(rule, company)

        if status_data.get("status") == "overdue":
            late_fee = calculate_late_fee(rule, status_data["days_overdue"])
        else:
            late_fee = 0

        result.append({
            "rule_id": rule,
            "due_date": status_data.get("due_date"),
            "status": status_data.get("status"),
            "days_remaining": status_data.get("days_remaining"),
            "days_overdue": status_data.get("days_overdue"),
            "late_fee": late_fee
        })

    return {"compliance_summary": result}
  @router.get("/dashboard-stats")
async def dashboard_stats():
    companies = await companies_collection.find({}, {"_id": 0}).to_list(1000)

    total_overdue = 0
    total_late_fee = 0

    for company in companies:
        for rule in ["mgt7","aoc4","dpt3","dir3k"]:
            status = compliance_status(rule, company)
            if status.get("status") == "overdue":
                total_overdue += 1
                total_late_fee += calculate_late_fee(
                    rule,
                    status["days_overdue"]
                )

    return {
        "total_overdue_forms": total_overdue,
        "total_late_fees_exposure": total_late_fee
    }
