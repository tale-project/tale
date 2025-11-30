"""Kuzu database connection and operations."""

import json
import kuzu
from typing import Any
from loguru import logger

from .config import settings


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
        """Process a value from Kuzu result."""
        if val is None:
            return None
        if isinstance(val, dict):
            # Handle node/relationship objects
            if "_id" in val or "_label" in val:
                return {
                    "id": val.get("_id", {}).get("offset") if isinstance(val.get("_id"), dict) else val.get("_id"),
                    "label": val.get("_label"),
                    "properties": json.dumps({k: v for k, v in val.items() if not k.startswith("_")}),
                }
            return val
        return val


# Global database instance
db = KuzuDatabase()

