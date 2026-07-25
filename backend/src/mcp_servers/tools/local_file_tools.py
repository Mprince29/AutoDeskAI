import os
import csv
from pathlib import Path
from typing import Dict, Any, List

# Try imports for advanced file parsing, fall back gracefully if missing
try:
    import PyPDF2
    HAS_PDF = True
except ImportError:
    HAS_PDF = False

try:
    import docx
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False

def read_uploaded_document(doc_id: str, file_path_hint: str = None) -> Dict[str, Any]:
    """
    Reads and extracts text from a user-uploaded document on the server.
    Supported types: .txt, .csv, .pdf, .docx
    
    Args:
        doc_id: The unique ID associated with the filename (from the /api/documents list)
        file_path_hint: An optional explicit path to the file
    """
    # Resolve the physical path
    # If the hint isn't passed, we search the uploads folder for a file matching the doc_id prefix
    upload_dir = Path(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))) / "uploads"
    
    target_path = None
    if file_path_hint and os.path.exists(file_path_hint):
        target_path = Path(file_path_hint)
    else:
        # Search for file starting with `doc_id`
        if upload_dir.exists():
            for f in upload_dir.iterdir():
                if f.name.startswith(doc_id):
                    target_path = f
                    break
                    
    if not target_path or not target_path.exists():
        return {"error": f"Document ID '{doc_id}' not found on server."}

    ext = target_path.suffix.lower()
    
    try:
        content = ""
        
        if ext == ".txt":
            with open(target_path, "r", encoding="utf-8") as f:
                content = f.read()
                
        elif ext == ".csv":
            with open(target_path, "r", encoding="utf-8") as f:
                reader = csv.reader(f)
                rows = list(reader)
                if len(rows) > 500:
                    rows = rows[:500]
                    content += "[WARNING: Truncated to 500 rows for context length]\\n"
                
                content += "\\n".join([",".join(row) for row in rows])
                
        elif ext == ".pdf":
            if not HAS_PDF:
                return {"error": "PyPDF2 is not installed. Cannot parse PDF."}
            with open(target_path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                num_pages = len(reader.pages)
                # Hard limit to 20 pages to avoid killing context window
                for i in range(min(num_pages, 20)):
                    page = reader.pages[i]
                    content += f"\\n--- PAGE {i+1} ---\\n{page.extract_text()}"
                if num_pages > 20:
                    content += "\\n[WARNING: Truncated to first 20 pages]"
        
        elif ext == ".docx":
            if not HAS_DOCX:
                return {"error": "python-docx is not installed. Cannot parse DOCX."}
            doc = docx.Document(target_path)
            content = "\\n".join([para.text for para in doc.paragraphs])
            
        else:
            return {"error": f"Extraction for extension '{ext}' is not supported yet."}
            
        return {
            "success": True, 
            "filename": target_path.name,
            "char_count": len(content),
            "content": content
        }
        
    except Exception as e:
        return {"error": f"Failed to parse document: {str(e)}"}
