import gzip
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "prepare_priority_d1.py"

class ForwardImportTests(unittest.TestCase):
    def run_import(self, record):
        with tempfile.TemporaryDirectory() as folder:
            wd = Path(folder)
            with gzip.open(wd / "paper-gremlin-priority-100k.jsonl.gz", "wt", encoding="utf-8") as f:
                f.write(json.dumps(record) + "\n")
            process = subprocess.run(
                [sys.executable, str(SCRIPT), "--start", "0", "--count", "1", "--chunk", "1"],
                cwd=wd, text=True, capture_output=True
            )
            sql_file = wd / "batches" / "000000.sql"
            return process, sql_file.read_text() if sql_file.exists() else ""

    def complete_record(self):
        return {
            "work_key": "OL123W", "title": "A Book", "first_publish_date": "2007",
            "subjects": ["Fantasy"], "cover_ids": [123],
            "authors": [{"author_key": "OL456A", "name": "Author Name"}]
        }

    def test_author_links_and_search_names_are_written(self):
        process, sql = self.run_import(self.complete_record())
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertIn("INSERT OR IGNORE INTO work_authors", sql)
        self.assertIn("Author Name", sql)
        self.assertIn("INSERT OR IGNORE INTO works", sql)

    def test_missing_author_cannot_enter_database(self):
        record = self.complete_record()
        record["authors"] = []
        process, sql = self.run_import(record)
        self.assertNotEqual(process.returncode, 0)
        self.assertEqual(sql, "")
        self.assertIn("missing resolved author", process.stderr)

    def test_missing_cover_cannot_enter_database(self):
        record = self.complete_record()
        record["cover_ids"] = []
        process, sql = self.run_import(record)
        self.assertNotEqual(process.returncode, 0)
        self.assertEqual(sql, "")
        self.assertIn("missing cover", process.stderr)

if __name__ == "__main__":
    unittest.main()
