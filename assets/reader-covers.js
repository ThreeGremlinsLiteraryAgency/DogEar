"use strict";

const readerCoverNames = new Map([
  [1, "Gilded Grove"],
  [2, "Starlit Crescent"],
  [3, "Antique Olive"],
  [4, "Rose Garden"],
  [5, "Moonlit Peaks"],
  [6, "Hillside Cottage"],
  [7, "Burgundy Classic"],
  [8, "Crimson Folio"],
  [9, "Golden Bookplate"],
  [10, "Emberworn"],
]);

const coverLetteringMeasure = document.createElement("canvas").getContext("2d");

function fitCoverLettering(text, width, startingSize, maxLines, letterSpacing) {
  const words = text.trim().split(/\s+/);
  for (let size = startingSize; size > 1; size -= .15) {
    coverLetteringMeasure.font = "600 " + size + "px Georgia, 'Times New Roman', serif";
    const measure = line => coverLetteringMeasure.measureText(line).width
      + Math.max(0, line.length - 1) * size * letterSpacing;
    if (words.some(word => measure(word) > width)) continue;
    let lines = 1;
    let line = "";
    for (const word of words) {
      const combined = line ? line + " " + word : word;
      if (measure(combined) > width) {
        lines++;
        line = word;
      } else {
        line = combined;
      }
    }
    if (lines <= maxLines) return size;
  }
  return 1;
}

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
    // Measure in a 100-unit cover so the same proportions fit thumbnails and full covers.
    const width = Number(number) === 4 ? 56 : [3, 10].includes(Number(number)) ? 58 : 66;
    heading.style.fontSize = fitCoverLettering(title, width, 9.2, 5, 0) + "cqi";
    const byline = document.createElement("span");
    byline.textContent = author;
    byline.style.fontSize = fitCoverLettering(author.toUpperCase(), width, 4, 2, .13) + "cqi";
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
      label.textContent = readerCoverNames.get(Number(number)) || "Alternate artwork";
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
