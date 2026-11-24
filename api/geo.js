// Vercel Serverless Function: 服务端高德逆地理编码 & 高德国内 IP 定位（Key 仅保存在 Vercel 环境变量）

function isLikelyJapan(lat, lng) {
  return lat >= 24 && lat <= 46 && lng >= 127.5 && lng <= 154;
}

function isInMainlandChina(lat, lng) {
  return lat >= 18.0 && lat <= 53.6 && lng >= 73.5 && lng <= 135.1 && !isLikelyJapan(lat, lng);
}

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const amapKey = process.env.AMAP_KEY || '';
  const mode = req.query.mode || 'regeo';

  // 模式 1：通过客户端真实 IP 走高德国内 IP 定位
  if (mode === 'ip') {
    if (!amapKey) {
      res.status(200).json({ ok: false, error: 'AMAP_KEY not configured' });
      return;
    }
    try {
      const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const ipParam = fwd && !fwd.includes(':') ? `&ip=${encodeURIComponent(fwd)}` : '';
      const url = `https://restapi.amap.com/v3/ip?key=${encodeURIComponent(amapKey)}${ipParam}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await r.json();
      if (data.status === '1' && typeof data.rectangle === 'string' && data.rectangle.includes(';')) {
        const [p1, p2] = data.rectangle.split(';').map(s => s.split(',').map(Number));
        if (p1.length === 2 && p2.length === 2) {
          const lng = (p1[0] + p2[0]) / 2;
          const lat = (p1[1] + p2[1]) / 2;
          const city = (Array.isArray(data.city) ? data.province : data.city) || data.province || '';
          res.status(200).json({ ok: true, lat, lng, city, district: '', label: city || '当前城市', source: 'amap_ip' });
          return;
        }
      }
      res.status(200).json({ ok: false, error: 'Non-China IP or empty rectangle' });
    } catch (e) {
      res.status(200).json({ ok: false, error: e.message });
    }
    return;
  }

  // 模式 2：逆地理编码 (lat, lng -> 城市 + 区县)
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ ok: false, error: 'Missing lat/lng' });
    return;
  }

  if (amapKey && isInMainlandChina(lat, lng)) {
    try {
      const gcj = wgs84ToGcj02(lat, lng);
      const url = `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(amapKey)}&location=${gcj.lng.toFixed(6)},${gcj.lat.toFixed(6)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await r.json();
      if (data.status === '1' && data.regeocode?.addressComponent) {
        const ac = data.regeocode.addressComponent;
        const city = (Array.isArray(ac.city) ? ac.province : ac.city) || ac.province || '';
        const district = (Array.isArray(ac.district) ? '' : ac.district) || '';
        res.status(200).json({ ok: true, city, locality: district, principalSubdivision: ac.province || '', source: 'amap' });
        return;
      }
    } catch (_) {}
  }

  res.status(200).json({ ok: false, error: 'Fallback to client reverse geocode' });
};
