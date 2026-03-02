from datetime import datetime, timedelta
from typing import Dict, Optional

TODAY = datetime.utcnow().date()


def parse_date(date_str: Optional[str]):
    if not date_str:
        return None
    return datetime.strptime(date_str, "%d/%m/%Y").date()


def add_days(date_obj, days):
    return date_obj + timedelta(days=days)


def calculate_due_date(rule_id: str, company: Dict):
    agm = parse_date(company.get("lastAGM"))

    if rule_id in ["mgt7", "mgt7a"]:
        if agm:
            return add_days(agm, 60)

    if rule_id == "aoc4":
        if agm:
            return add_days(agm, 30)

    if rule_id == "adt1":
        if agm:
            return add_days(agm, 15)

    if rule_id == "dpt3":
        return datetime(TODAY.year, 6, 30).date()

    if rule_id == "dir3k":
        return datetime(TODAY.year, 9, 30).date()

    if rule_id == "llp8":
        return datetime(TODAY.year, 10, 30).date()

    if rule_id == "llp11":
        return datetime(TODAY.year, 5, 30).date()

    return None
