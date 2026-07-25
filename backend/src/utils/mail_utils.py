import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from loguru import logger

def send_system_email(recipient_email: str, subject: str, body_html: str, body_text: str = None):
    """
    Send a system email (OTP, notifications) via SMTP.
    If SMTP env vars are missing, it logs the email to stdout as a fallback for development.
    """
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    sender_email = os.environ.get("SMTP_FROM", smtp_user or "noreply@autodeskai.ai")

    if not smtp_host or not smtp_user or not smtp_pass:
        logger.warning(f"--- MOCK EMAIL START ---")
        logger.warning(f"To: {recipient_email}")
        logger.warning(f"Subject: {subject}")
        logger.warning(f"Body: {body_text or 'HTML Content Sent'}")
        if "OTP" in subject:
             logger.warning(f"DEV HINT: Search logs for your code above.")
        logger.warning(f"--- MOCK EMAIL END ---")
        return True

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"AutoDeskAI <{sender_email}>"
        msg["To"] = recipient_email

        if body_text:
            msg.attach(MIMEText(body_text, "plain"))
        msg.attach(MIMEText(body_html, "html"))

        # Port 465 usually requires SMTP_SSL, while 587/25 use STARTTLS
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
        else:
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                if smtp_port == 587:
                    server.starttls()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
        
        logger.info(f"System email sent to {recipient_email}: {subject}")
        return True
    except Exception as e:
        logger.error(f"Failed to send system email to {recipient_email}: {e}")
        return False

def send_otp_email(recipient_email: str, otp: str):
    """Specific helper for sending password reset OTPs."""
    subject = f"{otp} is your AutoDeskAI verification code"
    
    html = f"""
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #111;">Password Reset</h2>
        <p>You requested a password reset for your AutoDeskAI account.</p>
        <div style="background: #f9f9f9; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #000;">{otp}</span>
        </div>
        <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">AutoDeskAI AI Team</p>
    </div>
    """
    
    text = f"Your AutoDeskAI verification code is: {otp}. This code expires in 10 minutes."
    
    return send_system_email(recipient_email, subject, html, text)
