"use strict";

function paperGremlinBookshopUrl(book) {
  const status = book?.verificationStatus;
  if (["flagged", "rejected", "merged", "merged_duplicate"].includes(status)) {
    return "";
  }

  if (book?.buyUrl) {
    try {
      const destination = new URL(book.buyUrl);
      if (destination.protocol === "https:" && !destination.username && !destination.password)
        return destination.href;
    } catch {
      // A malformed override falls back to the standard storefront.
    }
  }

  const storefront = "https://bookshop.org/shop/threegremlins";
  const affiliate = "128186";
  const productBaseUrl = "https://bookshop.org/a/" + affiliate;
  const verified = status === "verified" || status === "manually_verified";
  if (["needs_verification", "community_unverified"].includes(status)) {
    return storefront;
  }

  const isbn = String(book.isbn13 || "").replace(/[\s-]/g, "");
  if (verified && /^97[89][0-9]{10}$/.test(isbn)) {
    const checksum = Array.from(isbn).reduce(
      (sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0
    );
    if (checksum % 10 === 0) {
      return productBaseUrl + "/" + isbn;
    }
  }

  const authors = Array.isArray(book.authors) ? book.authors.join(" ") : book.authors;
  const keywords = String(book.title || authors || "").trim();
  if (!keywords) {
    return storefront;
  }

  return "https://bookshop.org/search?" + new URLSearchParams({ affiliate, keywords });
}

async function paperGremlinLookupIsbnEdition(input) {
  const isbn = String(input || "").replace(/[\s-]/g,"");
  if (!/^97[89][0-9]{10}$/.test(isbn)) return null;
  const sum = Array.from(isbn).reduce((total,digit,i)=>total+Number(digit)*(i%2?3:1),0);
  if (sum%10) return null;
  try {
    const response = await fetch("https://openlibrary.org/isbn/"+isbn+".json",{
      signal:AbortSignal.timeout(4500)
    });
    if (!response.ok) return null;
    const edition = await response.json();
    const workKey = (edition.works || []).map(work=>work.key?.split("/").pop()).find(key=>/^OL\d+W$/.test(key));
    if (!workKey || !edition.isbn_13?.includes(isbn)) return null;
    return {isbn,workKey,title:edition.title,publisher:edition.publishers?.[0],
      publishedDate:edition.publish_date,
      coverUrl:edition.covers?.[0]>0?"https://covers.openlibrary.org/b/id/"+edition.covers[0]+"-L.jpg":""};
  } catch {
    return null;
  }
}
