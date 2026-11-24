// Vercel Serverless Function: 实时动态周边餐饮店铺代理（支持 高德 POI 2.0 / Google Places New / 日本 Hot Pepper / OSM 兜底）
// 所有 API Key 均从 Vercel 环境变量读取（AMAP_KEY / GOOGLE_KEY / HOTPEPPER_KEY），绝不暴露给前端！

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function isLikelyJapan(lat, lng) {
  return lat >= 24 && lat <= 46 && lng >= 127.5 && lng <= 154;
}

function isInMainlandChina(lat, lng) {
  return lat >= 18.0 && lat <= 53.6 && lng >= 73.5 && lng <= 135.1 && !isLikelyJapan(lat, lng);
}

// WGS-84 (GPS) -> GCJ-02 (高德火星坐标系)
function wgs84ToGcj02(wgsLat, wgsLng) {
  if (!isInMainlandChina(wgsLat, wgsLng)) return { lat: wgsLat, lng: wgsLng };
  const PI = Math.PI;
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  const x = wgsLng - 105.0;
  const y = wgsLat - 35.0;
  let dLat = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  dLat += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  dLat += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  dLat += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;

  let dLng = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  dLng += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  dLng += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  dLng += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;

  const radLat = (wgsLat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * PI);
  return { lat: wgsLat + dLat, lng: wgsLng + dLng };
}

async function queryAmap(lat, lng, radius, key) {
  const gcj = wgs84ToGcj02(lat, lng);
  const shops = [];
  for (let page = 1; page <= 3; page++) {
    const url = `https://restapi.amap.com/v5/place/around?key=${encodeURIComponent(key)}&location=${gcj.lng.toFixed(6)},${gcj.lat.toFixed(6)}&radius=${radius}&types=050000&page_size=25&page_num=${page}&show_fields=business`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    const data = await res.json();
    if (data.status !== '1') {
      if (page === 1) throw new Error(data.info || 'AMap error');
      break;
    }
    const pois = data.pois || [];
    for (const p of pois) {
      if (!p.name) continue;
      const [pLng, pLat] = (p.location || '').split(',').map(Number);
      const dist = p.distance ? Number(p.distance) : haversineMeters(gcj.lat, gcj.lng, pLat || gcj.lat, pLng || gcj.lng);
      if (dist > radius) continue;
      shops.push({
        name: p.name.trim(),
        address: p.address || p.adname || '',
        distance: dist,
        rawType: p.type || '',
        rawCuisine: p.business?.tag || p.type || '',
        rating: p.business?.rating || '',
        cost: p.business?.cost || '',
        openTime: p.business?.opentime_today || '',
        lat: pLat || gcj.lat,
        lng: pLng || gcj.lng,
        source: 'amap'
      });
    }
    if (pois.length < 25) break;
  }
  return shops;
}

async function queryGooglePlaces(lat, lng, radius, key, lang = 'zh-CN') {
  const url = 'https://places.googleapis.com/v1/places:searchNearby';
  const body = {
    includedTypes: [
      'restaurant', 'fast_food_restaurant', 'ramen_restaurant', 'sushi_restaurant',
      'japanese_restaurant', 'chinese_restaurant', 'korean_restaurant', 'italian_restaurant',
      'hamburger_restaurant', 'pizza_restaurant', 'barbecue_restaurant', 'meal_takeaway'
    ],
    maxResultCount: 20,
    languageCode: lang,
    rankPreference: 'POPULARITY',
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: Math.min(Math.max(radius, 500), 5000)
      }
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.primaryTypeDisplayName,places.priceLevel'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(7000)
  });

  if (!res.ok) throw new Error(`Google Places HTTP ${res.status}`);
  const data = await res.json();
  const priceMap = {
    PRICE_LEVEL_FREE: '免费',
    PRICE_LEVEL_INEXPENSIVE: '平价',
    PRICE_LEVEL_MODERATE: '适中',
    PRICE_LEVEL_EXPENSIVE: '偏高',
    PRICE_LEVEL_VERY_EXPENSIVE: '高端'
  };

  const shops = (data.places || [])
    .filter(p => p.displayName?.text)
    .map(p => {
      const pLat = p.location?.latitude || lat;
      const pLng = p.location?.longitude || lng;
      return {
        name: p.displayName.text.trim(),
        address: p.formattedAddress || '',
        distance: haversineMeters(lat, lng, pLat, pLng),
        rawType: p.primaryTypeDisplayName?.text || (p.types || []).join(' '),
        rawCuisine: (p.types || []).join(' '),
        rating: p.rating ? Number(p.rating).toFixed(1) : '',
        ratingCount: p.userRatingCount || 0,
        budgetText: priceMap[p.priceLevel] || '',
        lat: pLat,
        lng: pLng,
        source: 'google'
      };
    })
    .filter(s => s.distance <= radius);

  shops.sort((a, b) => (parseFloat(b.rating || 0) - parseFloat(a.rating || 0)) || (a.distance - b.distance));
  return shops;
}

