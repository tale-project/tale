"""Kuzu database connection and operations."""

import json
from datetime import date, datetime, time, timedelta
from typing import Any

import kuzu
from loguru import logger

from .config import settings


class DateTimeEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles datetime objects."""

    def default(self, obj: Any) -> Any:
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, date):
            return obj.isoformat()
        if isinstance(obj, time):
            return obj.isoformat()
        if isinstance(obj, timedelta):
            return obj.total_seconds()
        return super().default(obj)


class KuzuDatabase:
    """Kuzu database wrapper."""

    def __init__(self):
        self.db = None
        self.conn = None

    def connect(self):
        """Initialize the database connection."""
        logger.info(f"Connecting to Kuzu database at {settings.database_path}")
        self.db = kuzu.Database(settings.database_path)
        self.conn = kuzu.Connection(self.db)
        logger.info("Kuzu database connected successfully")

    def close(self):
        """Close the database connection."""
        if self.conn:
            self.conn = None
        if self.db:
            self.db = None
        logger.info("Kuzu database connection closed")

    def execute(self, query: str, parameters: dict[str, Any] | None = None) -> list[list[Any]]:
        """Execute a Cypher query and return results.

        Args:
            query: Cypher query string
            parameters: Optional query parameters

        Returns:
            List of rows, where each row is a list of values
        """
        if not self.conn:
            raise RuntimeError("Database not connected")

        try:
            if parameters:
                result = self.conn.execute(query, parameters)
            else:
                result = self.conn.execute(query)

            rows = []
            while result.has_next():
                row = result.get_next()
                processed_row = []
                for val in row:
                    processed_row.append(self._process_value(val))
                rows.append(processed_row)

            return rows
        except Exception as e:
            logger.error(f"Query execution failed: {e}")
            logger.error(f"Query: {query}")
            logger.error(f"Parameters: {parameters}")
            raise

    def _process_value(self, val: Any) -> Any:
        """Process a value from Kuzu result.

        Handles datetime objects and nested structures to ensure JSON serialization.
        """
        if val is None:
            return None
        # Handle datetime types
        if isinstance(val, datetime):
            return val.isoformat()
        if isinstance(val, date):
            return val.isoformat()
        if isinstance(val, time):
            return val.isoformat()
        if isinstance(val, timedelta):
            return val.total_seconds()
        # Handle lists recursively
        if isinstance(val, list):
            return [self._process_value(item) for item in val]
        # Handle dicts
        if isinstance(val, dict):
            # Handle node/relationship objects
            if "_id" in val or "_label" in val:
                properties = {k: self._process_value(v) for k, v in val.items() if not k.startswith("_")}
                # Use the node's 'id' property (UUID) instead of Kuzu's internal offset.
                # Cognee uses UUID strings for node lookups (e.g., WHERE n.id = $id).
                node_id = properties.get("id") or self._get_internal_offset(val)
                return {
                    "id": node_id,
                    "label": val.get("_label"),
                    "properties": json.dumps(properties, cls=DateTimeEncoder),
                }
            # Process regular dicts recursively
            return {k: self._process_value(v) for k, v in val.items()}
        return val

    def _get_internal_offset(self, val: dict) -> Any:
        """Extract Kuzu's internal offset from a node/relationship dict."""
        internal_id = val.get("_id")
        if isinstance(internal_id, dict):
            return internal_id.get("offset")
        return internal_id


# Global database instance
db = KuzuDatabase()

