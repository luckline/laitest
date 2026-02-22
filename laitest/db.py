from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _data_dir() -> Path:
    # Keep state in-repo for the MVP.
    return Path(os.getcwd()) / ".laitest"


def db_path() -> Path:
    return _data_dir() / "laitest.db"


@dataclass(frozen=True)
class DB:
    path: Path

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(str(self.path))
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON;")
        return con


def ensure_schema(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS suites (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS cases (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          suite_id TEXT,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          kind TEXT NOT NULL DEFAULT 'http',
          spec_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(suite_id) REFERENCES suites(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          suite_id TEXT,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          summary_json TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(suite_id) REFERENCES suites(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS run_items (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          case_id TEXT NOT NULL,
          status TEXT NOT NULL,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          log TEXT NOT NULL DEFAULT '',
          data_json TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
          FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
        );
        """
    )
    con.commit()


@contextmanager
def db_conn() -> Iterator[sqlite3.Connection]:
    db = DB(path=db_path())
    con = db.connect()
    try:
        ensure_schema(con)
        yield con
    finally:
        con.close()


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {k: row[k] for k in row.keys()}


def json_loads(s: str, default: Any) -> Any:
    try:
        return json.loads(s)
    except Exception:
        return default

