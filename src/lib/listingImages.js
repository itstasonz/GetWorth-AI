// ══════════════════════════════════════════════════════════════════════════════
// LISTING CARDS WITHOUT FULL PHOTOS — lists read a thumbnail; the detail screen reads the photographs (2026-11-10)
//
// Every legacy listing keeps its photographs as base64 text in listings.images (avg 412 KB, max 2.4 MB a row in
// Production). Feeds, saved items, conversations and orders only ever draw images[0] as a small square, yet each
// reload shipped the whole field — the queries that saturated the database during scan b4254487.
//
// Lists select LISTING_CARD_COLUMNS (every column except images, plus thumbnail and image_count, kept by the
// listings_sync_thumbnail trigger). asCard() gives the row the shape the screens already use — images: [thumbnail] —
// and marks it partial; the detail screen loads the full photographs with loadListingImages() when it opens one.
// ══════════════════════════════════════════════════════════════════════════════

/** Every listings column a list needs: all of them except `images`. Keep in step with the table (LI-1 checks it). */
export const LISTING_CARD_COLUMNS = [
  'id', 'seller_id', 'title', 'title_hebrew', 'description', 'category', 'condition', 'price', 'original_price',
  'location', 'status', 'views', 'saves', 'is_featured', 'is_boosted', 'boost_expires_at', 'condition_details',
  'contact_method', 'contact_phone', 'created_at', 'updated_at', 'expires_at', 'quality_score', 'sold_to', 'sold_at',
  'attributes', 'product_id', 'valuation_id', 'subcategory', 'ai_confidence', 'actual_sold_price', 'serial_submitted',
  'serial_verified', 'serial_masked', 'serial_type', 'price_source', 'suggested_price',
  'thumbnail', 'image_count',
].join(', ');

export const SELLER_EMBED = 'seller:profiles(id, full_name, avatar_url, badge, is_verified, rating, review_count, total_sales, created_at)';

/** The small listing embedded in conversations, reviews and admin rows. */
export const LISTING_PREVIEW_COLUMNS = 'id, title, title_hebrew, price, thumbnail, image_count';

/**
 * A row read with the card columns, in the shape the screens use: images = [thumbnail], marked partial.
 * A row that already carries `images` (a single-listing read, an insert's echo, an older cache) is returned as is.
 */
export function asCard(row) {
  if (!row || typeof row !== 'object') return row;
  if (Array.isArray(row.images) && !('thumbnail' in row)) return row;
  if (row._imagesPartial === true) return row;
  const { thumbnail, ...rest } = row;
  const images = thumbnail ? [thumbnail] : (Array.isArray(row.images) ? row.images : []);
  return { ...rest, images, image_count: Number.isInteger(row.image_count) ? row.image_count : images.length, _imagesPartial: true };
}

/** asCard for a list. */
export const asCards = (rows) => (Array.isArray(rows) ? rows.map(asCard) : rows);

/** A row whose embedded `listing` was read with LISTING_PREVIEW_COLUMNS (conversations, saved items, reviews). */
export const withCardListing = (row) => (row && row.listing ? { ...row, listing: asCard(row.listing) } : row);

/** An order from get_user_orders / get_order_by_id: its listing carries the thumbnail only. */
export function orderWithCardListing(order) {
  if (!order?.listing) return order;
  return { ...order, listing: { ...order.listing, _imagesPartial: true } };
}

/** Does this listing still need its full photographs loaded? (Demo listings have ids starting with "s".) */
export const needsFullImages = (listing) =>
  !!listing && listing._imagesPartial === true && typeof listing.id === 'string' && !listing.id.startsWith('s');

/** The full photographs of one listing. Resolves to an array, or null when they could not be read. */
export async function loadListingImages(client, id) {
  const { data, error } = await client.from('listings').select('images').eq('id', id).maybeSingle();
  if (error || !data || !Array.isArray(data.images)) return null;
  return data.images;
}
