// Curated Paris directory lookup. Answers most discovery requests without a
// live web search; the caller falls back to live search only when nothing here
// fits. Matching is deliberately strict: a guest asking for Italian near the
// Louvre gets Italian near the Louvre or nothing (and then a live search), never
// a Paris-wide substitute.
import DIRECTORY from '../../data/paris-directory.js';

// Lower-cased, accent-free, and plural-insensitive, so "museums" finds a
// museum and "cocktails" a cocktail bar.
function fold(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').map((word) => (word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)).join(' ');
}

function has(text, phrase) {
  return ` ${text} `.includes(` ${phrase} `);
}

// Guest wording -> directory subcategory. Order matters: more specific first.
// Several subcategories group different things (a castle_palace may be
// Versailles or Chambord), so a third element marks words that must also
// appear in the entry itself.
const NARROW = true;
// PLACE words double as locations ("dinner near the Louvre"): they only pick
// the subcategory when the guest named no other kind of venue.
const PLACE = true;
const SUBCATEGORY_WORDS = [
  ['sightseeing_dinner_cruise', ['dinner cruise', 'diner croisiere', 'dinner on the seine', 'dinner boat'], NARROW],
  ['private_boat_rental', ['private boat', 'boat rental', 'rent a boat', 'bateau prive', 'private cruise']],
  ['sightseeing_dinner_cruise', ['seine cruise', 'river cruise', 'boat tour', 'bateau mouche', 'sightseeing cruise', 'cruise']],
  ['michelin_fine_dining', ['michelin', 'fine dining', 'gastronomic', 'gastronomique', 'starred', 'etoile']],
  ['rooftop_bar', ['rooftop', 'roof top', 'terrace bar']],
  ['jazz_club', ['jazz']],
  ['cocktail_bar', ['cocktail', 'speakeasy', 'mixology']],
  ['wine_bar', ['wine bar', 'bar a vin', 'bar a vins', 'natural wine']],
  ['wine_craft_workshop', ['perfume', 'parfum', 'fragrance', 'champagne tasting'], NARROW],
  ['wine_craft_workshop', ['wine tasting', 'degustation', 'sommelier', 'workshop', 'atelier', 'art class', 'painting class']],
  ['cooking_baking_class', ['cooking class', 'cooking lesson', 'cours de cuisine', 'pastry class', 'baking class', 'macaron class']],
  ['specialty_activity_tour', ['food tour', 'bike', 'vespa', 'cycling', 'bicycle', 'photo', 'photographer', '2cv', 'segway'], NARROW],
  ['private_walking_tour', ['walking tour', 'private tour', 'private guide', 'city tour', 'guided tour', 'museum guide']],
  ['castle_palace', ['versailles', 'chambord', 'chenonceau', 'fontainebleau', 'chantilly', 'vaux le vicomte'], NARROW],
  ['regional_excursion', ['giverny', 'monet', 'champagne', 'reims', 'epernay', 'normandy', 'normandie', 'd day', 'mont saint michel', 'loire', 'disneyland'], NARROW, PLACE],
  ['castle_palace', ['castle', 'chateau', 'palace tour']],
  ['regional_excursion', ['day trip', 'excursion', 'outside paris']],
  ['cabaret_performance', ['moulin rouge', 'lido', 'crazy horse', 'paradis latin'], NARROW],
  ['cabaret_performance', ['opera', 'ballet'], NARROW, PLACE],
  ['cabaret_performance', ['cabaret', 'show tonight', 'burlesque', 'theatre', 'theater', 'concert']],
  ['nightclub_exclusive_bar', ['nightclub', 'night club', 'clubbing', 'dance club', 'private club', 'members club']],
  ['luxury_chauffeur_transport', ['helicopter', 'airport', 'cdg', 'orly', 'transfer'], NARROW],
  ['luxury_chauffeur_transport', ['chauffeur', 'private driver', 'car with driver', 'limousine']],
  ['hammam', ['hammam', 'turkish bath']],
  ['massage', ['massage']],
  ['luxury_hotel_spa', ['hotel spa', 'palace spa']],
  ['day_spa', ['day spa', 'spa']],
  ['department_store_concept', ['department store', 'galeries lafayette', 'printemps', 'bon marche', 'concept store'], NARROW],
  ['department_store_concept', ['department store', 'concept store', 'vintage', 'flea market']],
  ['luxury_boutique', ['luxury boutique', 'designer', 'haute couture', 'luxury shopping', 'chanel', 'dior', 'hermes', 'louis vuitton', 'cartier'], NARROW],
  ['luxury_boutique', ['luxury boutique', 'designer', 'haute couture', 'luxury shopping']],
  ['japanese', ['japanese', 'japonais', 'sushi', 'ramen']],
  ['italian', ['italian', 'italien', 'italienne', 'pizza', 'pasta', 'trattoria']],
  ['chinese', ['chinese', 'chinois', 'dim sum', 'cantonese']],
  ['vietnamese_thai', ['thai', 'vietnamese', 'vietnamien', 'pho']],
  ['lebanese_middle_eastern', ['lebanese', 'libanais', 'middle eastern', 'israeli', 'mezze']],
  ['indian', ['indian', 'indien', 'curry']],
  ['spanish_tapas', ['spanish', 'espagnol', 'tapas', 'paella']],
  ['seafood', ['seafood', 'fish restaurant', 'oyster', 'huitres', 'fruits de mer']],
  ['steakhouse', ['steakhouse', 'steak house', 'steak', 'meat restaurant']],
  ['vegetarian_vegan', ['vegan', 'vegetarian', 'vegetarien', 'plant based']],
  ['brunch', ['brunch']],
  ['brasserie', ['brasserie']],
  ['french_bistro', ['bistro', 'bistrot', 'traditional french', 'classic french']],
  ['patisserie', ['patisserie', 'pastry', 'pastries', 'macaron']],
  ['bakery', ['bakery', 'boulangerie', 'croissant', 'bread']],
  ['historic_cafe', ['cafe', 'coffee', 'historic cafe']],
  // Place-like words last, so "Italian near the Louvre" stays Italian.
  ['kids_family_activity', ['kids', 'children', 'child friendly', 'family activity', 'enfants', 'family friendly']],
  ['museum', ['louvre', 'orsay', 'orangerie', 'rodin', 'pompidou', 'picasso'], NARROW, PLACE],
  ['museum', ['museum', 'musee', 'musuem', 'museam', 'gallery', 'exhibition', 'art', 'painting', 'sculpture']],
  ['monument', ['eiffel tower', 'arc de triomphe', 'notre dame', 'sainte chapelle', 'pantheon', 'sacre coeur', 'conciergerie'], NARROW, PLACE],
  ['monument', ['monument', 'landmark', 'sightseeing']],
  ['garden_park', ['garden', 'park', 'jardin']],
].map(([subcategory, words, narrow = false, place = false]) => ({ subcategory, words: words.map(fold), narrow, place }));

