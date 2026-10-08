"""Idempotent additive migration for deployed pre-timezone databases.

create_all() creates missing tables but never modifies existing ones.
Nullable columns retain historical instants without fabricating a location.
"""
from sqlalchemy import inspect, text

COLUMNS = {
    "events": {"timezone": "VARCHAR(100)"},
    "ticket_sales": {
        "city": "VARCHAR(160)",
        "country": "VARCHAR(8)",
        "timezone": "VARCHAR(100)",
    },
}

def migrate_schedule_columns(engine):
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        for table, columns in COLUMNS.items():
            if table not in tables:
                continue
            known = {column["name"] for column in inspector.get_columns(table)}
            for name, type_sql in columns.items():
                if name in known:
                    continue
                # identifiers and types are fixed literals, never user input.
                if engine.dialect.name == "postgresql":
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {type_sql}"))
                else:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {type_sql}"))
