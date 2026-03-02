def calculate_late_fee(rule_id: str, days_overdue: int):
    if days_overdue <= 0:
        return 0

    # Fixed penalty for DIR-3 KYC
    if rule_id == "dir3k":
        return 5000

    # Standard ₹100 per day
    return 100 * days_overdue
