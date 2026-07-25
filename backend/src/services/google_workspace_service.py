import asyncio
import os
import json
import logging
from typing import Dict, Any, List, Optional, Union
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.auth.exceptions import RefreshError
from googleapiclient.http import MediaIoBaseUpload
import io
from utils.google_api_utils import execute_with_retry, execute_with_retry_async

logger = logging.getLogger(__name__)

class GoogleWorkspaceService:
    """Centralized service for all Google Workspace APIs"""
    
    # Scopes for different Google services
    SCOPES = {
        'docs': ['https://www.googleapis.com/auth/documents'],
        'drive': ['https://www.googleapis.com/auth/drive'],
        'sheets': ['https://www.googleapis.com/auth/spreadsheets'],
        'gmail': ['https://www.googleapis.com/auth/gmail.modify'],
        'calendar': ['https://www.googleapis.com/auth/calendar'],
        'forms': ['https://www.googleapis.com/auth/forms'],
        'slides': ['https://www.googleapis.com/auth/presentations'],
        'tasks': ['https://www.googleapis.com/auth/tasks']
    }
    
    def __init__(self, user_email: str, db_session):
        self.user_email = user_email
        self.db_session = db_session
        self.credentials = None
        self.services = {}
        
    async def get_credentials(self) -> Optional[Credentials]:
        """Get user credentials from existing OAuth tokens in User model"""
        try:
            from auth.models import User
            import os
            from dotenv import load_dotenv
            
            load_dotenv()
            
            # Get user from database
            user = self.db_session.query(User).filter(User.email == self.user_email).first()
            if not user:
                logger.error(f"User not found: {self.user_email}")
                return None
            
            # Check if user has OAuth tokens
            if not user.gmail_access_token and not user.calendar_access_token:
                logger.warning(f"No OAuth tokens found for user: {self.user_email}")
                return None
            
            # Get OAuth credentials from environment variables
            client_id = os.getenv("GOOGLE_CLIENT_ID")
            client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
            
            if not client_id or not client_secret:
                logger.error("Google OAuth credentials not found in environment variables")
                return None
            
            # Import token encryption for decryption
            from utils.token_encryption import token_encryption
            
            # Use Gmail token as primary (it has broader scope)
            access_token = user.gmail_access_token
            refresh_token = user.gmail_refresh_token
            
            if not access_token:
                logger.warning(f"No access token found for user: {self.user_email}")
                return None
            
            # Decrypt the tokens
            try:
                decrypted_access_token = token_encryption.decrypt_token(access_token)
                decrypted_refresh_token = token_encryption.decrypt_token(refresh_token) if refresh_token else None
            except Exception as e:
                logger.error(f"Failed to decrypt tokens: {e}")
                return None
            
            # Create credentials object
            self.credentials = Credentials(
                token=decrypted_access_token,
                refresh_token=decrypted_refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=client_id,
                client_secret=client_secret,
                scopes=[
                    "https://www.googleapis.com/auth/gmail.readonly",
                    "https://www.googleapis.com/auth/gmail.send",
                    "https://www.googleapis.com/auth/gmail.compose",
                    "https://www.googleapis.com/auth/gmail.modify",
                    "https://www.googleapis.com/auth/calendar.readonly",
                    "https://www.googleapis.com/auth/calendar.events",
                    "https://www.googleapis.com/auth/documents",
                    "https://www.googleapis.com/auth/drive",
                    "https://www.googleapis.com/auth/spreadsheets",
                    "https://www.googleapis.com/auth/forms",
                    "https://www.googleapis.com/auth/presentations",
                    "https://www.googleapis.com/auth/tasks"
                ]
            )
            
            # Refresh if expired
            if self.credentials.expired and refresh_token:
                try:
                    self.credentials.refresh(Request())
                    logger.info(f"Refreshed OAuth token for user: {self.user_email}")
                    
                    # Persist the refreshed token back to the database
                    if self.credentials.token:
                        encrypted_access_token = token_encryption.encrypt_token(self.credentials.token)
                        user.gmail_access_token = encrypted_access_token
                        user.calendar_access_token = encrypted_access_token
                        
                    if self.credentials.refresh_token:
                        encrypted_refresh_token = token_encryption.encrypt_token(self.credentials.refresh_token)
                        user.gmail_refresh_token = encrypted_refresh_token
                        user.calendar_refresh_token = encrypted_refresh_token
                        
                    if self.credentials.expiry:
                        user.gmail_token_expires_at = self.credentials.expiry
                        user.calendar_token_expires_at = self.credentials.expiry
                        
                    self.db_session.commit()
                    logger.info(f"Successfully persisted refreshed token to database for user: {self.user_email}")
                except (RefreshError, Exception) as e:
                    logger.error(f"Failed to refresh OAuth token for {self.user_email}: {e}")
                    self.db_session.rollback()
                    return None
            
            return self.credentials
            
        except Exception as e:
            logger.error(f"Error getting credentials: {e}")
            return None
    
    async def get_service(self, service_name: str):
        """Get a Google service client"""
        if service_name not in self.SCOPES:
            raise ValueError(f"Unsupported service: {service_name}")
        
        if service_name not in self.services:
            creds = await self.get_credentials()
            if not creds:
                raise Exception("Failed to get Google credentials")
            
            # Build the service
            if service_name == 'docs':
                self.services[service_name] = build('docs', 'v1', credentials=creds)
            elif service_name == 'drive':
                self.services[service_name] = build('drive', 'v3', credentials=creds)
            elif service_name == 'sheets':
                self.services[service_name] = build('sheets', 'v4', credentials=creds)
            elif service_name == 'gmail':
                self.services[service_name] = build('gmail', 'v1', credentials=creds)
            elif service_name == 'calendar':
                self.services[service_name] = build('calendar', 'v3', credentials=creds)
            elif service_name == 'forms':
                self.services[service_name] = build('forms', 'v1', credentials=creds)
            elif service_name == 'slides':
                self.services[service_name] = build('slides', 'v1', credentials=creds)
            elif service_name == 'tasks':
                self.services[service_name] = build('tasks', 'v1', credentials=creds)
        
        return self.services[service_name]
    
    async def execute_google_operation(self, operation_config: Dict[str, Any]) -> Dict[str, Any]:
        """Execute any Google Workspace operation dynamically"""
        try:
            service_name = operation_config.get("service")
            operation = operation_config.get("operation")
            parameters = operation_config.get("parameters", {})
            
            if not service_name or not operation:
                raise ValueError("Service and operation must be specified")
            
            # Get the service
            service = await self.get_service(service_name)
            
            # Execute the operation dynamically
            result = await self._execute_dynamic_operation(service, operation, parameters)
            
            return {
                "success": True,
                "result": result,
                "service": service_name,
                "operation": operation,
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error executing Google operation: {e}")
            return {
                "success": False,
                "error": str(e),
                "service": operation_config.get("service"),
                "operation": operation_config.get("operation"),
                "timestamp": datetime.now().isoformat()
            }
    
    async def _execute_dynamic_operation(self, service, operation: str, parameters: Dict[str, Any]):
        """Execute an operation on a service dynamically"""
        try:
            # Get the method from the service
            if hasattr(service, operation):
                method = getattr(service, operation)
            else:
                raise AttributeError(f"Operation '{operation}' not found on service")
            
            # Execute the method with parameters (non-blocking)
            if parameters:
                result = await execute_with_retry_async(method(**parameters))
            else:
                result = await execute_with_retry_async(method())
            
            return result
            
        except Exception as e:
            logger.error(f"Error in dynamic operation execution: {e}")
            raise
    
    # Convenience methods for common operations
    async def create_document(self, title: str, content: str, folder_id: str = None) -> Dict[str, Any]:
        """Create a Google Doc"""
        try:
            # Create document
            docs_service = await self.get_service('docs')
            document = {
                'title': title
            }
            doc = await execute_with_retry_async(docs_service.documents().create(body=document))
            doc_id = doc['documentId']
            
            # ── Parse markdown into segments and build rich-formatted Google Doc ──

            def _strip_bold(text: str):
                """Remove **markers**, return (clean_text, [(bold_start, bold_end), ...])."""
                clean, bold_spans, i = "", [], 0
                while i < len(text):
                    if text[i:i+2] == "**":
                        end = text.find("**", i + 2)
                        if end != -1:
                            bs = len(clean)
                            span_text = text[i+2:end]
                            clean += span_text
                            bold_spans.append((bs, bs + len(span_text)))
                            i = end + 2
                            continue
                    clean += text[i]
                    i += 1
                return clean, bold_spans

            # (type, clean_text, bold_spans)
            segments = []
            for line in (content or "").splitlines():
                s = line.strip()
                if not s:
                    segments.append(("blank", "", []))
                    continue
                if s.startswith("### "):
                    c, b = _strip_bold(s[4:])
                    segments.append(("h3", c, b))
                elif s.startswith("## "):
                    c, b = _strip_bold(s[3:])
                    segments.append(("h2", c, b))
                elif s.startswith("# "):
                    c, b = _strip_bold(s[2:])
                    segments.append(("h1", c, b))
                elif s.startswith("- ") or s.startswith("* "):
                    c, b = _strip_bold(s[2:])
                    segments.append(("bullet", c, b))
                elif s.startswith("**") and s.endswith("**") and s.count("**") == 2:
                    segments.append(("h3", s[2:-2], []))
                else:
                    c, b = _strip_bold(s)
                    segments.append(("body", c, b))

            # Build full plain text and track 0-based byte positions
            full_text = ""
            # (type, seg_start, seg_end, clean_text, bold_spans)
            positions = []
            char_offset = 0
            for seg_type, clean_text, bold_spans in segments:
                if seg_type == "blank":
                    full_text += "\n"
                    char_offset += 1
                    continue
                seg_start = char_offset
                seg_end = char_offset + len(clean_text)   # exclusive, before \n
                full_text += clean_text + "\n"
                positions.append((seg_type, seg_start, seg_end, clean_text, bold_spans))
                char_offset = seg_end + 1   # +1 for \n

            # Step 1 - insert all plain text at once
            if not full_text:
                full_text = "\n"

            await execute_with_retry_async(
                docs_service.documents().batchUpdate(
                    documentId=doc_id,
                    body={'requests': [{'insertText': {'location': {'index': 1}, 'text': full_text}}]}
                )
            )

            # Step 2 - build rich-formatting requests
            # Google Docs indices are 1-based; text inserted at index 1
            NAVY  = {"red": 0.07, "green": 0.18, "blue": 0.46}
            SLATE = {"red": 0.10, "green": 0.10, "blue": 0.15}
            WHITE = {"red": 1.0, "green": 1.0, "blue": 1.0}

            fmt_requests = []

            for seg_type, seg_start, seg_end, clean_text, bold_spans in positions:
                gd_start   = 1 + seg_start          # inclusive start
                gd_end     = 1 + seg_end            # exclusive end (before \n)
                gd_para_end = gd_end + 1            # include the \n for paragraph style

                if seg_type == "h1":
                    fmt_requests.append({
                        "updateParagraphStyle": {
                            "range": {"startIndex": gd_start, "endIndex": gd_para_end},
                            "paragraphStyle": {"namedStyleType": "HEADING_1"},
                            "fields": "namedStyleType"
                        }
                    })
                    fmt_requests.append({
                        "updateTextStyle": {
                            "range": {"startIndex": gd_start, "endIndex": gd_end},
                            "textStyle": {
                                "bold": True,
                                "foregroundColor": {"color": {"rgbColor": NAVY}},
                                "fontSize": {"magnitude": 20, "unit": "PT"}
                            },
                            "fields": "bold,foregroundColor,fontSize"
                        }
                    })

                elif seg_type == "h2":
                    fmt_requests.append({
                        "updateParagraphStyle": {
                            "range": {"startIndex": gd_start, "endIndex": gd_para_end},
                            "paragraphStyle": {"namedStyleType": "HEADING_2"},
                            "fields": "namedStyleType"
                        }
                    })
                    fmt_requests.append({
                        "updateTextStyle": {
                            "range": {"startIndex": gd_start, "endIndex": gd_end},
                            "textStyle": {
                                "bold": True,
                                "foregroundColor": {"color": {"rgbColor": NAVY}},
                                "fontSize": {"magnitude": 16, "unit": "PT"}
                            },
                            "fields": "bold,foregroundColor,fontSize"
                        }
                    })

                elif seg_type == "h3":
                    fmt_requests.append({
                        "updateParagraphStyle": {
                            "range": {"startIndex": gd_start, "endIndex": gd_para_end},
                            "paragraphStyle": {"namedStyleType": "HEADING_3"},
                            "fields": "namedStyleType"
                        }
                    })
                    fmt_requests.append({
                        "updateTextStyle": {
                            "range": {"startIndex": gd_start, "endIndex": gd_end},
                            "textStyle": {
                                "bold": True,
                                "foregroundColor": {"color": {"rgbColor": {"red": 0.22, "green": 0.35, "blue": 0.55}}},
                                "fontSize": {"magnitude": 13, "unit": "PT"}
                            },
                            "fields": "bold,foregroundColor,fontSize"
                        }
                    })

                elif seg_type == "bullet":
                    fmt_requests.append({
                        "createParagraphBullets": {
                            "range": {"startIndex": gd_start, "endIndex": gd_para_end},
                            "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE"
                        }
                    })
                    fmt_requests.append({
                        "updateTextStyle": {
                            "range": {"startIndex": gd_start, "endIndex": gd_end},
                            "textStyle": {
                                "foregroundColor": {"color": {"rgbColor": SLATE}},
                                "fontSize": {"magnitude": 11, "unit": "PT"}
                            },
                            "fields": "foregroundColor,fontSize"
                        }
                    })

                else:  # body
                    fmt_requests.append({
                        "updateTextStyle": {
                            "range": {"startIndex": gd_start, "endIndex": gd_end},
                            "textStyle": {
                                "foregroundColor": {"color": {"rgbColor": SLATE}},
                                "fontSize": {"magnitude": 11, "unit": "PT"}
                            },
                            "fields": "foregroundColor,fontSize"
                        }
                    })

                # Inline bold spans
                for bs, be in bold_spans:
                    if bs < be:
                        fmt_requests.append({
                            "updateTextStyle": {
                                "range": {
                                    "startIndex": gd_start + bs,
                                    "endIndex": gd_start + be
                                },
                                "textStyle": {"bold": True},
                                "fields": "bold"
                            }
                        })

            if fmt_requests:
                await execute_with_retry_async(
                    docs_service.documents().batchUpdate(
                        documentId=doc_id,
                        body={'requests': fmt_requests}
                    )
                )
            
            # Ensure folder exists and move file
            drive_service = await self.get_service('drive')
            target_folder_id = folder_id
            if not target_folder_id:
                # Auto-create or find a default folder idempotently
                folder_result = await self.create_folder('CoderDOC Outputs')
                if not folder_result.get('success'):
                    raise Exception(f"Failed to create or find folder: {folder_result.get('error')}")
                target_folder_id = folder_result['folder_id']
                
            # Move to folder
            await execute_with_retry_async(
                drive_service.files().update(
                    fileId=doc_id,
                    addParents=target_folder_id,
                    removeParents='root'
                )
            )
            
            # Get shareable link and verify file exists
            try:
                file_metadata = await execute_with_retry_async(
                    drive_service.files().get(
                        fileId=doc_id,
                        fields='webViewLink,id,name,owners,permissions'
                    )
                )
                
                logger.info(
                    f"Document created successfully: {doc_id} | "
                    f"Title: {title} | "
                    f"WebViewLink: {file_metadata.get('webViewLink')}"
                )
                
                return {
                    "success": True,
                    "document_id": doc_id,
                    "title": title,
                    "web_view_link": file_metadata.get('webViewLink'),
                    "file_id": doc_id,
                    "folder_id": target_folder_id
                }
            except HttpError as metadata_error:
                # Even if metadata retrieval fails, the file was created
                logger.warning(
                    f"Document created but metadata retrieval failed: {doc_id} | "
                    f"Error: {metadata_error}"
                )
                return {
                    "success": True,
                    "document_id": doc_id,
                    "title": title,
                    "file_id": doc_id,
                    "folder_id": target_folder_id,
                    "warning": f"File created but metadata unavailable: {str(metadata_error)}"
                }
            
        except HttpError as error:
            logger.error(f"Google API Error creating document: {error}")
            return {
                "success": False,
                "error": f"Google API Error: {str(error)}"
            }
        except Exception as e:
            logger.error(f"Error creating document: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def create_folder(self, name: str, parent_folder_id: str = None) -> Dict[str, Any]:
        """Create a Google Drive folder idempotently"""
        try:
            drive_service = await self.get_service('drive')
            
            # Idempotency check: Search for existing folder
            query = f"name='{name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
            if parent_folder_id:
                query += f" and '{parent_folder_id}' in parents"
                
            response = await execute_with_retry_async(drive_service.files().list(q=query, spaces='drive', fields='files(id, name, webViewLink)'))
            files = response.get('files', [])
            
            if files:
                logger.info(f"Directory '{name}' already exists with ID: {files[0]['id']}")
                return {
                    "success": True,
                    "folder_id": files[0]['id'],
                    "name": files[0]['name'],
                    "web_view_link": files[0].get('webViewLink')
                }
                
            folder_metadata = {
                'name': name,
                'mimeType': 'application/vnd.google-apps.folder'
            }
            
            if parent_folder_id:
                folder_metadata['parents'] = [parent_folder_id]
            
            folder = await execute_with_retry_async(
                drive_service.files().create(
                    body=folder_metadata,
                    fields='id,name,webViewLink'
                )
            )
            
            return {
                "success": True,
                "folder_id": folder['id'],
                "name": folder['name'],
                "web_view_link": folder.get('webViewLink')
            }
            
        except HttpError as error:
            logger.error(f"Google API Error creating folder: {error}")
            return {
                "success": False,
                "error": f"Google API Error: {str(error)}"
            }
        except Exception as e:
            logger.error(f"Error creating folder: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def share_file(self, file_id: str, user_email: str, permission: str = 'reader') -> Dict[str, Any]:
        """Share a file with a user"""
        try:
            drive_service = await self.get_service('drive')
            
            user_permission = {
                'type': 'user',
                'role': permission,
                'emailAddress': user_email
            }
            
            await execute_with_retry_async(
                drive_service.permissions().create(
                    fileId=file_id,
                    body=user_permission,
                    fields='id'
                )
            )
            
            return {
                "success": True,
                "file_id": file_id,
                "shared_with": user_email,
                "permission": permission
            }
            
        except HttpError as error:
            logger.error(f"Google API Error sharing file: {error}")
            return {
                "success": False,
                "error": f"Google API Error: {str(error)}"
            }
        except Exception as e:
            logger.error(f"Error sharing file: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def get_file_info(self, file_id: str) -> Dict[str, Any]:
        """Get file information"""
        try:
            drive_service = await self.get_service('drive')
            
            file_metadata = await execute_with_retry_async(
                drive_service.files().get(
                    fileId=file_id,
                    fields='id,name,mimeType,webViewLink,createdTime,modifiedTime,size'
                )
            )
            
            return {
                "success": True,
                "file_info": file_metadata
            }
            
        except HttpError as error:
            logger.error(f"Google API Error getting file info: {error}")
            return {
                "success": False,
                "error": f"Google API Error: {str(error)}"
            }
        except Exception as e:
            logger.error(f"Error getting file info: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def search_drive_files(self, name_query: str, max_results: int = 10) -> Dict[str, Any]:
        """Search Google Drive files by name (partial match, case-insensitive)."""
        try:
            drive_service = await self.get_service('drive')
            # Drive API 'name contains' is case-insensitive substring match
            q = f"name contains '{name_query}' and trashed=false"
            response = await execute_with_retry_async(
                drive_service.files().list(
                    q=q,
                    spaces='drive',
                    fields='files(id,name,mimeType,webViewLink,modifiedTime)',
                    pageSize=max_results,
                    orderBy='modifiedTime desc',
                )
            )
            files = response.get('files', [])
            return {"success": True, "files": files, "total": len(files)}
        except Exception as e:
            logger.error(f"Error searching Drive files: {e}")
            return {"success": False, "error": str(e), "files": []}

    async def duplicate_file(self, file_id: str = None, file_name: str = None, new_name: str = None, folder_id: str = None) -> Dict[str, Any]:
        """Duplicate a Google Drive file. Accepts file_id OR file_name (searches by name if ID unknown)."""
        try:
            drive_service = await self.get_service('drive')

            # Resolve file_id from name if not provided
            if not file_id and file_name:
                search = await self.search_drive_files(file_name, max_results=5)
                matches = search.get('files', [])
                if not matches:
                    return {"success": False, "error": f"No file found with name containing '{file_name}'. Try a different name."}
                # Pick best match: exact name first, then first result
                exact = next((f for f in matches if f['name'].lower() == file_name.lower()), None)
                chosen = exact or matches[0]
                file_id = chosen['id']
                logger.info(f"Resolved file name '{file_name}' → ID {file_id} ('{chosen['name']}')")
            
            # Get original file metadata
            original_file = await execute_with_retry_async(
                drive_service.files().get(
                    fileId=file_id,
                    fields='id,name,mimeType,parents'
                )
            )
            
            # Prepare copy metadata
            copy_body = {
                'name': new_name or f"{original_file['name']} (Copy)"
            }
            
            # Set parent folder if provided, otherwise use original's parent
            if folder_id:
                copy_body['parents'] = [folder_id]
            elif 'parents' in original_file:
                copy_body['parents'] = original_file['parents']
            
            # Copy the file
            copied_file = await execute_with_retry_async(
                drive_service.files().copy(
                    fileId=file_id,
                    body=copy_body,
                    fields='id,name,webViewLink,mimeType'
                )
            )
            
            return {
                "success": True,
                "file_id": copied_file['id'],
                "name": copied_file['name'],
                "mime_type": copied_file.get('mimeType'),
                "web_view_link": copied_file.get('webViewLink')
            }
            
        except HttpError as error:
            logger.error(f"Google API Error duplicating file: {error}")
            return {
                "success": False,
                "error": f"Google API Error: {str(error)}"
            }
        except Exception as e:
            logger.error(f"Error duplicating file: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def list_docs(self, max_results: int = 50) -> Dict[str, Any]:
        """List Google Docs for the user."""
        try:
            drive_service = await self.get_service('drive')
            # Mime type for Google Docs
            q = "mimeType='application/vnd.google-apps.document' and trashed=false"
            response = await execute_with_retry_async(
                drive_service.files().list(
                    q=q,
                    spaces='drive',
                    fields='files(id, name, webViewLink, modifiedTime, iconLink, thumbnailLink)',
                    pageSize=max_results,
                    orderBy='modifiedTime desc'
                )
            )
            files = response.get('files', [])
            return {"success": True, "documents": files}
        except Exception as e:
            logger.error(f"Error listing Google Docs: {e}")
            return {"success": False, "error": str(e)}

    async def list_sheets(self, max_results: int = 50) -> Dict[str, Any]:
        """List Google Sheets for the user."""
        try:
            drive_service = await self.get_service('drive')
            q = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
            response = await execute_with_retry_async(
                drive_service.files().list(
                    q=q,
                    spaces='drive',
                    fields='files(id, name, webViewLink, modifiedTime, iconLink, thumbnailLink)',
                    pageSize=max_results,
                    orderBy='modifiedTime desc'
                )
            )
            return {"success": True, "files": response.get('files', [])}
        except Exception as e:
            logger.error(f"Error listing Google Sheets: {e}")
            return {"success": False, "error": str(e)}

    async def list_slides(self, max_results: int = 50) -> Dict[str, Any]:
        """List Google Slides for the user."""
        try:
            drive_service = await self.get_service('drive')
            q = "mimeType='application/vnd.google-apps.presentation' and trashed=false"
            response = await execute_with_retry_async(
                drive_service.files().list(
                    q=q,
                    spaces='drive',
                    fields='files(id, name, webViewLink, modifiedTime, iconLink, thumbnailLink)',
                    pageSize=max_results,
                    orderBy='modifiedTime desc'
                )
            )
            return {"success": True, "files": response.get('files', [])}
        except Exception as e:
            logger.error(f"Error listing Google Slides: {e}")
            return {"success": False, "error": str(e)}

    async def list_forms(self, max_results: int = 50) -> Dict[str, Any]:
        """List Google Forms for the user."""
        try:
            drive_service = await self.get_service('drive')
            q = "mimeType='application/vnd.google-apps.form' and trashed=false"
            response = await execute_with_retry_async(
                drive_service.files().list(
                    q=q,
                    spaces='drive',
                    fields='files(id, name, webViewLink, modifiedTime, iconLink, thumbnailLink)',
                    pageSize=max_results,
                    orderBy='modifiedTime desc'
                )
            )
            return {"success": True, "files": response.get('files', [])}
        except Exception as e:
            logger.error(f"Error listing Google Forms: {e}")
            return {"success": False, "error": str(e)}

    async def list_tasks(self, max_results: int = 50) -> Dict[str, Any]:
        """List Google Tasks for the user."""
        try:
            tasks_service = await self.get_service('tasks')
            # Fetch default task list
            lists_response = await asyncio.to_thread(tasks_service.tasklists().list().execute)
            tasklists = lists_response.get('items', [])
            if not tasklists:
                return {"success": True, "tasks": []}
            
            # Fetch tasks from the first list
            tasks_response = await execute_with_retry_async(
                tasks_service.tasks().list(tasklist=tasklists[0]['id'], maxResults=max_results)
            )
            return {"success": True, "tasks": tasks_response.get('items', [])}
        except Exception as e:
            logger.error(f"Error listing Google Tasks: {e}")
            return {"success": False, "error": str(e)}

    async def update_task(self, task_id: str, title: str = None, notes: str = None, status: str = None, tasklist_id: str = "@default") -> Dict[str, Any]:
        """Update a Google Task."""
        try:
            tasks_service = await self.get_service('tasks')
            
            if tasklist_id == "@default":
                lists_response = await execute_with_retry_async(tasks_service.tasklists().list())
                tasklists = lists_response.get('items', [])
                if not tasklists:
                    return {"success": False, "error": "No task lists found"}
                tasklist_id = tasklists[0]['id']

            # Get existing task
            task = await execute_with_retry_async(
                tasks_service.tasks().get(tasklist=tasklist_id, task=task_id)
            )
            
            if title is not None:
                task['title'] = title
            if notes is not None:
                task['notes'] = notes
            if status is not None:
                task['status'] = status
                
            updated_task = await execute_with_retry_async(
                tasks_service.tasks().update(tasklist=tasklist_id, task=task_id, body=task)
            )
            return {"success": True, "task": updated_task}
        except Exception as e:
            logger.error(f"Error updating Google Task: {e}")
            return {"success": False, "error": str(e)}

    async def list_files(self, q: str = None, max_results: int = 50) -> Dict[str, Any]:
        """List any files in Google Drive with optional query."""
        try:
            drive_service = await self.get_service('drive')
            query = q or "trashed=false"
            response = await execute_with_retry_async(
                drive_service.files().list(
                    q=query,
                    spaces='drive',
                    fields='files(id, name, mimeType, webViewLink, modifiedTime, iconLink)',
                    pageSize=max_results,
                    orderBy='modifiedTime desc'
                )
            )
            files = response.get('files', [])
            return {"success": True, "files": files}
        except Exception as e:
            logger.error(f"Error listing Drive files: {e}")
            return {"success": False, "error": str(e)}
