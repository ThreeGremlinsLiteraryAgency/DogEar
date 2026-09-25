// Paper Gremlin expanded book search
// Supabase Edge Function: book-search
// Uses Open Library Search API as the external discovery catalog.
// Paper Gremlin stores only metadata it actually needs; it does not mirror full books.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

function coverUrl(doc: any): string {
  if (doc?.cover_i) {
    return `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
  }
  const isbn = Array.isArray(doc?.isbn) ? doc.isbn.find((v: unknown) => /^\d{13}$/.test(String(v))) : null;
  return isbn ? `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(String(isbn))}-M.jpg` : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const q = String(body?.q ?? "").trim();
    const page = clampInt(body?.page, 1, 1, 1000);
    const pageSize = clampInt(body?.page_size, 30, 1, 50);

    if (q.length < 2) {
      return new Response(JSON.stringify({ error: "Search query must be at least 2 characters." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const params = new URLSearchParams({
      q,
      page: String(page),
      limit: String(pageSize),
      fields: "key,title,subtitle,author_name,first_publish_year,edition_count,isbn,subject,cover_i",
    });

    const upstream = await fetch(`https://openlibrary.org/search.json?${params.toString()}`, {
      headers: { "User-Agent": "PaperGremlin/1.0 (book discovery search)" },
      signal: AbortSignal.timeout(10000),
    });

    if (!upstream.ok) throw new Error(`Catalog upstream returned HTTP ${upstream.status}`);

    const payload = await upstream.json();
    const total = Math.max(0, Number(payload?.numFound) || 0);
    const docs = Array.isArray(payload?.docs) ? payload.docs : [];

    const results = docs.map((doc: any) => ({
      source_work_key: doc?.key || null,
      title: doc?.title || "Untitled",
      subtitle: doc?.subtitle || "",
      author_names: Array.isArray(doc?.author_name) ? doc.author_name.slice(0, 12) : [],
      first_publish_year: doc?.first_publish_year || null,
      edition_count: Number(doc?.edition_count) || 0,
      isbn: Array.isArray(doc?.isbn) ? doc.isbn.slice(0, 30) : [],
      subjects: Array.isArray(doc?.subject) ? doc.subject.slice(0, 20) : [],
      cover_url: coverUrl(doc),
    }));

    return new Response(JSON.stringify({
      query: q,
      page,
      page_size: pageSize,
      total_results: total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      results,
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.error("book-search:", error);
    return new Response(JSON.stringify({
      error: "The expanded book catalog could not be reached.",
    }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
