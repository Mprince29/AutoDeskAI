import sys
import os
from sqlalchemy import text

# Add src to path so we can import auth.database
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

try:
    from auth.database import engine
except ImportError:
    print("Error: Could not import auth.database. Make sure you are running from the backend/src directory or equivalent.")
    sys.exit(1)

def resync_sequences():
    """
    Identifies all auto-incrementing sequences in the public schema
    and resets them to the current MAX(id) of their respective tables.
    """
    # Query to find all columns with a nextval() default (i.e., serial/identity)
    find_sequences_query = text("""
        SELECT 
            table_name, 
            column_name, 
            pg_get_serial_sequence('"' || table_schema || '"."' || table_name || '"', column_name) as sequence_name
        FROM information_schema.columns
        WHERE table_schema = 'public' 
          AND column_default LIKE 'nextval%'
          AND pg_get_serial_sequence('"' || table_schema || '"."' || table_name || '"', column_name) IS NOT NULL;
    """)

    with engine.connect() as conn:
        print("🔍 Searching for out-of-sync sequences...")
        result = conn.execute(find_sequences_query)
        rows = result.all()
        
        if not rows:
            print(" No sequences found to resync.")
            return

        print(f"📊 Found {len(rows)} sequences. Starting resync...")
        
        for table_name, column_name, sequence_name in rows:
            try:
                # Get the current max ID
                max_id_query = text(f'SELECT MAX("{column_name}") FROM "{table_name}"')
                max_id = conn.execute(max_id_query).scalar() or 0
                
                # Resync the sequence
                # We set it to max_id + 1 and is_called = false
                # This ensures the NEXT value returned is max_id + 1
                resync_query = text(f"SELECT setval(:seq, :val, false)")
                conn.execute(resync_query, {"seq": sequence_name, "val": max_id + 1})
                conn.commit()
                print(f"   Table '{table_name}': Set next ID to {max_id + 1} (Current MAX: {max_id})")
            except Exception as e:
                print(f"  ❌ Error resyncing table '{table_name}': {e}")
                conn.rollback()

        print("\n✨ Database sequence resync complete.")

if __name__ == "__main__":
    resync_sequences()
