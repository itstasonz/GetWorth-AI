# GW-YAD2-ACCESS-001 — The legitimate route to yad2 listing coverage

**Type:** Access recommendation. **No message has been sent to yad2; no representation has been made; nothing was retrieved past an access control.**
**Date:** 2026-10-05

## 1. What is established

| fact | basis |
|---|---|
| yad2 is the Israeli second-hand market for general goods (its own description: ~160,000 product listings, free to list), with Facebook Marketplace the only comparable channel | public descriptions, 2026-10-05 |
| There is **no public developer API or developer portal**; the only programmatic access products found are third-party scraping services, which this recommendation rejects | web search, 2026-10-05 |
| `robots.txt` (`User-agent: *`) does **not** disallow `/item/` or `/market/item/`; it declares two sitemap indexes (`/sitemaps/sitemap-index.xml`, `/sitemaps-v2/…`) and allows `/sitemaps/`; it disallows `/api/`, `/MyYad2/`, admin paths and filter-parameter variants | read 2026-10-05 |
| The sitemap index lists taxonomy sitemaps (real estate, vehicles, pets, "products", "yadata"); no listing-level product sitemap was visible in the index | read 2026-10-05 |
| A request for the homepage from a non-browser client is answered with a **Radware ShieldSquare bot-management challenge** (`validate.perfdrive.com`), i.e. automated access is actively managed regardless of robots.txt | observed 2026-10-05; the challenge was not followed |
| yad2 listing URLs (`yad2.co.il/item/…`, `yad2.co.il/market/item/…`) are present in at least one general web index | observed 2026-10-05 |
| GetWorth's current search provider returned none of them in 103 results | GW-SCAN-V2-001 |
| Terms of use could not be read without passing the challenge; their position on automated access is **unknown** | — |

## 2. What is therefore NOT an option

- Fetching listing pages or the mobile app's endpoints from GetWorth's servers (the site's bot management is an access control; "permitted by robots" is not "permitted by the operator" once a challenge is served).
- Third-party scraper products for yad2 (they exist commercially; they work by doing the above on someone else's infrastructure, and their legal basis is theirs to defend, not ours).
- Any identity or IP rotation, headless-browser challenge solving, or use of authenticated endpoints.

## 3. The legitimate routes, in order of value

1. **A data agreement with yad2.** What GetWorth would ask for: a read-only feed or search endpoint over the *products* vertical (title, category, price, condition, posting date, listing id, city, listing URL), filtered by query or category, with a refresh cadence of hours; no personal data (no seller names, phones or exact addresses). What GetWorth offers in return: referral traffic to live listings from every valuation ("3 listings on yad2 · see them"), a "list it on yad2 at this price" action after a valuation, and aggregate market-price insight per category that yad2 does not surface today. The commercial shapes that fit: a referral/affiliate arrangement, a data licence with a monthly fee, or a partnership pilot limited to a category.
   *Contact route:* yad2's public contact page (`yad2.co.il/contactus`) names business and advertising channels; a partnerships / business-development address is the right first door, with the one-page proposal in §4. Yad2 is part of a larger media group, whose corporate development function is the escalation path.
2. **Discovery through a search provider whose index holds yad2 listing pages**, which is ordinary web search of public pages and makes no request to yad2 at all. This is what M1's second profile and the benchmark's first question test (OpenAI with `allowed_domains`), and what a second search API would be evaluated for. It yields excerpts, not a feed: titles and prices, some of the time, with freshness unknown.
3. **Human-recorded ground truth** for calibration: a person reading public listings in a browser and recording title, price, date and URL for a product. Slow, legitimate, and exactly what the resale-factor measurement needs in the meantime.

## 4. The one-page proposal to send (draft; not sent)

> GetWorth is a photo-to-valuation app for second-hand goods in Israel. A user photographs an item; we identify it and show what it sells for today. Our users are sellers about to list and buyers checking a price — yad2's own audience. We would like to show live yad2 listings as the evidence behind each valuation and send users to them, and we are asking for a read-only way to retrieve current product listings for a query (title, price, condition, date, city, listing URL; no personal data). In return: referral traffic with every valuation, a "list on yad2 at this price" action, and category-level price insight. We would start with a pilot in one category and measure referrals together.

## 5. What M1 does about it

Nothing that touches yad2. The provider contract is written so that a yad2 feed, when agreed, is one `LOCAL_USED` provider with `supports / search / normalize`, and the dedupe and independence rules already treat a listing id from its origin as the strongest key. Until then, local used evidence arrives only through discovery excerpts, and the valuation says so.

## 6. Decision needed

Whether to open the conversation in §3.1, and who signs the proposal. No contact is made before that decision.
