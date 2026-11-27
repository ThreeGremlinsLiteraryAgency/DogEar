"use strict";

(() => {
  const panel = document.getElementById("readerBookQueue");
  if (!panel) return;
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
    const pending = data.filter(book => book.verification_status === "needs_verification").length;
    const count = panel.querySelector("[data-pending-count]");
    if (count) count.textContent = pending ? " · " + pending + " pending" : "";
    if (!data.length) list.textContent = "No submissions to review.";
    for (const book of data) {
      const row = document.createElement("p");
      row.className = "reader-book-review-row";
      const link = document.createElement("a");
      link.href = "book-detail.html?id=" + encodeURIComponent(book.id);
      link.textContent = book.title;
      const details = document.createElement("span");
      const pendingReview = book.verification_status === "needs_verification";
      details.textContent = [ (book.authors || []).join(", "),
        pendingReview ? "Pending approval" : "Published · Unverified"
      ].filter(Boolean).join(" · ");
      const actions = document.createElement("span");
      actions.className = "reader-book-review-actions";
      row.append(link, details, actions);
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
        actions.append(button, " ");
      }
      if (book.verification_status === "needs_verification")
        action("Publish as unverified", "review_missing_book", { p_status:"community_unverified" });
      else action("Return to queue", "review_missing_book", { p_status:"needs_verification" });
      action("Approve as verified", "review_missing_book", { p_status:"manually_verified" });
      if (panel.querySelector("form")) action(book.keep_generic_cover ? "Use catalog cover" : "Keep assigned cover",
        "keep_missing_book_cover", { p_keep:!book.keep_generic_cover });
      list.append(row);
    }
  }
  const templateForm = panel.querySelector("form");
  if (templateForm) templateForm.onsubmit = async event => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const { error } = await supabaseClient.rpc("replace_book_cover_template", {
      p_number:Number(fields.get("number")), p_url:fields.get("url")
    });
    if (error) showError(error);
    else status.textContent = "Template replaced for books still using its generic artwork.";
  };
  panel.addEventListener("toggle", () => { if (panel.open) void refresh(); });
  if (panel.open) void refresh();
})();
