CREATE TABLE IF NOT EXISTS works (
  work_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  first_publish_year INTEGER,
  cover_url TEXT,
  subjects_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS authors (
  author_key TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_authors (
  work_key TEXT NOT NULL REFERENCES works(work_key),
  author_key TEXT NOT NULL REFERENCES authors(author_key),
  PRIMARY KEY(work_key, author_key)
);
CREATE TABLE IF NOT EXISTS editions (
  edition_key TEXT PRIMARY KEY,
  work_key TEXT NOT NULL REFERENCES works(work_key),
  title TEXT,
  publisher TEXT,
  publish_date TEXT,
  isbn_10 TEXT,
  isbn_13 TEXT
);
CREATE INDEX IF NOT EXISTS editions_work_idx ON editions(work_key);
CREATE INDEX IF NOT EXISTS editions_isbn13_idx ON editions(isbn_13);
CREATE INDEX IF NOT EXISTS editions_isbn10_idx ON editions(isbn_10);
CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5(
  work_key UNINDEXED, title, author_names, tokenize='unicode61 remove_diacritics 2'
);
