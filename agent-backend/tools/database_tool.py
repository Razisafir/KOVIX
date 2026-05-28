"""Database Tool — query SQLite, PostgreSQL, and MySQL databases.

Features: connect, query, get schema, list tables, close.
Auto-detects database type from connection string.
"""

from __future__ import annotations

import logging
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Optional database drivers — gracefully degrade if not installed
try:
    import psycopg2
    from psycopg2 import extras as psycopg2_extras

    HAS_POSTGRES = True
except ImportError:
    HAS_POSTGRES = False

try:
    import pymysql

    HAS_MYSQL = True
except ImportError:
    HAS_MYSQL = False


@dataclass
class QueryResult:
    """Structured result from a database query.

    Attributes
    ----------
    columns:
        Column names from the query result.
    rows:
        Result rows as tuples.
    row_count:
        Number of rows returned.
    duration_ms:
        Query execution time in milliseconds.
    error:
        Error message if the query failed, otherwise *None*.
    """

    columns: List[str]
    rows: List[tuple]
    row_count: int
    duration_ms: float
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert the result to a dictionary suitable for JSON serialization."""
        return {
            "columns": self.columns,
            "rows": [list(row) for row in self.rows],
            "row_count": self.row_count,
            "duration_ms": round(self.duration_ms, 2),
            "error": self.error,
        }


class DatabaseTool:
    """Database interface supporting SQLite, PostgreSQL, and MySQL.

    Provides a unified interface for executing queries and introspecting
    schemas across three popular database engines. Connection state is
    tracked internally; only one active connection is maintained at a time.
    """

    def __init__(self) -> None:
        self._connection: Optional[Any] = None
        self._db_type: Optional[str] = None

    def connect_sqlite(self, path: str) -> bool:
        """Connect to a SQLite database file.

        Parameters
        ----------
        path:
            Absolute or relative path to the ``.db`` / ``.sqlite`` file.
            Use ``:memory:`` for an in-memory database.

        Returns
        -------
        bool
            *True* if the connection succeeded.
        """
        try:
            self.close()
            self._connection = sqlite3.connect(path, check_same_thread=False)
            self._connection.row_factory = sqlite3.Row
            self._db_type = "sqlite"
            logger.info("Connected to SQLite database: %s", path)
            return True
        except sqlite3.Error as exc:
            logger.error("SQLite connection failed: %s", exc)
            self._connection = None
            return False

    def connect_postgres(
        self,
        host: str,
        database: str,
        user: str,
        password: str,
        port: int = 5432,
    ) -> bool:
        """Connect to a PostgreSQL database.

        Parameters
        ----------
        host:
            Database server hostname or IP address.
        database:
            Name of the database to connect to.
        user:
            Database username.
        password:
            Database password.
        port:
            TCP port (default 5432).

        Returns
        -------
        bool
            *True* if the connection succeeded.

        Raises
        ------
        RuntimeError
            If ``psycopg2`` is not installed.
        """
        if not HAS_POSTGRES:
            raise RuntimeError(
                "psycopg2 not installed: pip install psycopg2-binary"
            )
        try:
            self.close()
            self._connection = psycopg2.connect(
                host=host,
                database=database,
                user=user,
                password=password,
                port=port,
            )
            self._db_type = "postgresql"
            logger.info("Connected to PostgreSQL: %s@%s/%s", user, host, database)
            return True
        except psycopg2.Error as exc:
            logger.error("PostgreSQL connection failed: %s", exc)
            self._connection = None
            return False

    def connect_mysql(
        self,
        host: str,
        database: str,
        user: str,
        password: str,
        port: int = 3306,
    ) -> bool:
        """Connect to a MySQL database.

        Parameters
        ----------
        host:
            Database server hostname or IP address.
        database:
            Name of the database/schema to connect to.
        user:
            Database username.
        password:
            Database password.
        port:
            TCP port (default 3306).

        Returns
        -------
        bool
            *True* if the connection succeeded.

        Raises
        ------
        RuntimeError
            If ``pymysql`` is not installed.
        """
        if not HAS_MYSQL:
            raise RuntimeError("pymysql not installed: pip install pymysql")
        try:
            self.close()
            self._connection = pymysql.connect(
                host=host,
                database=database,
                user=user,
                password=password,
                port=port,
                cursorclass=pymysql.cursors.DictCursor,
            )
            self._db_type = "mysql"
            logger.info("Connected to MySQL: %s@%s/%s", user, host, database)
            return True
        except pymysql.Error as exc:
            logger.error("MySQL connection failed: %s", exc)
            self._connection = None
            return False

    def query(self, sql: str, params: Optional[tuple] = None) -> QueryResult:
        """Execute a SQL query and return structured results.

        Automatically detects whether the query is a SELECT (returns rows)
        or a mutating statement (returns row count).

        Parameters
        ----------
        sql:
            SQL query string. Use ``%s`` or ``?`` placeholders for parameters.
        params:
            Tuple of parameter values to safely interpolate.

        Returns
        -------
        QueryResult
            Structured result with columns, rows, timing, and any error.
        """
        if self._connection is None:
            return QueryResult(
                columns=[], rows=[], row_count=0, duration_ms=0.0,
                error="Not connected to any database",
            )

        start = time.perf_counter()
        try:
            is_select = sql.strip().lower().startswith("select")

            if self._db_type == "sqlite":
                cursor = self._connection.execute(sql, params or ())
                columns = [d[0] for d in cursor.description] if cursor.description else []
                rows = cursor.fetchall() if is_select else []
                row_count = len(rows) if is_select else cursor.rowcount
                self._connection.commit()

            elif self._db_type == "postgresql":
                cursor = self._connection.cursor()
                cursor.execute(sql, params or ())
                columns = [desc[0] for desc in cursor.description] if cursor.description else []
                rows = cursor.fetchall() if is_select else []
                row_count = len(rows) if is_select else cursor.rowcount
                self._connection.commit()
                cursor.close()

            elif self._db_type == "mysql":
                cursor = self._connection.cursor()
                cursor.execute(sql, params or ())
                if cursor.description:
                    columns = [desc[0] for desc in cursor.description]
                    rows_data = cursor.fetchall()
                    rows = [tuple(row.values()) for row in rows_data] if rows_data else []
                else:
                    columns = []
                    rows = []
                row_count = len(rows) if is_select else cursor.rowcount
                self._connection.commit()
                cursor.close()
            else:
                return QueryResult(
                    columns=[], rows=[], row_count=0, duration_ms=0.0,
                    error=f"Unknown database type: {self._db_type}",
                )

            duration = (time.perf_counter() - start) * 1000
            logger.info(
                "Query executed in %.1fms (%d rows, %d cols)",
                duration, row_count, len(columns),
            )
            return QueryResult(
                columns=columns, rows=rows, row_count=row_count, duration_ms=duration
            )

        except Exception as exc:
            duration = (time.perf_counter() - start) * 1000
            logger.exception("Query failed: %s", sql[:200])
            return QueryResult(
                columns=[], rows=[], row_count=0, duration_ms=duration,
                error=f"Query failed: {exc}",
            )

    def get_schema(self, table: str) -> Dict[str, Any]:
        """Get the schema for a table.

        Uses ``PRAGMA`` for SQLite and ``INFORMATION_SCHEMA`` for
        PostgreSQL and MySQL.

        Parameters
        ----------
        table:
            Name of the table to describe.

        Returns
        -------
        dict
            Contains ``success``, ``table``, ``columns``, and ``error``.
        """
        if self._connection is None:
            return {"success": False, "table": table, "columns": [], "error": "Not connected"}

        try:
            columns: List[Dict[str, Any]] = []

            if self._db_type == "sqlite":
                cursor = self._connection.execute(f'PRAGMA table_info("{table}")')
                for row in cursor.fetchall():
                    columns.append(
                        {
                            "name": row["name"],
                            "type": row["type"],
                            "nullable": not row["notnull"],
                            "default": row["dflt_value"],
                            "primary_key": bool(row["pk"]),
                        }
                    )

            elif self._db_type == "postgresql":
                sql = """
                    SELECT column_name, data_type, is_nullable, column_default
                    FROM information_schema.columns
                    WHERE table_name = %s
                    ORDER BY ordinal_position
                """
                result = self.query(sql, (table,))
                for row in result.rows:
                    columns.append(
                        {
                            "name": row[0],
                            "type": row[1],
                            "nullable": row[2] == "YES",
                            "default": row[3],
                            "primary_key": False,
                        }
                    )

            elif self._db_type == "mysql":
                sql = """
                    SELECT column_name, data_type, is_nullable, column_default, column_key
                    FROM information_schema.columns
                    WHERE table_name = %s AND table_schema = DATABASE()
                    ORDER BY ordinal_position
                """
                result = self.query(sql, (table,))
                for row in result.rows:
                    columns.append(
                        {
                            "name": row[0],
                            "type": row[1],
                            "nullable": row[2] == "YES",
                            "default": row[3],
                            "primary_key": row[4] == "PRI" if row[4] else False,
                        }
                    )

            logger.info("Schema retrieved for table '%s' (%d columns)", table, len(columns))
            return {"success": True, "table": table, "columns": columns}

        except Exception as exc:
            logger.exception("get_schema failed for '%s'", table)
            return {"success": False, "table": table, "columns": [], "error": str(exc)}

    def list_tables(self) -> List[str]:
        """List all tables in the current database.

        Returns
        -------
        list[str]
            Sorted list of table names. Returns an empty list on error.
        """
        if self._connection is None:
            logger.warning("list_tables called but not connected")
            return []

        try:
            if self._db_type == "sqlite":
                result = self.query(
                    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
                )
                tables = [row[0] for row in result.rows]

            elif self._db_type == "postgresql":
                result = self.query(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public' ORDER BY table_name"
                )
                tables = [row[0] for row in result.rows]

            elif self._db_type == "mysql":
                result = self.query("SHOW TABLES")
                tables = [row[0] for row in result.rows]

            else:
                tables = []

            logger.info("Listed %d tables in %s database", len(tables), self._db_type)
            return tables

        except Exception as exc:
            logger.exception("list_tables failed")
            return []

    def get_table_sizes(self) -> Dict[str, Any]:
        """Get row counts for all tables in the database.

        Returns
        -------
        dict
            Maps table name -> row count.
        """
        if self._connection is None:
            return {"success": False, "error": "Not connected", "sizes": {}}

        try:
            tables = self.list_tables()
            sizes: Dict[str, int] = {}
            for table in tables:
                result = self.query(f'SELECT COUNT(*) FROM "{table}"')
                if result.rows:
                    sizes[table] = result.rows[0][0]
                else:
                    sizes[table] = 0
            return {"success": True, "sizes": sizes}
        except Exception as exc:
            logger.exception("get_table_sizes failed")
            return {"success": False, "error": str(exc), "sizes": {}}

    def close(self) -> None:
        """Close the active database connection and reset state."""
        if self._connection is not None:
            try:
                self._connection.close()
                logger.info("Closed %s connection", self._db_type)
            except Exception as exc:
                logger.warning("Error closing database connection: %s", exc)
            finally:
                self._connection = None
                self._db_type = None

    def is_connected(self) -> bool:
        """Return *True* if a database connection is active."""
        return self._connection is not None

    def get_db_type(self) -> Optional[str]:
        """Return the current database type (``sqlite``, ``postgresql``, ``mysql``)."""
        return self._db_type

    def __enter__(self) -> "DatabaseTool":
        """Context manager entry."""
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Context manager exit — ensures connection is closed."""
        self.close()
