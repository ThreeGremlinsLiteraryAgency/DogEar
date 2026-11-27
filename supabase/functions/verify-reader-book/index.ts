import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (verified: boolean, status = 200) =>
  new Response(JSON.stringify({ verified }), { headers, status });
const identity = (value: string) =>
  value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply(false, 405);
  try {
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return reply(false, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await client.auth.getUser(auth.slice(7));
    if (!user) return reply(false, 401);
    const { id } = await request.json();
    if (!Number.isSafeInteger(id) || id < 1) return reply(false, 400);
    const { data: book } = await client.from("books")
      .select("title,authors,isbn_13,isbn_10,published_date")
      .eq("id", id).eq("submitted_by", user.id)
      .eq("verification_status", "needs_verification").maybeSingle();
    if (!book) return reply(false);
    const isbn = /^97[89]\d{10}$/.test(book.isbn_13) ? book.isbn_13 : "";
    const query = new URLSearchParams({
      limit: "15", fields: "key,title,author_name,isbn,first_publish_year,cover_i",
    });
    if (isbn) query.set("isbn", isbn);
    else {
      query.set("title", book.title);
      query.set("author", book.authors[0]);
    }
    const response = await fetch("https://openlibrary.org/search.json?" + query, {
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return reply(false);
    const { docs } = await response.json();
    const matches = (docs || []).filter((doc) =>
      /^\/works\/OL\d+W$/.test(doc.key) &&
      identity(doc.title || "") === identity(book.title) &&
      doc.author_name?.some((author) => identity(author) === identity(book.authors[0])) &&
      (isbn ? doc.isbn?.some((value) => value === isbn || value === book.isbn_10)
        : !book.published_date || String(doc.first_publish_year) === book.published_date)
    );
    if (matches.length !== 1) return reply(false);
    const match = matches[0];
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await service.rpc("verify_missing_book", {
      p_book_id: id, p_work_key: match.key.split("/").pop(), p_title: match.title,
      p_authors: match.author_name, p_year: match.first_publish_year || null,
      p_cover: Number.isSafeInteger(match.cover_i)
        ? "https://covers.openlibrary.org/b/id/" + match.cover_i + "-L.jpg" : null,
    });
    if (error) throw error;
    return reply(data === true);
  } catch (error) {
    console.error("verify-reader-book", error);
    return reply(false, 502);
  }
});
