from fastapi import APIRouter, Request, Depends, HTTPException
from typing import List, Dict, Any
from auth_dependency import get_current_user

@router.get("/companies", response_model=Dict[str, List[Dict[str, Any]]])
def get_all_companies(
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    db = request.app.mongodb

    firm_id = current_user.get("firm_id")
    if not firm_id:
        raise HTTPException(status_code=400, detail="Firm ID missing")

    try:
        companies_cursor = db.roc_companies.find(
            {"firm_id": firm_id},
            {"_id": 0}
        )

        companies = list(companies_cursor)

        return {
            "success": True,
            "count": len(companies),
            "companies": companies
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch companies: {str(e)}"
        )
