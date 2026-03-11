# ─────────────────────────────────────────────────────────────────────────────
# roc_reminder.py  —  Email & WhatsApp reminder sender for RocSphere
#
# Required environment variables (set in Render dashboard):
#
#   EMAIL_FROM        sender Gmail address   e.g. rocsphere@gmail.com
#   EMAIL_PASSWORD    Gmail App Password     (NOT your Gmail login password)
#                     Generate at: myaccount.google.com → Security → App passwords
#
#   TWILIO_SID        Twilio Account SID     (from console.twilio.com)
#   TWILIO_TOKEN      Twilio Auth Token
#   TWILIO_WA_FROM    WhatsApp-enabled number e.g. whatsapp:+14155238886
#                     (Use Twilio Sandbox number during dev)
#
# All four vars are optional — the system gracefully skips the channel
# if its credentials are missing.
# ─────────────────────────────────────────────────────────────────────────────

import os
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text      import MIMEText
from typing               import Optional

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Email sender (Gmail SMTP via App Password)
# ─────────────────────────────────────────────────────────────────────────────

def send_email_reminder(
    to_email: str,
    subject:  str,
    body_text: str,
    body_html: Optional[str] = None,
) -> dict:
    """
    Send a reminder email via Gmail SMTP.
    Returns {"success": bool, "error": str|None}
    """
    email_from    = os.getenv("EMAIL_FROM", "")
    email_password = os.getenv("EMAIL_PASSWORD", "")

    if not email_from or not email_password:
        return {"success": False, "error": "Email credentials not configured (EMAIL_FROM / EMAIL_PASSWORD)"}

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"rocSphere Compliance <{email_from}>"
        msg["To"]      = to_email

        # Plain text fallback
        msg.attach(MIMEText(body_text, "plain"))

        # HTML version (richer)
        if body_html:
            msg.attach(MIMEText(body_html, "html"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(email_from, email_password)
            server.sendmail(email_from, to_email, msg.as_string())

        logger.info(f"Email reminder sent to {to_email} | Subject: {subject}")
        return {"success": True, "error": None}

    except smtplib.SMTPAuthenticationError:
        err = "Gmail authentication failed. Check EMAIL_FROM and EMAIL_PASSWORD (must be an App Password)."
        logger.error(err)
        return {"success": False, "error": err}
    except Exception as e:
        logger.error(f"Email send failed: {e}")
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# WhatsApp sender (Twilio WhatsApp API)
# ─────────────────────────────────────────────────────────────────────────────

def send_whatsapp_reminder(
    to_number: str,
    message:   str,
) -> dict:
    """
    Send a WhatsApp message via Twilio.
    to_number must be in E.164 format e.g. +919876543210
    Returns {"success": bool, "error": str|None}
    """
    twilio_sid   = os.getenv("TWILIO_SID",   "")
    twilio_token = os.getenv("TWILIO_TOKEN",  "")
    twilio_from  = os.getenv("TWILIO_WA_FROM","")  # e.g. whatsapp:+14155238886

    if not twilio_sid or not twilio_token or not twilio_from:
        return {"success": False, "error": "WhatsApp credentials not configured (TWILIO_SID / TWILIO_TOKEN / TWILIO_WA_FROM)"}

    try:
        # Import lazily so the server still starts if twilio isn't installed
        from twilio.rest import Client  # type: ignore
        client = Client(twilio_sid, twilio_token)

        # Ensure to_number is prefixed correctly
        wa_to = to_number if to_number.startswith("whatsapp:") else f"whatsapp:{to_number}"

        msg = client.messages.create(
            body  = message,
            from_ = twilio_from,
            to    = wa_to,
        )
        logger.info(f"WhatsApp reminder sent to {wa_to} | SID: {msg.sid}")
        return {"success": True, "error": None, "sid": msg.sid}

    except ImportError:
        err = "Twilio library not installed. Add 'twilio' to requirements.txt."
        logger.error(err)
        return {"success": False, "error": err}
    except Exception as e:
        logger.error(f"WhatsApp send failed: {e}")
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Message builders — produce consistent reminder text
# ─────────────────────────────────────────────────────────────────────────────

def build_reminder_text(
    company_name: str,
    form:         str,
    form_title:   str,
    due_date:     str,
    days_left:    Optional[int],
    notes:        str = "",
) -> str:
    """Plain-text version of the reminder."""
    urgency = ""
    if days_left is not None:
        if days_left < 0:
            urgency = f"⚠️ OVERDUE by {abs(days_left)} days!"
        elif days_left == 0:
            urgency = "⚠️ DUE TODAY!"
        elif days_left <= 7:
            urgency = f"🔴 URGENT — only {days_left} day(s) left"
        elif days_left <= 30:
            urgency = f"🟡 {days_left} days remaining"
        else:
            urgency = f"🟢 {days_left} days remaining"

    lines = [
        "📋 ROC Compliance Reminder — rocSphere",
        "─" * 40,
        f"Company  : {company_name}",
        f"Form     : {form}  —  {form_title}",
        f"Due Date : {due_date}",
        f"Status   : {urgency}",
    ]
    if notes:
        lines.append(f"Notes    : {notes}")
    lines += [
        "─" * 40,
        "Please ensure timely filing to avoid late fees.",
        "Login to rocSphere to update the filing status.",
        "",
        "This is an automated reminder from rocSphere.",
    ]
    return "\n".join(lines)


def build_reminder_html(
    company_name: str,
    form:         str,
    form_title:   str,
    due_date:     str,
    days_left:    Optional[int],
    notes:        str = "",
) -> str:
    """Rich HTML email version of the reminder."""
    if days_left is not None:
        if days_left < 0:
            badge_color = "#dc2626"
            badge_bg    = "#fef2f2"
            badge_text  = f"OVERDUE by {abs(days_left)} days"
        elif days_left == 0:
            badge_color = "#dc2626"
            badge_bg    = "#fef2f2"
            badge_text  = "DUE TODAY"
        elif days_left <= 7:
            badge_color = "#dc2626"
            badge_bg    = "#fef2f2"
            badge_text  = f"URGENT — {days_left} day(s) left"
        elif days_left <= 30:
            badge_color = "#d97706"
            badge_bg    = "#fffbeb"
            badge_text  = f"{days_left} days remaining"
        else:
            badge_color = "#0d7a70"
            badge_bg    = "#f0fdfa"
            badge_text  = f"{days_left} days remaining"
    else:
        badge_color = "#64748b"
        badge_bg    = "#f1f5f9"
        badge_text  = "Event-based"

    notes_row = f"""
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:12px">Notes</td>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#334155;font-size:12px;font-weight:600">{notes}</td>
        </tr>""" if notes else ""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Inter',Arial,sans-serif">
  <div style="max-width:540px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(13,45,74,.10);border:1px solid #e2e8f0">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1a5f8a,#0d2d4a);padding:24px 28px">
      <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-.5px">
        roc<span style="color:#00b4a6">Sphere</span>
      </div>
      <div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:2px">ROC Compliance Reminder</div>
    </div>

    <!-- Body -->
    <div style="padding:24px 28px">
      <div style="font-size:13px;color:#64748b;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;font-weight:700">Compliance Alert</div>
      <div style="font-size:20px;font-weight:800;color:#0d2d4a;margin-bottom:18px;line-height:1.2">{company_name}</div>

      <!-- Status badge -->
      <div style="background:{badge_bg};border:1px solid {badge_color}30;border-radius:8px;padding:12px 16px;margin-bottom:20px;display:inline-block">
        <span style="color:{badge_color};font-weight:800;font-size:13px">{badge_text}</span>
      </div>

      <!-- Details table -->
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:12px;width:110px">Form</td>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#1a5f8a;font-size:13px;font-weight:800;font-family:monospace">{form}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:12px">Description</td>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#334155;font-size:12px;font-weight:600">{form_title}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:12px">Due Date</td>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#0d2d4a;font-size:13px;font-weight:800">{due_date}</td>
        </tr>
        {notes_row}
      </table>

      <div style="margin-top:22px;background:#f8fafc;border-radius:8px;padding:14px 16px;font-size:11px;color:#64748b;line-height:1.7">
        Please ensure timely filing to avoid late fees and penalties under the Companies Act, 2013.
        Login to <strong style="color:#1a5f8a">rocSphere</strong> to mark the filing as complete once done.
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8">
      This is a manual reminder triggered from rocSphere. Do not reply to this email.
    </div>
  </div>
</body>
</html>"""


def build_whatsapp_message(
    company_name: str,
    form:         str,
    form_title:   str,
    due_date:     str,
    days_left:    Optional[int],
) -> str:
    """Compact WhatsApp message (no HTML)."""
    if days_left is not None:
        if days_left < 0:
            status = f"⚠️ OVERDUE by {abs(days_left)} days"
        elif days_left == 0:
            status = "⚠️ DUE TODAY"
        elif days_left <= 7:
            status = f"🔴 {days_left} day(s) left — URGENT"
        elif days_left <= 30:
            status = f"🟡 {days_left} days left"
        else:
            status = f"🟢 {days_left} days left"
    else:
        status = "Event-based"

    return (
        f"📋 *ROC Compliance Reminder*\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🏢 *{company_name}*\n"
        f"📄 Form: *{form}* — {form_title}\n"
        f"📅 Due: *{due_date}*\n"
        f"⏱ Status: {status}\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"Please file on time to avoid penalties.\n"
        f"— rocSphere Compliance Tracker"
    )