// Broad wording -> directory category, used only when no subcategory matched.
const CATEGORY_WORDS = [
  ['bar', ['bar', 'bars', 'drinks', 'a drink']],
  ['restaurant', ['restaurant', 'dinner', 'lunch', 'eat', 'dining']],
  ['spa_wellness', ['wellness', 'relax']],
  ['boat_cruise', ['boat', 'cruise', 'seine']],
  ['day_trip', ['day trip', 'excursion', 'outside paris']],
  ['shopping', ['shopping', 'shop', 'boutique']],
  ['show_nightlife', ['show', 'nightlife', 'night out']],
  ['experience_class', ['workshop', 'class', 'lesson']],
].map(([category, words]) => [category, words.map(fold)]);

const ENTRIES = DIRECTORY.map((entry) => ({
  entry,
  place: fold(`${entry.neighborhood} ${entry.address}`),
  about: fold(`${entry.name} ${entry.description} ${(entry.tags || []).join(' ')}`),
  neighborhoodParts: String(entry.neighborhood).split('/').map(fold).filter((part) => part.length >= 4),
}));

const KNOWN_PLACES = [...new Set(ENTRIES.flatMap((item) => item.neighborhoodParts))]
  .concat(['louvre', 'eiffel', 'marais', 'montmartre', 'saint germain', 'latin quarter', 'champs elysees', 'opera', 'bastille', 'vendome', 'trocadero'])
  .filter((part, index, all) => all.indexOf(part) === index)
  .sort((a, b) => b.length - a.length);

function requestedArrondissement(text) {
  const postal = text.match(/\b750(\d{2})\b/);
  if (postal) return String(Number(postal[1]));
  const ordinal = text.match(/\b(\d{1,2})\s*(?:st|nd|rd|th|e|eme|er)?\s*(?:arr|arrondissement|arrondissements)\b/);
  return ordinal && Number(ordinal[1]) >= 1 && Number(ordinal[1]) <= 20 ? String(Number(ordinal[1])) : '';
}

function requestedPlace(text) {
  return KNOWN_PLACES.find((place) => has(text, place)) || '';
}

function locationMatcher(text) {
  const arrondissement = requestedArrondissement(text);
  const place = requestedPlace(text);
  if (!arrondissement && !place) return null;
  // "Near the Louvre" also covers the rest of the Louvre's arrondissement.
  const placeArrondissements = new Set(place
    ? ENTRIES.filter((item) => has(item.place, place)).map((item) => item.entry.arrondissement)
    : []);
  return (item) => (arrondissement && item.entry.arrondissement === arrondissement)
    || (place && (has(item.place, place) || placeArrondissements.has(item.entry.arrondissement)));
}

