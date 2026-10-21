# Paper Gremlin independent catalog (foundation)

This is a **staged** Cloudflare Worker + D1 search index + R2 archive configuration. It is not yet deployed or populated. No book data is automatically downloaded, and the live Discover page still uses the existing Supabase search endpoint.

## Architecture
- R2 bucket `paper-gremlin-catalog-archive`: compressed source snapshots, import batches and backups.
- D1 database `paper-gremlin-catalog`: searchable work, author, edition and ISBN metadata.
- Worker `paper-gremlin-catalog`: read-only public search and work lookup.
- Supabase remains the source of truth for reader activity, profiles, clubs and saved books.

## Setup (requires Cloudflare account authorization)
1. `cd cloudflare/catalog && npm install`
2. `npx wrangler login`
3. `npx wrangler r2 bucket create paper-gremlin-catalog-archive`
4. `npx wrangler d1 create paper-gremlin-catalog`
5. Copy the returned D1 `database_id` into `wrangler.jsonc`. Wrangler may also provision missing IDs automatically, but explicit IDs make deployments reproducible.
6. `npm run migrate:remote`
7. `npm run deploy`
8. Test `/health`, `/search?q=hobbit` and CORS from the GitHub Pages origin.

## Import work remaining
The schema is deliberately empty. Before production cutover, implement and test a streaming importer from Open Library's **bulk data dumps**, work-to-author mapping, edition/ISBN resolution, FTS refresh, deduplication, resume/checkpointing and import provenance. Do not crawl the live Open Library API to populate millions of records. FTS records must be populated alongside work imports (the current migration does not automatically populate them). Use staged imports and measure D1 storage/limits before selecting full-catalog scale.

## Security
Worker exposes read-only endpoints; no public write endpoint or storage credentials. Keep R2 private. Restrict browser CORS to the Paper Gremlin origin; CORS is not authentication or rate limiting. Add abuse controls before public production deployment.

## Offline edition and ISBN import (staged)

Generate work/author batches first, then edition batches from the **same** Open Library work dump and the **same** `--limit`. This avoids referring to works excluded from a small trial import.

```bash
cd cloudflare/catalog
python3 scripts/import_openlibrary.py --works /path/ol_dump_works_latest.txt.gz --authors /path/ol_dump_authors_latest.txt.gz --out ./batches --limit 1000
python3 scripts/import_editions.py --works /path/ol_dump_works_latest.txt.gz --editions /path/ol_dump_editions_latest.txt.gz --out ./batches --limit 1000
python3 -m unittest discover -s test -p 'test_*.py' -v
npm test
```

The offline edition importer makes `editions_000001.sql` etc. Each SQL batch uses an upsert so applying the same edition batch twice does not create duplicate editions. **Apply work batches before edition batches** because the editions table references works. The first importer uses numeric `000001.sql` work batches. Edition import is intentionally independent from the deployed website and will not update D1 until a person explicitly runs Wrangler against the target database.

**Note:** Both importers create local SQLite lookup files inside the output directory; these are local implementation details, not part of the SQL import. Use a fresh output directory for each catalog source snapshot. Bulk dump import can consume considerable local storage and processing time. Verify a small sample and estimate D1 limits before scaling. Importing editions does not replace the outstanding deployment, full-catalog, migration, or abuse-protection work.
