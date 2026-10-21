import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "scripts" / "import_editions.py"
spec = importlib.util.spec_from_file_location("import_editions", MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def dump(path, objects):
    with path.open("w", encoding="utf-8") as stream:
        for item in objects:
            stream.write("type\tkey\t1\t2026-01-01\t" + json.dumps(item) + "\n")


class EditionImportTests(unittest.TestCase):
    def test_import_and_rerun(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            works = root / "works.txt"
            editions = root / "editions.txt"
            out = root / "out"
            dump(works, [
                {"key": "/works/OL1W", "title": "First"},
                {"key": "/works/OL2W", "title": "Second"},
            ])
            dump(editions, [
                {"key": "/books/OL3M", "works": [{"key": "/works/OL1W"}],
                 "title": "Reader's Edition", "publishers": ["Test Press"],
                 "isbn_13": ["9781234567890"], "isbn_10": ["123456789X"]},
                {"key": "/books/OL4M", "works": [{"key": "/works/OL2W"}],
                 "title": "Second Edition"},
                {"key": "/books/OL5M", "works": [{"key": "/works/OL999W"}]},
            ])
            from types import SimpleNamespace
            args = SimpleNamespace(works=str(works), editions=str(editions),
                                   out=str(out), limit=1, batch_size=1)
            mod.build(args)
            batches = sorted(out.glob("editions_*.sql"))
            self.assertEqual(len(batches), 1)
            self.assertIn("Reader''s Edition", batches[0].read_text())
            self.assertIn("9781234567890", batches[0].read_text())

            db = sqlite3.connect(":memory:")
            db.executescript("""CREATE TABLE editions (
                edition_key TEXT PRIMARY KEY, work_key TEXT, title TEXT,
                publisher TEXT, publish_date TEXT, isbn_10 TEXT, isbn_13 TEXT
            );""")
            db.executescript(batches[0].read_text())
            db.executescript(batches[0].read_text())
            self.assertEqual(db.execute("SELECT COUNT(*) FROM editions").fetchone()[0], 1)
            mod.build(args)
            self.assertEqual(len(list(out.glob("editions_*.sql"))), 1)

    def test_reject_invalid_limits(self):
        from types import SimpleNamespace
        with self.assertRaises(ValueError):
            mod.build(SimpleNamespace(limit=-1, batch_size=100))


if __name__ == "__main__":
    unittest.main()
