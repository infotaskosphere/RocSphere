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
    company_type = (company.get("companyType") or "").lower()
    # event_date is used for event-based filings (e.g. DIR-12 appointment date,
    # BEN-2 declaration date, SH-7 change date, PAS-3 allotment date,
    # INC-22 office change date, CRA-3 receipt date, CRA-2 BM date)
    event_date = parse_date(company.get("eventDate"))
    # incorporationDate is used for INC-20A (Commencement of Business)
    incorporation_date = parse_date(company.get("incorporationDate"))

    # ─────────────────────────────────────────────────────────────
    # MGT-7A — Annual Return for OPC & Small Companies
    # Due: 60 days from AGM date
    # ─────────────────────────────────────────────────────────────
    if rule_id == "mgt7a":
        if agm:
            return add_days(agm, 60)

    # ─────────────────────────────────────────────────────────────
    # MGT-7 — Annual Return for Private / Public Companies
    # Due: 60 days from AGM date
    # ─────────────────────────────────────────────────────────────
    if rule_id == "mgt7":
        if agm:
            return add_days(agm, 60)

    # ─────────────────────────────────────────────────────────────
    # AOC-4 — Filing of Financial Statements
    # OPC: 180 days from close of financial year (31 Mar) → 27 Sep
    # Private / Public: 30 days from AGM date
    # ─────────────────────────────────────────────────────────────
    if rule_id == "aoc4":
        if company_type == "opc":
            # 180 days from 31 March of the same financial year
            fy_end = datetime(TODAY.year, 3, 31).date()
            return add_days(fy_end, 180)
        if agm:
            return add_days(agm, 30)

    # ─────────────────────────────────────────────────────────────
    # ADT-1 — Appointment of Auditor
    # OPC: 15 days from AGM (AGM held within 180 days of FY end → ~27 Sep; ADT-1 due 11 Oct)
    # Private / Public: 15 days from AGM date
    # ─────────────────────────────────────────────────────────────
    if rule_id == "adt1":
        if agm:
            return add_days(agm, 15)

    # ─────────────────────────────────────────────────────────────
    # MGT-14 — Filing of AGM Resolution with ROC
    # Due: 30 days from AGM date (applicable to Private & Public)
    # ─────────────────────────────────────────────────────────────
    if rule_id == "mgt14":
        if agm:
            return add_days(agm, 30)

    # ─────────────────────────────────────────────────────────────
    # DIR-12 — Regularization of Additional Director
    # Due: 30 days from date of appointment / regularization (event_date)
    # ─────────────────────────────────────────────────────────────
    if rule_id == "dir12":
        if event_date:
            return add_days(event_date, 30)

    # ─────────────────────────────────────────────────────────────
    # DIR-3 KYC — KYC of persons holding DIN as on 31 Mar
    # Due: 30 Sep every year
    # ─────────────────────────────────────────────────────────────
    if rule_id == "dir3k":
        return datetime(TODAY.year, 9, 30).date()

    # ─────────────────────────────────────────────────────────────
    # MSME-1 — Details of pending payment to MSME vendors
    # Half-yearly: 31 Oct (for Apr–Sep period) and 30 Apr (for Oct–Mar period)
    # ─────────────────────────────────────────────────────────────
    if rule_id == "msme1":
        # Half-yearly: 30 Apr (covers Oct–Mar period) and 31 Oct (covers Apr–Sep period)
        # Return the next upcoming deadline from today
        apr_deadline = datetime(TODAY.year, 4, 30).date()
        oct_deadline = datetime(TODAY.year, 10, 31).date()
        if TODAY <= apr_deadline:
            return apr_deadline
        if TODAY <= oct_deadline:
            return oct_deadline
        # Past Oct deadline — next is Apr of next year
        return datetime(TODAY.year + 1, 4, 30).date()

    # ─────────────────────────────────────────────────────────────
    # CSR-2 — Reporting of CSR Contribution
    # Due: 31 Dec every year
    # ─────────────────────────────────────────────────────────────
    if rule_id == "csr2":
        return datetime(TODAY.year, 12, 31).date()

    # ─────────────────────────────────────────────────────────────
    # DPT-3 — Return of Deposits
    # Due: 30 Jun every year
    # ─────────────────────────────────────────────────────────────
    if rule_id == "dpt3":
        return datetime(TODAY.year, 6, 30).date()

    # ─────────────────────────────────────────────────────────────
    # FC-3 — Annual Accounts of Foreign Company
    # Due: 30 Sep every year (within 6 months of close of FY)
    # ─────────────────────────────────────────────────────────────
    if rule_id == "fc3":
        return datetime(TODAY.year, 9, 30).date()

    # ─────────────────────────────────────────────────────────────
    # CRA-2 — Appointment of Cost Auditor
    # Due: 30 days from BM (Board Meeting) date or 27 Sep (180 days from 1 Apr),
    # whichever is earlier. Uses event_date as the BM date.
    # ─────────────────────────────────────────────────────────────
    if rule_id == "cra2":
        deadline_180 = datetime(TODAY.year, 9, 27).date()  # 180 days from 1 Apr
        if event_date:
            deadline_bm = add_days(event_date, 30)
            return min(deadline_bm, deadline_180)
        return deadline_180

    # ─────────────────────────────────────────────────────────────
    # CRA-3 — Submission of Cost Audit Report by Auditor to Company
    # Due: 180 days from end of financial year → 27 Sep
    # ─────────────────────────────────────────────────────────────
    if rule_id == "cra3":
        return datetime(TODAY.year, 9, 27).date()

    # ─────────────────────────────────────────────────────────────
    # CRA-4 — Filing of Cost Audit Report with ROC
    # Due: 30 days from receipt of CRA-3 (event_date = date report received)
    # ─────────────────────────────────────────────────────────────
    if rule_id == "cra4":
        if event_date:
            return add_days(event_date, 30)

    # ─────────────────────────────────────────────────────────────
    # NFRA-2 — Annual Return by Statutory Auditor to NFRA
    # Due: 30 Nov every year
    # ─────────────────────────────────────────────────────────────
    if rule_id == "nfra2":
        return datetime(TODAY.year, 11, 30).date()

    # ─────────────────────────────────────────────────────────────
    # LLP-8 — Statement of Account & Solvency (LLP)
    # Due: 30 Oct every year
    # ─────────────────────────────────────────────────────────────
    if rule_id == "llp8":
        return datetime(TODAY.year, 10, 30).date()

    # ─────────────────────────────────────────────────────────────
    # LLP-11 — Annual Return (LLP)
    # Due: 30 May every year
    # ─────────────────────────────────────────────────────────────
    if rule_id == "llp11":
        return datetime(TODAY.year, 5, 30).date()

    # ─────────────────────────────────────────────────────────────
    # BEN-2 — Significant Beneficial Ownership declaration
    # Due: 30 days from date of receiving declaration (event_date)
    # ─────────────────────────────────────────────────────────────
    if rule_id == "ben2":
        if event_date:
            return add_days(event_date, 30)

    # ─────────────────────────────────────────────────────────────
    # INC-20A — Commencement of Business (one-time)
    # Due: 180 days from date of incorporation
    # ─────────────────────────────────────────────────────────────
    if rule_id == "inc20a":
        if incorporation_date:
            return add_days(incorporation_date, 180)

    # ─────────────────────────────────────────────────────────────
    # SH-7 — Change in Share Capital (Authorised)
    # Due: 30 days from date of change (event_date)
    # ─────────────────────────────────────────────────────────────
    if rule_id == "sh7":
        if event_date:
            return add_days(event_date, 30)

    # ─────────────────────────────────────────────────────────────
    # PAS-3 — Return of Allotment of Shares
    # Due: 30 days from date of allotment (event_date)
    # ─────────────────────────────────────────────────────────────
    if rule_id == "pas3":
        if event_date:
            return add_days(event_date, 30)

    # ─────────────────────────────────────────────────────────────
    # INC-22 — Notice of Change of Registered Office
    # Due: 30 days from date of change (event_date)
    # Note: If change is within the same city, due in 15 days;
    #       we conservatively use 30 days as the outer limit.
    # ─────────────────────────────────────────────────────────────
    if rule_id == "inc22":
        if event_date:
            return add_days(event_date, 30)

    # ─────────────────────────────────────────────────────────────
    # INC-22A — ACTIVE Company Tagging & Verification (one-time)
    # This was a one-time MCA filing; no recurring due date.
    # Returns None — frontend should mark as one-time / historical.
    # ─────────────────────────────────────────────────────────────
    if rule_id == "inc22a":
        return None

    return None
