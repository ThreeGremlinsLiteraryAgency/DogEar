"use strict";

(() => {
  const panel = document.getElementById("readerBookQueue");
  if (!panel) return;
  const list = panel.querySelector("[data-list]");
  const status = panel.querySelector("[role=status]");
  function showError(error) {
    status.textContent = error.message || "Couldn’t complete that action.";
  }
  async function editBook(bookId) {
    const { data:book, error } = await supabaseClient.from("books")
      .select("title,authors,subtitle,isbn_13,isbn_10,publisher,published_date,description,updated_at")
      .eq("id",bookId).single();
    if (error) { showError(error); return; }

    const dialog = document.createElement("dialog");
    dialog.style.cssText = "width:min(480px,92%);max-height:88vh;overflow:auto;background:#13221c;color:#f1e7cf;border:1px solid #a88b58;border-radius:10px;padding:20px";
    const form = document.createElement("form");
    form.innerHTML = "<h2>Edit book details</h2>";
    const fields = [
      ["title","Title",300], ["authors","Authors (one per line)",6000],
      ["subtitle","Subtitle",300], ["isbn_13","ISBN-13",32], ["isbn_10","ISBN-10",32],
      ["publisher","Publisher",300], ["published_date","Publication date or year",40],
      ["description","Description",10000],
    ];
    for (const [name,label,maxLength] of fields) {
      const wrapper = document.createElement("label");
      wrapper.style.cssText = "display:grid;gap:4px;margin:12px 0";
      wrapper.textContent = label;
      const control = document.createElement(["authors","description"].includes(name) ? "textarea" : "input");
      control.name = name;
      control.maxLength = maxLength;
      control.required = ["title","authors"].includes(name);
      control.style.cssText = "width:100%;box-sizing:border-box;font-size:16px;padding:6px";
      control.value = name === "authors" ? (book.authors || []).join("\n")
        : name === "isbn_13" && book.isbn_13?.startsWith("PG-") ? "" : book[name] || "";
      wrapper.append(control);
      form.append(wrapper);
    }
    const feedback = document.createElement("p");
    feedback.setAttribute("role","status");
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn";
    save.textContent = "Save book details";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn secondary";
    cancel.textContent = "Cancel";
    cancel.onclick = () => dialog.close();
    form.append(feedback, save, " ", cancel);
    form.onsubmit = async event => {
      event.preventDefault();
      const values = new FormData(form);
      const args = { p_book_id:bookId, p_expected_updated_at:book.updated_at };
      for (const [name] of fields) args["p_" + name] = name === "authors"
        ? values.get(name).split(/\r?\n/).map(author => author.trim()).filter(Boolean)
        : values.get(name).trim();
      save.disabled = true;
      const { error } = await supabaseClient.rpc("edit_submitted_book",args);
      if (error) {
        feedback.textContent = error.message;
        save.disabled = false;
      } else {
        dialog.close();
        status.textContent = "Book details saved.";
        await refresh();
      }
    };
    dialog.append(form);
    dialog.addEventListener("close",() => dialog.remove(),{ once:true });
    document.body.append(dialog);
    dialog.showModal();
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
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn secondary";
      edit.textContent = "Edit book details";
      edit.onclick = async () => {
        edit.disabled = true;
        try { await editBook(book.id); } finally { edit.disabled = false; }
      };
      actions.append(edit, " ");
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