async function queryHotPepper(lat, lng, radius, key) {
  const range = radius <= 500 ? 2 : radius <= 1000 ? 3 : radius <= 2000 ? 4 : 5;
  const url = `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?key=${encodeURIComponent(key)}&lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&range=${range}&count=60&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
  const data = await res.json();
  const list = data?.results?.shop || [];
  return list
    .filter(s => s.name)
    .map(s => {
      const sLat = parseFloat(s.lat) || lat;
      const sLng = parseFloat(s.lng) || lng;
      return {
        name: String(s.name).trim(),
        address: s.address || s.station_name || '',
        distance: haversineMeters(lat, lng, sLat, sLng),
        rawType: s.genre?.name || 'restaurant',
        rawCuisine: `${s.genre?.name || ''} ${s.sub_genre?.name || ''} ${s.catch || ''}`,
        budgetText: s.budget?.average || s.budget?.name || '',
        openTime: s.open || '',
        photoUrl: s.photo?.pc?.l || s.photo?.mobile?.l || '',
        shopUrl: s.urls?.pc || '',
        lat: sLat,
        lng: sLng,
        source: 'hotpepper'
      };
    })
    .filter(s => s.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
}

async function queryOverpass(lat, lng, radius, lang = 'zh') {
  const radiusKm = Math.max(0.5, Math.min(5, radius / 1000));
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const bbox = `${(lat - dLat).toFixed(4)},${(lng - dLng).toFixed(4)},${(lat + dLat).toFixed(4)},${(lng + dLng).toFixed(4)}`;
  const q = `[out:json][timeout:6];node["amenity"~"restaurant|fast_food"](${bbox});out 120;`;
  const skipDrink = /(奶茶|茶饮|一点点|喜茶|奈雪|蜜雪冰城|瑞幸|星巴克|Starbucks|スターバックス|ドトール|咖啡|Coffee|Cafe|カフェ|喫茶|酒吧|Bar|Pub|KTV)/i;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  let data = null;
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${ep}?data=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        data = await res.json();
        if (data && Array.isArray(data.elements)) break;
      }
    } catch (_) {}
  }
  if (!data) return [];

  const seen = new Set();
  const shops = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const name = (lang === 'ja'
      ? (tags['name:ja'] || tags.name || tags['name:en'])
      : (tags['name:zh'] || tags.name || tags['name:ja'] || tags['name:en']) || ''
    ).trim();
    if (!name || name.length < 2 || skipDrink.test(name)) continue;
    const dist = haversineMeters(lat, lng, el.lat, el.lon);
    if (dist > radius) continue;
    const key = `${name}_${Math.round(dist / 200)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const addr = [tags['addr:district'] || tags['addr:suburb'], tags['addr:street'] || tags['addr:road'], tags['addr:housenumber']].filter(Boolean).join(' ');
    shops.push({
      name,
      address: addr || '',
      distance: dist,
      rawType: tags.amenity || 'restaurant',
      rawCuisine: tags.cuisine || '',
      brand: tags.brand || '',
      lat: el.lat,
      lng: el.lon,
      source: 'osm'
    });
  }
  shops.sort((a, b) => a.distance - b.distance);
  return shops;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = Math.min(5000, Math.max(500, parseInt(req.query.radius, 10) || 3000));
  const lang = req.query.lang === 'ja' ? 'ja' : 'zh-CN';

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ ok: false, error: 'Missing valid lat/lng' });
    return;
  }

  const amapKey = process.env.AMAP_KEY || '';
  const googleKey = process.env.GOOGLE_KEY || '';
  const hotpepperKey = process.env.HOTPEPPER_KEY || '';
  const inChina = isInMainlandChina(lat, lng);
  const inJapan = isLikelyJapan(lat, lng);

  let shops = [];
  let source = 'none';
  const errors = [];

  // 1. 中国大陆优先高德 POI 2.0（含真实评分、人均、地址）
  if (inChina && amapKey) {
    try {
      shops = await queryAmap(lat, lng, radius, amapKey);
      if (shops.length > 0) source = 'amap';
    } catch (e) {
      errors.push(`amap:${e.message}`);
    }
  }

  // 2. 海外 / 日本：优先 Google Places（含真实星级评价）
  if (shops.length === 0 && !inChina && googleKey) {
    try {
      shops = await queryGooglePlaces(lat, lng, radius, googleKey, lang);
      if (shops.length > 0) source = 'google';
    } catch (e) {
      errors.push(`google:${e.message}`);
    }
  }

  // 3. 日本区域：Hot Pepper Gourmet（完全免费）
  if (shops.length === 0 && inJapan && hotpepperKey) {
    try {
      shops = await queryHotPepper(lat, lng, radius, hotpepperKey);
      if (shops.length > 0) source = 'hotpepper';
    } catch (e) {
      errors.push(`hotpepper:${e.message}`);
    }
  }

  // 4. 免费 OSM 兜底
  if (shops.length === 0) {
    try {
      shops = await queryOverpass(lat, lng, radius, lang === 'ja' ? 'ja' : 'zh');
      if (shops.length > 0) source = 'osm';
    } catch (e) {
      errors.push(`osm:${e.message}`);
    }
  }

  res.status(200).json({
    ok: shops.length > 0,
    source,
    count: shops.length,
    configured: {
      amap: Boolean(amapKey),
      google: Boolean(googleKey),
      hotpepper: Boolean(hotpepperKey)
    },
    shops,
    errors: shops.length === 0 ? errors : undefined
  });
};
