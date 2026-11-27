"use strict";

window.paperGremlinMissingBook = {
  addButton(container, client, options = {}) {
    if (container.querySelector("[data-add-missing-book]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "book-button";
    button.dataset.addMissingBook = "";
    button.textContent = "Add a missing book";
    container.append(button);
    button.onclick = async () => {
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        const returnTo = location.pathname.split("/").pop() + location.search;
        sessionStorage.setItem("paperGremlinMissingBookReturn", returnTo);
        location.href = "auth.html#login";
        return;
      }
      const dialog = document.createElement("dialog");
      dialog.style.cssText = "max-width:min(440px,92vw);background:#13221c;color:#f1e7cf;border:1px solid #a88b58;padding:24px";
      dialog.innerHTML = `
        <form>
          <h2>Add a missing book</h2>
          <p>You can track it right away. We’ll check Open Library for a match.</p>
          <p><label>Title <input name="title" required maxlength="300"></label></p>
          <p><label>Author <input name="author" required maxlength="300"></label></p>
          <p><label>ISBN (optional) <input name="isbn" maxlength="24"></label></p>
          <p><label>Publication year (optional) <input name="year" type="number" min="1" max="9999"></label></p>
          <p><label><input name="keep" type="checkbox"> Keep the assigned cover after verification</label></p>
          <p role="status"></p>
          <button type="submit">Add to my books</button>
          <button type="button" data-cancel>Cancel</button>
        </form>`;
      document.body.append(dialog);
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      const form = dialog.querySelector("form");
      form.elements.title.value = options.query && !/^[\d\sX-]+$/i.test(options.query) ? options.query : "";
      dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
      form.onsubmit = async (event) => {
        event.preventDefault();
        const status = form.querySelector("[role=status]");
        const submit = form.querySelector("[type=submit]");
        submit.disabled = true;
        status.textContent = "Adding your book…";
        try {
          const fields = new FormData(form);
          const { data: id, error } = await client.rpc("submit_missing_book", {
            p_title: fields.get("title"), p_author: fields.get("author"),
            p_isbn: fields.get("isbn"), p_year: fields.get("year") ? Number(fields.get("year")) : null,
            p_reading_date: options.date || null, p_keep_cover: fields.has("keep"),
          });
          if (error) throw error;
          status.textContent = "Book saved. Checking Open Library…";
          await client.functions.invoke("verify-reader-book", { body: { id: Number(id) } });
          dialog.close();
          if (options.onAdded) await options.onAdded(id);
          else location.href = "book-detail.html?id=" + encodeURIComponent(id);
        } catch (error) {
          status.textContent = error.message || "Couldn’t add the book. Try again.";
          submit.disabled = false;
        }
      };
      dialog.showModal();
    };
  },
  async search(client, query) {
    const { data, error } = await client.rpc("find_submitted_books", { p_query: query });
    if (error) {
      console.warn("Community book search:", error);
      return [];
    }
    return data || [];
  },
  label(status) {
    if (status === "needs_verification") return "Needs verification";
    if (status === "community_unverified") return "Community submitted · Unverified";
    return "";
  },
};
