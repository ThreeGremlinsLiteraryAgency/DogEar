import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class CatalogDatabaseTests(unittest.TestCase):
    def test_migration_search_and_repeatable_edition(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys = ON")
        migration = (ROOT / "migrations" / "0001_catalog.sql").read_text(encoding="utf-8")
        db.executescript(migration)
        db.execute(
            "INSERT INTO works(work_key,title) VALUES (?,?)",
            ("OL1W", "The Hobbit"))
        db.execute(
            "INSERT INTO works_fts(work_key,title,author_names) VALUES (?,?,?)",
            ("OL1W", "The Hobbit", "J. R. R. Tolkien"))
        statement = (
            "INSERT INTO editions (edition_key,work_key,title,isbn_13) "
            "VALUES (?,?,?,?) ON CONFLICT(edition_key) DO UPDATE SET "
            "work_key=excluded.work_key,title=excluded.title,isbn_13=excluded.isbn_13"
        )
        for _ in range(2):
            db.execute(statement, ("OL2M", "OL1W", "The Hobbit", "9780000000002"))
        self.assertEqual(db.execute("SELECT COUNT(*) FROM editions").fetchone()[0], 1)
        query = """SELECT w.work_key,w.title,w.subtitle,w.first_publish_year,w.cover_url,w.subjects_json,
            (SELECT group_concat(a.name, ', ') FROM work_authors wa
             JOIN authors a ON a.author_key=wa.author_key WHERE wa.work_key=w.work_key) author_names
            FROM works_fts f JOIN works w ON w.work_key=f.work_key
            WHERE works_fts MATCH ? LIMIT ? OFFSET ?"""
        results = db.execute(query, ('"Hobbit"*', 20, 0)).fetchall()
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0][1], "The Hobbit")
        db.close()


if __name__ == "__main__":
    unittest.main()
