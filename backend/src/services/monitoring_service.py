import asyncio
from loguru import logger
from sqlalchemy.orm import Session
from mcp_servers.core.google_auth import GoogleAuthManager
from auth.models import User
import os

class MonitoringService:
    """Manages real-time Gmail inbox monitoring (Push Notifications via Pub/Sub)."""

    PUB_SUB_TOPIC = os.getenv("GMAIL_PUB_SUB_TOPIC", "projects/autodeskai-483908/topics/gmail-notifications")

    @staticmethod
    async def start_monitoring(user_email: str, db: Session) -> bool:
        """Register a Gmail watch for the user's inbox."""
        try:
            user = db.query(User).filter(User.email == user_email).first()
            if not user:
                logger.error(f"Monitoring: user {user_email} not found")
                return False

            # Get Gmail service
            service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", user_email)
            
            # Register watch
            # labelIds=["INBOX"] means we only get notified for new mail in the inbox
            request = {
                "labelIds": ["INBOX"],
                "topicName": MonitoringService.PUB_SUB_TOPIC
            }
            
            watch_resp = await asyncio.to_thread(
                service.users().watch(userId="me", body=request).execute
            )
            
            logger.info(f"Monitoring: started for {user_email}. HistoryId: {watch_resp.get('historyId')}")
            
            # Update user state
            user.is_monitoring = True
            db.commit()
            return True

        except Exception as e:
            logger.error(f"Monitoring: failed to start for {user_email}: {e}")
            return False

    @staticmethod
    async def stop_monitoring(user_email: str, db: Session) -> bool:
        """Stop Gmail watch for the user's inbox."""
        try:
            user = db.query(User).filter(User.email == user_email).first()
            if not user:
                return False

            service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", user_email)
            
            await asyncio.to_thread(
                service.users().stop(userId="me").execute
            )
            
            logger.info(f"Monitoring: stopped for {user_email}")
            
            user.is_monitoring = False
            db.commit()
            return True

        except Exception as e:
            logger.error(f"Monitoring: failed to stop for {user_email}: {e}")
            return False

monitoring_service = MonitoringService()
