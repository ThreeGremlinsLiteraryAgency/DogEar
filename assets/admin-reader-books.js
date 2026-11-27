"use strict";

(async () => {
  const panel = document.getElementById("readerBookQueue");
  const list = panel.querySelector("[data-list]");
  const status = panel.querySelector("[role=status]");
  function showError(error) {
    status.textContent = error.message || "Couldn’t complete that action.";
  }
  async function refresh() {
    const { data, error } = await supabaseClient.rpc("list_missing_books");
    if (error) {
      showError(error);
      return;
    }
    list.replaceChildren();
    if (!data.length) list.textContent = "No submissions to review.";
    for (const book of data) {
      const row = document.createElement("p");
      const link = document.createElement("a");
      link.href = "book-detail.html?id=" + encodeURIComponent(book.id);
      link.textContent = book.title;
      row.append(link, " · " + (book.authors || []).join(", ") + " · " +
        paperGremlinMissingBook.label(book.verification_status) + " · Cover " +
        String(book.cover_template).padStart(4,"0") + " ");
      function action(label, rpc, args) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn secondary";
        button.textContent = label;
        button.onclick = async () => {
          button.disabled = true;
          const { error } = await supabaseClient.rpc(rpc, { p_book_id:book.id, ...args });
          if (error) {
            showError(error);
            button.disabled = false;
          } else {
            status.textContent = "Saved.";
            await refresh();
          }
        };
        row.append(button, " ");
      }
      if (book.verification_status === "needs_verification")
        action("Publish as unverified", "review_missing_book", { p_status:"community_unverified" });
      else action("Return to queue", "review_missing_book", { p_status:"needs_verification" });
      action("Mark verified", "review_missing_book", { p_status:"manually_verified" });
      action(book.keep_generic_cover ? "Use catalog cover" : "Keep assigned cover",
        "keep_missing_book_cover", { p_keep:!book.keep_generic_cover });
      list.append(row);
    }
  }
  panel.querySelector("form").onsubmit = async event => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const { error } = await supabaseClient.rpc("replace_book_cover_template", {
      p_number:Number(fields.get("number")), p_url:fields.get("url")
    });
    if (error) showError(error);
    else status.textContent = "Template replaced for books still using its generic artwork.";
  };
  panel.addEventListener("toggle", () => { if (panel.open) void refresh(); });
})();
