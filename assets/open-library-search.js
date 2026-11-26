"use strict";

async function searchOpenLibraryWorks(client, query, limit) {
  const isbn = query.replace(/[-\s]/g, "").toUpperCase();
  const isbnQuery = /^(?:\d{9}[\dX]|97[89]\d{10})$/.test(isbn);
  const { data, error } = await client.functions.invoke("book-search", {
    body: { q: isbnQuery ? "isbn:" + isbn : query, page: 1, page_size: limit }
  });
  if (error || !Array.isArray(data?.results)) {
    throw new Error("Open Library search is temporarily unavailable.");
  }

  return data.results.flatMap(work => {
    const workKey = String(work.source_work_key || "").replace(/^\/works\//, "");
    if (!/^OL\d+W$/.test(workKey) || !work.title) return [];

    const matchedIsbn = isbnQuery && work.isbn?.some(value => String(value).toUpperCase() === isbn);
    return [{
      // Keep compatibility with the existing catalog-to-books import key.
      id: "OL-" + workKey,
      volumeInfo: {
        title: work.title,
        subtitle: work.subtitle,
        authors: work.author_names,
        categories: work.subjects,
        imageLinks: { thumbnail: work.cover_url },
        industryIdentifiers: matchedIsbn
          ? [{ type: isbn.length === 13 ? "ISBN_13" : "ISBN_10", identifier: isbn }]
          : []
      }
    }];
  });
}
