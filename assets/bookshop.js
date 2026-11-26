"use strict";

function paperGremlinBookshopUrl(book) {
  const status = book?.verificationStatus;
  if (["flagged", "rejected", "merged", "merged_duplicate"].includes(status)) {
    return "";
  }

  const storefront = "https://bookshop.org/shop/threegremlins";
  const affiliate = "128186";
  const productBaseUrl = "https://bookshop.org/a/" + affiliate;
  const verified = status === "verified" || status === "manually_verified";
  if (!verified) {
    return storefront;
  }

  const isbn = String(book.isbn13 || "").replace(/[\s-]/g, "");
  if (/^97[89][0-9]{10}$/.test(isbn)) {
    const checksum = Array.from(isbn).reduce(
      (sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0
    );
    if (checksum % 10 === 0) {
      return productBaseUrl + "/" + isbn;
    }
  }

  const authors = Array.isArray(book.authors) ? book.authors.join(" ") : book.authors;
  const keywords = [book.title, authors].filter(Boolean).join(" ").trim();
  if (!keywords) {
    return storefront;
  }

  return "https://bookshop.org/search?" + new URLSearchParams({ affiliate, keywords });
}
