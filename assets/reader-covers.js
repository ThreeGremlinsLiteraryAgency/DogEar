"use strict";

window.paperGremlinReaderCovers = {
  letter(art, number, title, author) {
    art.classList.add("pg-cover-art");
    art.dataset.template = number;
    art.querySelector(".pg-cover-lettering")?.remove();
    const lettering = document.createElement("span");
    lettering.className = "pg-cover-lettering";
    lettering.setAttribute("aria-hidden", "true");
    const heading = document.createElement("strong");
    heading.textContent = title;
    // Keep long titles inside the artwork's open center.
    const size = Math.max(4.8, Math.min(9.2, 10.5 - title.length * .044));
    heading.style.setProperty("--title-size", size + "cqi");
    const byline = document.createElement("span");
    byline.textContent = author;
    lettering.append(heading, byline);
    art.append(lettering);
  },
  async picker(form, client, { selected, getTitle, getAuthor }) {
    const { data, error } = await client.from("book_cover_templates").select("number,url").order("number");
    if (error || !data?.length) throw new Error("Cover designs could not load. Try again.");
    const fieldset = document.createElement("fieldset");
    fieldset.className = "pg-cover-choices";
    fieldset.innerHTML = '<legend>Choose cover artwork</legend>';
    const grid = document.createElement("div");
    grid.className = "pg-cover-grid";
    const choices = [];
    for (const { number, url } of data) {
      const choice = document.createElement("label");
      choice.className = "pg-cover-option";
      const art = document.createElement("span");
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      image.loading = "lazy";
      art.append(image);
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "cover";
      radio.value = number;
      radio.checked = number === (selected || data[0].number);
      const label = document.createElement("span");
      label.textContent = "Cover " + String(number).padStart(4, "0");
      choice.append(art, radio, label);
      grid.append(choice);
      choices.push({ art, number });
    }
    function preview() {
      for (const { art, number } of choices) {
        paperGremlinReaderCovers.letter(art, number, getTitle() || "Book title", getAuthor() || "Author");
      }
    }
    preview();
    form.addEventListener("input", event => {
      if (["title", "author"].includes(event.target.name)) preview();
    });
    fieldset.append(grid);
    form.querySelector("[data-cover-picker]").replaceWith(fieldset);
  },
};
