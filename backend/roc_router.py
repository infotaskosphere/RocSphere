from fastapi import Query
from pymongo import ASCENDING, DESCENDING
from datetime import datetime


@router.get("/companies")
def get_all_companies(
    request: Request,
    current_user: dict = Depends(get_current_user),

    # Pagination
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),

    # Search
    search: str = Query(None),

    # Sorting
    sort_by: str = Query("updatedAt"),
    sort_order: str = Query("desc")  # asc | desc
):
    db = request.app.mongodb
    firm_id = current_user["firm_id"]

    # ==========================
    # FILTER
    # ==========================
    filter_query = {"firm_id": firm_id}

    if search:
        filter_query["$or"] = [
            {"companyName": {"$regex": search, "$options": "i"}},
            {"cin": {"$regex": search, "$options": "i"}}
        ]

    # ==========================
    # SORT
    # ==========================
    order = DESCENDING if sort_order == "desc" else ASCENDING

    # ==========================
    # PAGINATION
    # ==========================
    skip = (page - 1) * limit

    total_count = db.roc_companies.count_documents(filter_query)

    companies_cursor = (
        db.roc_companies
        .find(filter_query, {"_id": 0})
        .sort(sort_by, order)
        .skip(skip)
        .limit(limit)
    )

    companies = list(companies_cursor)

    return {
        "success": True,
        "page": page,
        "limit": limit,
        "total": total_count,
        "total_pages": (total_count + limit - 1) // limit,
        "companies": companies
    }
