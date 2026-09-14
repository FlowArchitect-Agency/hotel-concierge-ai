// Curated Paris directory lookup. Answers most discovery requests without a
// live web search; the caller falls back to live search only when nothing here
// fits. Matching is deliberately strict: a guest asking for Italian near the
// Louvre gets Italian near the Louvre or nothing (and then a live search), never
// a Paris-wide substitute.
import DIRECTORY from '../../data/paris-directory.js';

function fold(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function has(text, phrase) {
  return ` ${text} `.includes(` ${phrase} `);
}

// Guest wording -> directory subcategory. Order matters: more specific first.
const SUBCATEGORY_WORDS = [
  ['dinner_cruise', ['dinner cruise', 'diner croisiere', 'dinner on the seine', 'dinner boat']],
  ['private_boat_rental', ['private boat', 'boat rental', 'rent a boat', 'bateau prive']],
  ['sightseeing_cruise', ['seine cruise', 'river cruise', 'boat tour', 'bateau mouche', 'sightseeing cruise']],
  ['michelin_fine_dining', ['michelin', 'fine dining', 'gastronomic', 'gastronomique', 'starred', 'etoile']],
  ['rooftop_bar', ['rooftop', 'roof top', 'terrace bar']],
  ['jazz_club', ['jazz']],
  ['cocktail_bar', ['cocktail', 'speakeasy', 'mixology']],
  ['wine_bar', ['wine bar', 'bar a vin', 'bar a vins', 'natural wine']],
  ['wine_tasting', ['wine tasting', 'degustation', 'sommelier']],
  ['cooking_class', ['cooking class', 'cooking lesson', 'cours de cuisine', 'pastry class', 'baking class']],
  ['perfume_workshop', ['perfume', 'parfum', 'fragrance']],
  ['art_class', ['art class', 'painting class', 'art workshop']],
  ['food_tour', ['food tour', 'culinary tour', 'tasting tour']],
  ['bike_or_vespa_tour', ['bike tour', 'vespa', 'cycling tour', 'bicycle']],
  ['photo_tour', ['photo shoot', 'photoshoot', 'photographer', 'photo tour']],
  ['museum_private_guide', ['museum guide', 'private guide for the louvre', 'museum tour']],
  ['private_walking_tour', ['walking tour', 'private tour', 'private guide', 'city tour']],
  ['versailles', ['versailles']],
  ['giverny', ['giverny', 'monet']],
  ['champagne_region', ['champagne', 'reims', 'epernay']],
  ['loire_castles', ['loire', 'chambord', 'chenonceau']],
  ['mont_saint_michel', ['mont saint michel']],
  ['normandy', ['normandy', 'normandie', 'd day']],
  ['cabaret', ['cabaret', 'moulin rouge', 'lido', 'crazy horse']],
  ['nightclub', ['nightclub', 'night club', 'clubbing', 'dance club']],
  ['helicopter_tour', ['helicopter']],
  ['airport_transfer', ['airport', 'cdg', 'orly', 'transfer']],
  ['private_chauffeur', ['chauffeur', 'private driver', 'car with driver']],
  ['hammam', ['hammam', 'turkish bath']],
  ['massage', ['massage']],
  ['luxury_hotel_spa', ['hotel spa', 'palace spa']],
  ['day_spa', ['day spa', 'spa']],
  ['department_store', ['department store', 'galeries lafayette', 'printemps', 'bon marche']],
  ['luxury_boutique', ['luxury boutique', 'designer', 'haute couture', 'luxury shopping']],
  ['market', ['flea market', 'market', 'marche aux puces']],
  ['vintage_concept_store', ['vintage', 'concept store']],
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
  // Place-like words last, so "Italian near the Opera" stays Italian.
  ['opera_ballet', ['opera', 'ballet']],
  ['kids_activity', ['kids', 'children', 'child friendly', 'family activity', 'enfants']],
  ['museum', ['museum', 'musee', 'gallery']],
  ['monument', ['monument', 'landmark']],
  ['garden_park', ['garden', 'park', 'jardin']],
].map(([subcategory, words]) => [subcategory, words.map(fold)]);

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

export function searchParisDirectory({ query = '', searchQuery = '', location = '', limit = 5 } = {}) {
  const text = fold(`${query} ${searchQuery} ${location}`);
  if (!text) return [];
  const subcategory = SUBCATEGORY_WORDS.find(([, words]) => words.some((word) => has(text, word)))?.[0];
  const category = subcategory ? '' : CATEGORY_WORDS.find(([, words]) => words.some((word) => has(text, word)))?.[0];
  if (!subcategory && !category) return [];
  // "Peruvian restaurant" names a cuisine the directory does not carry; a
  // generic restaurant list would ignore what the guest asked for.
  const cuisineWord = text.match(/\b([a-z]+(?:ian|ese|ish|can|ean))\s+(?:restaurant|restaurants|food|cuisine|place|dinner|lunch)\b/)?.[1];
  if (!subcategory && cuisineWord && !['parisian', 'european'].includes(cuisineWord)) return [];
  const inLocation = locationMatcher(text);
  return ENTRIES
    .filter((item) => (subcategory ? item.entry.subcategory === subcategory : item.entry.category === category))
    .filter((item) => !inLocation || inLocation(item))
    // Exact neighbourhood hits first, then the rest of the arrondissement.
    .sort((a, b) => Number(Boolean(requestedPlace(text) && has(b.place, requestedPlace(text))))
      - Number(Boolean(requestedPlace(text) && has(a.place, requestedPlace(text)))))
    .slice(0, limit)
    .map(({ entry }) => ({
      name: entry.name,
      description: entry.description,
      websiteUrl: entry.website,
      imageUrl: null,
      address: entry.address,
      snippet: [entry.neighborhood, entry.price_level, entry.description].filter(Boolean).join(' · '),
      rating: null,
      reviewsCount: null,
      source: 'paris_directory',
    }));
}
