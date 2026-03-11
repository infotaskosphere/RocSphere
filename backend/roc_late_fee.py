# ─────────────────────────────────────────────────────────────────────────────
# ROC Late Fee Calculator
#
# Late fees are calculated based on:
#   1. The form type (rule_id)
#   2. The number of days overdue
#   3. The normal (base) filing fee for that form
#   4. The company category (for LLP/OPC flat-rate forms)
#
# Standard Multiplier Slab (for most company forms — AOC-4, MGT-7, ADT-1, etc.)
# ┌─────────────────────┬──────────────────────────┐
# │ Period of Delay     │ Penalty                  │
# ├─────────────────────┼──────────────────────────┤
# │ Up to 15 days       │ 1× normal filing fee     │
# │ 16–30 days          │ 2× normal filing fee     │
# │ 31–60 days          │ 4× normal filing fee     │
# │ 61–90 days          │ 6× normal filing fee     │
# │ 91–180 days         │ 10× normal filing fee    │
# │ 181–270 days        │ 12× normal filing fee    │
# │ More than 270 days  │ ₹100 per day (no cap)    │
# └─────────────────────┴──────────────────────────┘
#
# For LLP and OPC flat-rate forms: ₹100 per day (no multiplier, no cap)
# DIR-3 KYC: Fixed ₹5,000 regardless of delay period
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# Base Normal Filing Fees (₹) per form
#
# These are the standard MCA filing fees (excluding late penalties).
# For forms where the fee depends on authorised capital, a representative
# default is used; pass authorised_capital to get an accurate figure.
# ─────────────────────────────────────────────────────────────────────────────

# Default base fees (₹) when authorised capital is not provided
DEFAULT_BASE_FEES: dict = {
    "aoc4":   300,   # AOC-4  — Financial Statements
    "mgt7":   300,   # MGT-7  — Annual Return (Private/Public)
    "mgt7a":  200,   # MGT-7A — Annual Return (OPC/Small)
    "adt1":   300,   # ADT-1  — Auditor Appointment
    "mgt14":  300,   # MGT-14 — AGM Resolution
    "dir12":  300,   # DIR-12 — Director Appointment/Resignation
    "inc22":  200,   # INC-22 — Change of Registered Office
    "inc20a": 200,   # INC-20A — Commencement of Business
    "sh7":    300,   # SH-7   — Change in Authorised Capital
    "pas3":   200,   # PAS-3  — Return of Allotment
    "ben2":   200,   # BEN-2  — Significant Beneficial Owner
    "csr2":   300,   # CSR-2  — CSR Contribution Report
    "dpt3":   300,   # DPT-3  — Return of Deposits
    "fc3":    300,   # FC-3   — Foreign Company Annual Accounts
    "cra2":   200,   # CRA-2  — Cost Auditor Appointment
    "cra4":   300,   # CRA-4  — Cost Audit Report Filing
    "nfra2":  300,   # NFRA-2 — Auditor Annual Return to NFRA
    "msme1":  200,   # MSME-1 — MSME Half-Yearly Return
    # LLP forms — flat ₹100/day (see LLP_FLAT_RATE_FORMS below)
    "llp8":   0,
    "llp11":  0,
    # Fixed / one-time
    "dir3k":  0,     # DIR-3 KYC — fixed ₹5,000 (see special case)
    "inc22a": 0,
}

# Forms that use a flat ₹100/day penalty (LLP specific, no multiplier)
LLP_FLAT_RATE_FORMS = {"llp8", "llp11"}


def _get_multiplier(days_overdue: int) -> int:
    """
    Returns the penalty multiplier based on the period of delay.
    Returns -1 to signal the beyond-270-days flat ₹100/day rule.
    """
    if days_overdue <= 15:
        return 1
    if days_overdue <= 30:
        return 2
    if days_overdue <= 60:
        return 4
    if days_overdue <= 90:
        return 6
    if days_overdue <= 180:
        return 10
    if days_overdue <= 270:
        return 12
    return -1  # Beyond 270 days — ₹100 per day


