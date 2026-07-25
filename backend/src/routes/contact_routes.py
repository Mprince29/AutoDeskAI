from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from typing import List
from auth.database import get_db
from auth.routes import get_current_user
from auth.models import User
from models import Contact, ContactCreate, ContactUpdate, ContactResponse
from utils.activity_logger import record_activity
from loguru import logger

router = APIRouter()


def _norm_nickname(raw: str | None) -> str | None:
    """Normalize nickname: strip whitespace, return None for empty strings."""
    if not raw:
        return None
    stripped = raw.strip()
    return stripped or None


@router.get("/search", response_model=List[ContactResponse])
async def search_contacts(
    q: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search contacts by name, email, or nickname (case-insensitive)."""
    pattern = f"%{q}%"
    contacts = (
        db.query(Contact)
        .filter(Contact.user_id == current_user.id)
        .filter(
            Contact.name.ilike(pattern)
            | Contact.email.ilike(pattern)
            | Contact.nickname.ilike(pattern)
            | Contact.company.ilike(pattern)
            | Contact.phone.ilike(pattern)
        )
        .all()
    )
    return contacts


@router.get("/", response_model=List[ContactResponse])
async def list_contacts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all contacts for the current user, ordered by name."""
    return (
        db.query(Contact)
        .filter(Contact.user_id == current_user.id)
        .order_by(Contact.name)
        .all()
    )


@router.post("/", response_model=ContactResponse, status_code=201)
async def create_contact(
    request: Request,
    contact_data: ContactCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new contact. Email must be unique per user."""
    email_normalized = str(contact_data.email).strip().lower()

    existing = db.query(Contact).filter(
        Contact.user_id == current_user.id,
        Contact.email == email_normalized,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="A contact with this email already exists.")

    db_contact = Contact(
        user_id=current_user.id,
        name=contact_data.name.strip(),
        email=email_normalized,
        nickname=_norm_nickname(contact_data.nickname),
        phone=contact_data.phone,
        company=contact_data.company,
        title=contact_data.title,
        notes=contact_data.notes,
        tags=contact_data.tags,
    )
    db.add(db_contact)
    db.commit()
    db.refresh(db_contact)
    
    record_activity(
        db, current_user.email, "create_contact",
        entity_type="contact", entity_id=db_contact.id,
        details={"name": db_contact.name, "email": db_contact.email},
        request=request
    )
    
    return db_contact


@router.put("/{contact_id}", response_model=ContactResponse)
async def update_contact(
    contact_id: int,
    request: Request,
    contact_data: ContactUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Partial update of an existing contact."""
    db_contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.user_id == current_user.id,
    ).first()
    if not db_contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    if contact_data.name is not None:
        db_contact.name = contact_data.name.strip()

    if contact_data.email is not None:
        email_normalized = str(contact_data.email).strip().lower()
        conflict = db.query(Contact).filter(
            Contact.user_id == current_user.id,
            Contact.email == email_normalized,
            Contact.id != contact_id,
        ).first()
        if conflict:
            raise HTTPException(status_code=400, detail="Another contact with this email already exists.")
        db_contact.email = email_normalized

    if contact_data.nickname is not None:
        db_contact.nickname = _norm_nickname(contact_data.nickname)
    if contact_data.phone is not None:
        db_contact.phone = contact_data.phone
    if contact_data.company is not None:
        db_contact.company = contact_data.company
    if contact_data.title is not None:
        db_contact.title = contact_data.title
    if contact_data.notes is not None:
        db_contact.notes = contact_data.notes
    if contact_data.tags is not None:
        db_contact.tags = contact_data.tags

    db.commit()
    db.refresh(db_contact)

    record_activity(
        db, current_user.email, "update_contact",
        entity_type="contact", entity_id=contact_id,
        details=contact_data.model_dump(exclude_unset=True),
        request=request
    )

    return db_contact


@router.delete("/{contact_id}")
async def delete_contact(
    contact_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a contact."""
    db_contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.user_id == current_user.id,
    ).first()
    if not db_contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    db.delete(db_contact)
    db.commit()

    record_activity(
        db, current_user.email, "delete_contact",
        entity_type="contact", entity_id=contact_id,
        details={"name": db_contact.name, "email": db_contact.email},
        request=request
    )

    return {"success": True, "message": "Contact deleted"}
