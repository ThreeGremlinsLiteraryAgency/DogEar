"use strict";

function initializeAdminBookCovers(client, refreshBooks) {
  const element = id => document.getElementById(id);
  const search = element("coverSearch");
  const query = element("coverQuery");
  const status = element("coverStatus");
  const results = element("coverMatches");
  const editor = element("coverEditor");
  const options = element("coverOptions");
  const fields = element("coverNewFields");
  const title = element("coverNewTitle");
  const author = element("coverNewAuthor");
  const save = element("coverSave");
  const workKey = value => String(value || "").match(/(?:^|\/works\/|^OL-)(OL\d+W)$/)?.[1];
  const coverNames = [
    "Botanical", "Celestial", "Classic", "Romance", "Moonlit Valley",
    "Cozy Cottage", "Maroon Hardcover", "Burgundy Leather", "Vintage Bookplate", "Fire Survivor"
  ];
  const genericCovers = coverNames.map((name, index) => ({
    name,
    url: new URL("assets/cover-templates/" + String(index + 1).padStart(4, "0") + ".webp", document.baseURI).href
  }));
  let selectedBook;
  let selection = 0;

  async function getJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Catalog responded with " + response.status);
    return response.json();
  }

  function addButton(text, click) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn secondary";
    button.textContent = text;
    button.addEventListener("click", click);
    results.append(button);
  }

  async function officialCovers(book) {
    const covers = new Map();
    for (const source of [book.cover_url, book.catalogCover]) {
      const url = String(source || "").replace(/^http:\/\//i, "https://");
      if (url.startsWith("https://") && !genericCovers.some(cover => cover.url === url)) {
        covers.set(url, { name: "Catalog artwork", url });
      }
    }
    if (book.key) {
      const stem = "https://openlibrary.org/works/" + book.key;
      const sources = await Promise.allSettled([
        getJson(stem + ".json"),
        getJson(stem + "/editions.json?limit=50")
      ]);
      const values = sources.flatMap(response => response.status === "fulfilled"
        ? [response.value, ...(response.value.entries || [])] : []);
      const ids = new Set(values.flatMap(value => value.covers || []));
      for (const id of ids) {
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        const url = "https://covers.openlibrary.org/b/id/" + id + "-L.jpg";
        if ([...covers.keys()].some(existing => existing.startsWith("https://covers.openlibrary.org/b/id/" + id + "-"))) continue;
        covers.set(url, { name: "Open Library cover", url });
      }
      if (sources.some(response => response.status === "rejected")) {
        return { choices: [...covers.values()], incomplete: true };
      }
    }
    return { choices: [...covers.values()], incomplete: false };
  }

  function renderCoverOptions(choices, current) {
    options.replaceChildren();
    for (const { name, url } of choices) {
      const label = document.createElement("label");
      label.className = "cover-option";
      const option = document.createElement("input");
      option.type = "radio";
      option.name = "bookCover";
      option.value = url;
      option.required = true;
      option.checked = url === current;
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.src = url;
      label.append(option, image, document.createTextNode(name));
      options.append(label);
    }
  }

  async function openBook(book) {
    const request = ++selection;
    selectedBook = book;
    editor.hidden = false;
    fields.hidden = Boolean(book.title && (book.id || book.authors?.length));
    title.required = author.required = !fields.hidden;
    title.readOnly = Boolean(book.title);
    title.value = book.title || (fields.hidden ? "" : query.value.trim());
    author.value = "";
    element("coverBookTitle").textContent = book.title || "Add a missing book";
    save.textContent = book.id || book.key ? "Save cover" : "Add book";
    save.disabled = true;
    options.replaceChildren();
    status.textContent = "Checking available covers…";
    const { choices, incomplete } = await officialCovers(book);
    if (request !== selection) return;
    const hasOfficial = choices.length > 0;
    const currentGeneric = genericCovers.find(cover => cover.url === book.cover_url);
    const available = hasOfficial
      ? [...choices, ...(currentGeneric ? [currentGeneric] : [])]
      : genericCovers;
    element("coverOptionsLabel").textContent = hasOfficial ? "Available artwork" : "Generic covers";
    renderCoverOptions(available, book.cover_url);
    status.textContent = incomplete ? "Some Open Library artwork could not be loaded. Search again to retry." : "";
    save.disabled = false;
  }

  search.addEventListener("submit", async event => {
    event.preventDefault();
    const term = query.value.trim();
    if (term.length < 2) return;
    const request = ++selection;
    editor.hidden = true;
    selectedBook = undefined;
    results.replaceChildren();
    status.textContent = "Searching the library…";
    const endpoint = "https://paper-gremlin-catalog.threegremlinsliteraryagency.workers.dev/search?";
    try {
      const [local, catalog] = await Promise.all([
        client.rpc("search_books_for_cover", { p_query: term }),
        getJson(endpoint + new URLSearchParams({ q: term, limit: "30" }))
      ]);
      if (local.error) throw local.error;
      const matches = local.data.map(book => ({ ...book, key: workKey(book.google_books_id) }));
      const keys = catalog.books.map(book => workKey(book.work_key)).filter(Boolean);
      const linked = keys.length ? await client.from("books")
        .select("id,title,authors,cover_url,google_books_id")
        .in("google_books_id", keys.map(key => "OL-" + key)) : { data: [] };
      if (linked.error) throw linked.error;
      if (request !== selection) return;
      for (const book of linked.data) {
        if (!matches.some(match => match.id === book.id)) {
          matches.push({ ...book, key: workKey(book.google_books_id) });
        }
      }
      for (const book of catalog.books) {
        const key = workKey(book.work_key);
        if (!key) continue;
        const match = matches.find(candidate => candidate.key === key);
        if (match) {
          match.catalogCover = book.cover_url;
        } else {
          matches.push({ key, title: book.title, authors: book.author_names, catalogCover: book.cover_url });
        }
      }
      status.textContent = matches.length ? "Select a book to see its covers." : "No matching book found.";
      for (const book of matches) {
        const byline = (book.authors || []).join(", ");
        addButton([book.title, byline].filter(Boolean).join(" — "), () => openBook(book));
      }
      addButton("Add missing book", () => openBook({}));
    } catch (error) {
      if (request === selection) status.textContent = "Library search is unavailable. Try again.";
      console.error("Book cover search:", error);
    }
  });

  editor.addEventListener("submit", async event => {
    event.preventDefault();
    const book = selectedBook;
    const cover = new FormData(editor).get("bookCover");
    if (!book || !cover || save.disabled) return;
    const request = selection;
    save.disabled = true;
    status.textContent = "Saving…";
    try {
      const { data, error } = await client.rpc("save_admin_book_cover", {
        p_book_id: book.id ?? null,
        p_expected_cover: book.cover_url ?? null,
        p_cover: cover,
        p_title: book.title || title.value.trim(),
        p_authors: book.authors?.length ? book.authors : [author.value.trim()],
        p_work_key: book.key ?? null
      });
      if (error) throw error;
      book.id = data;
      book.cover_url = cover;
      if (request === selection) {
        status.textContent = book.key || book.title ? "Book cover saved." : "Book added with its selected cover.";
        editor.hidden = true;
        results.replaceChildren();
      }
      await refreshBooks().catch(error => console.error("Refresh after cover save:", error));
    } catch (error) {
      if (request === selection) {
        status.textContent = error.message || "The cover could not be saved.";
        save.disabled = false;
      }
    }
  });
}