def get_base_fee(rule_id: str, authorised_capital: int = 0) -> int:
    """
    Returns the normal (base) filing fee for a given form.

    For forms where MCA fee is tiered by authorised capital (e.g. AOC-4, MGT-7),
    pass the company's authorised_capital (in ₹) for an accurate base fee.

    MCA fee slabs by authorised capital (standard forms):
      Up to ₹1,00,000        → ₹200
      ₹1,00,001–₹4,99,999   → ₹300
      ₹5,00,000–₹24,99,999  → ₹400
      ₹25,00,000–₹99,99,999 → ₹500
      ₹1,00,00,000 and above → ₹600
    """
    capital_based_forms = {
        "aoc4", "mgt7", "mgt7a", "adt1", "mgt14",
        "dir12", "inc22", "sh7", "pas3", "ben2",
        "csr2", "dpt3", "fc3", "cra2", "cra4",
        "nfra2", "msme1", "inc20a",
    }

    if rule_id in capital_based_forms and authorised_capital > 0:
        if authorised_capital <= 100_000:
            return 200
        if authorised_capital <= 499_999:
            return 300
        if authorised_capital <= 2_499_999:
            return 400
        if authorised_capital <= 9_999_999:
            return 500
        return 600

    return DEFAULT_BASE_FEES.get(rule_id, 300)


def calculate_late_fee(
    rule_id: str,
    days_overdue: int,
    authorised_capital: int = 0,
) -> dict:
    """
    Calculate the ROC late fee for a given form and delay period.

    Args:
        rule_id           : Form identifier (e.g. "aoc4", "mgt7", "dir3k")
        days_overdue      : Number of days past the due date
        authorised_capital: Company's authorised share capital in ₹ (optional)

    Returns:
        dict with keys:
            base_fee      — Normal filing fee (₹)
            late_fee      — Additional penalty (₹)
            total_payable — base_fee + late_fee (₹)
            multiplier    — Multiplier applied (int) or "₹100/day" or "fixed"
            slab          — Human-readable delay slab description
    """
    if days_overdue <= 0:
        base_fee = get_base_fee(rule_id, authorised_capital)
        return {
            "base_fee": base_fee,
            "late_fee": 0,
            "total_payable": base_fee,
            "multiplier": 0,
            "slab": "No delay",
        }

    # ─────────────────────────────────────────────────────────────
    # DIR-3 KYC — Fixed penalty of ₹5,000 regardless of delay
    # ─────────────────────────────────────────────────────────────
    if rule_id == "dir3k":
        return {
            "base_fee": 0,
            "late_fee": 5000,
            "total_payable": 5000,
            "multiplier": "fixed",
            "slab": "Fixed penalty (any delay)",
        }

    # ─────────────────────────────────────────────────────────────
    # LLP Flat-Rate Forms — ₹100 per day, no cap
    # ─────────────────────────────────────────────────────────────
    if rule_id in LLP_FLAT_RATE_FORMS:
        late_fee = 100 * days_overdue
        return {
            "base_fee": 0,
            "late_fee": late_fee,
            "total_payable": late_fee,
            "multiplier": "₹100/day",
            "slab": f"{days_overdue} days x Rs.100",
        }

    # ─────────────────────────────────────────────────────────────
    # Standard Multiplier-Based Penalty (most company forms)
    # ─────────────────────────────────────────────────────────────
    base_fee = get_base_fee(rule_id, authorised_capital)
    multiplier = _get_multiplier(days_overdue)

    if days_overdue <= 15:
        slab = "Up to 15 days (1x fee)"
    elif days_overdue <= 30:
        slab = "16-30 days (2x fee)"
    elif days_overdue <= 60:
        slab = "31-60 days (4x fee)"
    elif days_overdue <= 90:
        slab = "61-90 days (6x fee)"
    elif days_overdue <= 180:
        slab = "91-180 days (10x fee)"
    elif days_overdue <= 270:
        slab = "181-270 days (12x fee)"
    else:
        slab = "More than 270 days (Rs.100/day)"

    if multiplier == -1:
        # Beyond 270 days — ₹100 per day, no cap
        late_fee = 100 * days_overdue
        return {
            "base_fee": base_fee,
            "late_fee": late_fee,
            "total_payable": base_fee + late_fee,
            "multiplier": "Rs.100/day",
            "slab": slab,
        }

    late_fee = multiplier * base_fee
    return {
        "base_fee": base_fee,
        "late_fee": late_fee,
        "total_payable": base_fee + late_fee,
        "multiplier": multiplier,
        "slab": slab,
    }