// Checked by eye: each photo shows the kind of place it stands for. Restaurants
// return null and keep the cuisine-aware fallback the cards already use.
const PHOTO = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=84`;
const SUBCATEGORY_PHOTOS = {
  museum: PHOTO('1554907984-15263bfd63bd'),             // a picture gallery
  monument: PHOTO('1524396309943-e03f5249f002'),        // Paris roofs to the Eiffel Tower
  garden_park: PHOTO('1585320806297-9794b3e4eeae'),
  kids_family_activity: PHOTO('1585320806297-9794b3e4eeae'),
  jazz_club: PHOTO('1415201364774-f6f0bb35f28f'),
  cabaret_performance: PHOTO('1415201364774-f6f0bb35f28f'),
  nightclub_exclusive_bar: PHOTO('1566737236500-c8ac43014a67'),
  cocktail_bar: PHOTO('1514362545857-3bc16c4c7d1b'),
  rooftop_bar: PHOTO('1514362545857-3bc16c4c7d1b'),
  wine_bar: PHOTO('1470337458703-46ad1756a187'),
  historic_cafe: PHOTO('1554118811-1e0d58224f24'),
  bakery: PHOTO('1509440159596-0249088772ff'),
  patisserie: PHOTO('1509440159596-0249088772ff'),
  cooking_baking_class: PHOTO('1556910103-1c02745aae4d'),
  wine_craft_workshop: PHOTO('1556910103-1c02745aae4d'),
  luxury_boutique: PHOTO('1441986300917-64674bd600d8'),
  department_store_concept: PHOTO('1441986300917-64674bd600d8'),
  sightseeing_dinner_cruise: PHOTO('1499856871958-5b9627545d1a'), // Pont Alexandre III over the Seine
  private_boat_rental: PHOTO('1499856871958-5b9627545d1a'),
  luxury_chauffeur_transport: PHOTO('1499856871958-5b9627545d1a'),
};
const CATEGORY_PHOTOS = {
  spa_wellness: PHOTO('1544161515-4ab6ce6db874'),
  tour_guide: PHOTO('1502602898657-3e91760cbb34'),
  day_trip: PHOTO('1502602898657-3e91760cbb34'),
  museum_attraction: PHOTO('1554907984-15263bfd63bd'),
};
function imageFor(entry) {
  // The pyramid is only honest on the Louvre's own card.
  if (/louvre/i.test(entry.name) && entry.category === 'museum_attraction') return PHOTO('1566127444979-b3d2b654e3d7');
  return SUBCATEGORY_PHOTOS[entry.subcategory] || CATEGORY_PHOTOS[entry.category] || null;
}

export function searchParisDirectory({ query = '', searchQuery = '', location = '', limit = 5 } = {}) {
  // "World-class" is praise, not a class to book.
  const text = fold(`${query} ${searchQuery} ${location}`).replace(/\b(?:world|first) class\b/g, ' ');
  if (!text) return [];
  const broadCategory = CATEGORY_WORDS.find(([, words]) => words.some((word) => has(text, word)))?.[0];
  const matches = (item) => item.words.some((word) => has(text, word));
  const rule = SUBCATEGORY_WORDS.find((item) => !item.place && matches(item))
    || (broadCategory ? undefined : SUBCATEGORY_WORDS.find((item) => item.place && matches(item)));
  const subcategory = rule?.subcategory;
  const mustMention = rule?.narrow ? rule.words.filter((word) => has(text, word)) : [];
  const category = subcategory ? '' : broadCategory;
  if (!subcategory && !category) return [];
  // "Peruvian restaurant" names a cuisine the directory does not carry; a
  // generic restaurant list would ignore what the guest asked for.
  const cuisineWord = text.match(/\b([a-z]+(?:ian|ese|ish|can|ean))\s+(?:restaurant|restaurants|food|cuisine|place|dinner|lunch)\b/)?.[1];
  if (!subcategory && cuisineWord && !['parisian', 'european'].includes(cuisineWord)) return [];
  const inLocation = locationMatcher(text);
  return ENTRIES
    .filter((item) => (subcategory ? item.entry.subcategory === subcategory : item.entry.category === category))
    .filter((item) => !mustMention.length || mustMention.some((word) => has(item.about, word)))
    .filter((item) => !inLocation || inLocation(item))
    // Exact neighbourhood hits first, then the rest of the arrondissement.
    .sort((a, b) => Number(Boolean(requestedPlace(text) && has(b.place, requestedPlace(text))))
      - Number(Boolean(requestedPlace(text) && has(a.place, requestedPlace(text)))))
    .slice(0, limit)
    .map(({ entry }) => ({
      name: entry.name,
      description: entry.description,
      websiteUrl: entry.website,
      imageUrl: imageFor(entry),
      address: entry.address,
      snippet: [entry.neighborhood, entry.price_level, entry.description].filter(Boolean).join(' · '),
      rating: null,
      reviewsCount: null,
      source: 'paris_directory',
    }));
}
