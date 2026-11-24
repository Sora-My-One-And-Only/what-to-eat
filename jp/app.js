(function () {
  // 旧細分化ジャンルを7大ジャンルへ統合し、世界の料理パック（JP_GLOBAL_RECIPES）と合流
  function normalizeJpCuisine(item) {
    const c = item.cuisine || '';
    const n = item.name || '';
    if (c === '定番和食' || c === '丼もの' || c === '鍋・スープ') return '和食・丼・鍋';
    if (c === 'ラーメン・麺類') return '麺類・パスタ';
    if (c === '洋食・パスタ') {
      return /(パスタ|ナポリタン|ペペロン|カルボナーラ|ボロネーゼ|スパゲッティ)/.test(n) ? '麺類・パスタ' : '洋食・欧米料理';
    }
    if (c === '町中華') return '中華・台湾料理';
    if (c === 'カレー・エスニック' || c === '韓国・アジア') return '韓国・エスニック';
    if (c === '焼肉・ガッツリ') return 'ガッツリ肉・揚げ物';
    if (c === '軽食・ヘルシー') return '軽食・朝ごはん・サラダ';
    return c || '和食・丼・鍋';
  }

  const rawCombined = [
    ...(window.JP_DISHES_DATA || []),
    ...(window.JP_GLOBAL_RECIPES || []),
    ...(window.JP_EXPANDED_PACK || []),
    ...(window.JP_EXPANDED_PACK_2 || [])
  ];
  const seenNames = new Set();
  const staticDishes = [];
  for (const d of rawCombined) {
    if (!d || !d.name || seenNames.has(d.name)) continue;
    seenNames.add(d.name);
    let modes = [...(d.modes || [])];
    let lazyTool = d.lazyTool || '';
    // ズボラ飯は「材料シンプル・手順3ステップ以内・15分以内（またはレンチン/炊飯器）」に厳選
    if (modes.includes('lazy')) {
      const m = String(d.time || '').match(/(\d+)/);
      const mins = m ? parseInt(m[1], 10) : 15;
      const isAppliance = /(レンジ|レンチン|炊飯器|トースター|火を使わない|混ぜるだけ)/.test(lazyTool + d.name);
      const tooComplex = (!isAppliance && mins > 15) || (d.ingredients || []).length > 8 || /(揚げる|揚げ油|煮込み20分|保温45分)/.test(lazyTool + (d.steps || []).join(' '));
      if (tooComplex) {
        modes = modes.filter(x => x !== 'lazy');
        lazyTool = '';
      }
    }
    staticDishes.push({ ...d, cuisine: normalizeJpCuisine(d), modes, lazyTool });
  }
  const jpSubstitutions = window.JP_SUBSTITUTIONS || [];
  const CARD_HEIGHT = 196;

  // 状態管理（日本版専用キーで保存・中国語版と競合しない）
  const state = {
    meal: 'breakfast',
    mode: 'cook', // 'cook' | 'lazy' | 'takeout' | 'guess'
    cuisine: 'all',
    radius: 3000,
    googleKey: localStorage.getItem('jp_food_google_key') || localStorage.getItem('food_rec_google_key') || '',
    hotpepperKey: localStorage.getItem('jp_food_hotpepper_key') || localStorage.getItem('food_rec_hotpepper_key') || '',
    isSpinning: false,
    currentDish: null,
    displayedPoolCount: 0,
    history: [],
    nearbyShops: [],
    nearbySource: 'osm',
    nearbyLoading: false,
    nearbyScannedKey: '',
    location: {
      lat: null,
      lng: null,
      city: '',
      district: '',
      label: '現在地',
      ready: false,
      denied: false,
      locating: false
    }
  };

  // ローカル時刻で朝・昼・夜を自動プリセット
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) state.meal = 'breakfast';
  else if (hour >= 10 && hour < 16) state.meal = 'lunch';
  else state.meal = 'dinner';

  // DOM 参照
  const mealGroup = document.getElementById('mealGroup');
  const mealSkyHint = document.getElementById('mealSkyHint');
  const modeGroup = document.getElementById('modeGroup');
  const cuisineGroup = document.getElementById('cuisineGroup');
  const poolCountEl = document.getElementById('poolCount');
  const cookStatusLayer = document.getElementById('cookStatusLayer');
  const lazyStatusLayer = document.getElementById('lazyStatusLayer');
  const takeoutStatusLayer = document.getElementById('takeoutStatusLayer');
  const guessStatusLayer = document.getElementById('guessStatusLayer');
  const guessStatusText = document.getElementById('guessStatusText');
  const ritualSpotlight = document.getElementById('ritualSpotlight');
  const slotMachineSection = document.getElementById('slotMachineSection');
  const slotFrame = document.getElementById('slotFrame');
  const slotWindow = document.getElementById('slotWindow');
  const slotReel = document.getElementById('slotReel');
  const slotShockwave = document.getElementById('slotShockwave');
  const slotShockwave2 = document.getElementById('slotShockwave2');
  const slotFlashSweep = document.getElementById('slotFlashSweep');
  const slotWinBanner = document.getElementById('slotWinBanner');
  const btnDraw = document.getElementById('btnDraw');
  const resultDock = document.getElementById('resultDock');
  const dockIdle = document.getElementById('dockIdle');
  const dockIdleText = document.getElementById('dockIdleText');
  const dockResult = document.getElementById('dockResult');
  const resultActionContent = document.getElementById('resultActionContent');
  const locDot = document.getElementById('locDot');
  const locText = document.getElementById('locText');
  const btnRelocate = document.getElementById('btnRelocate');
  const btnSourceConfig = document.getElementById('btnSourceConfig');
  const radiusSelect = document.getElementById('radiusSelect');
  const historyList = document.getElementById('historyList');
  const fxCanvas = document.getElementById('fxCanvas');

  const recipeModal = document.getElementById('recipeModal');
  const modalEmoji = document.getElementById('modalEmoji');
  const modalDishName = document.getElementById('modalDishName');
  const modalTags = document.getElementById('modalTags');
  const modalBody = document.getElementById('modalBody');
  const modalFooter = document.getElementById('modalFooter');
  const btnCloseModal = document.getElementById('btnCloseModal');

  const sourceModal = document.getElementById('sourceModal');
  const sourceStatusBadge = document.getElementById('sourceStatusBadge');
  const googleKeyInput = document.getElementById('googleKeyInput');
  const hotpepperKeyInput = document.getElementById('hotpepperKeyInput');
  const btnCloseSourceModal = document.getElementById('btnCloseSourceModal');
  const btnSaveSource = document.getElementById('btnSaveSource');
  const btnResetSource = document.getElementById('btnResetSource');

  const tasteModal = document.getElementById('tasteModal');
  const tasteModalBody = document.getElementById('tasteModalBody');
  const tasteCountBadge = document.getElementById('tasteCountBadge');
  const btnCloseTasteModal = document.getElementById('btnCloseTasteModal');
  const btnExportTaste = document.getElementById('btnExportTaste');
  const btnImportTaste = document.getElementById('btnImportTaste');
  const btnClearTaste = document.getElementById('btnClearTaste');
  const tasteImportFile = document.getElementById('tasteImportFile');

  const cuisineBaseLabels = new Map();
  cuisineGroup.querySelectorAll('.cuisine-chip').forEach(btn => {
    cuisineBaseLabels.set(btn.dataset.cuisine, btn.textContent.trim());
  });

  // トースト通知
  const toastEl = document.createElement('div');
  toastEl.className = 'copy-toast';
  document.body.appendChild(toastEl);
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2300);
  }

  // =========================================================================
  // 1. 花火＆絵文字パーティクル演出 (60fps Canvas)
  // =========================================================================
  const ctx = fxCanvas.getContext('2d');
  let particles = [];
  let animFrameId = null;

  function resizeCanvas() {
    fxCanvas.width = window.innerWidth * window.devicePixelRatio;
    fxCanvas.height = window.innerHeight * window.devicePixelRatio;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function ensureParticleLoop() {
    if (!animFrameId) renderParticles();
  }

  function emitSpinSparks() {
    const rect = slotFrame.getBoundingClientRect();
    const sparkColors = ['#fde047', '#fb923c', '#38bdf8', '#f472b6'];
    for (let i = 0; i < 4; i++) {
      const fromLeft = Math.random() > 0.5;
      particles.push({
        kind: 'spark',
        x: fromLeft ? rect.left + Math.random() * 24 : rect.right - Math.random() * 24,
        y: rect.top + Math.random() * rect.height,
        vx: (fromLeft ? -1 : 1) * (0.4 + Math.random() * 1.4),
        vy: -(1.8 + Math.random() * 2.8),
        size: 2.2 + Math.random() * 2.4,
        color: sparkColors[Math.floor(Math.random() * sparkColors.length)],
        gravity: -0.02,
        drag: 0.99,
        alpha: 0.95,
        decay: 0.032 + Math.random() * 0.02
      });
    }
    ensureParticleLoop();
  }

  function triggerJackpotFireworks(winnerEmoji) {
    const rect = slotWindow.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colors = ['#fde047', '#fb923c', '#ff5722', '#ec4899', '#38bdf8', '#4ade80', '#ffffff'];

    for (let i = 0; i < 64; i++) {
      const angle = (Math.PI * 2 * i) / 64 + (Math.random() - 0.5) * 0.22;
      const speed = 4.2 + Math.random() * 8.5;
      particles.push({
        kind: i % 4 === 0 ? 'star' : 'ribbon',
        x: cx + (Math.random() - 0.5) * 60,
        y: cy + (Math.random() - 0.5) * 24,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.8,
        size: 5 + Math.random() * 5.5,
        color: colors[i % colors.length],
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.28,
        gravity: 0.2,
        drag: 0.982,
        alpha: 1,
        decay: 0.012 + Math.random() * 0.009
      });
    }

    const emojiChar = winnerEmoji || '🎉';
    for (let i = 0; i < 8; i++) {
      const angle = -Math.PI * 0.85 + (Math.PI * 0.7 * i) / 7 + (Math.random() - 0.5) * 0.15;
      const speed = 5.2 + Math.random() * 3.8;
      particles.push({
        kind: 'emoji',
        emoji: emojiChar,
        x: cx + (Math.random() - 0.5) * 50,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        size: 20 + Math.random() * 8,
        rotation: (Math.random() - 0.5) * 0.5,
        vRot: (Math.random() - 0.5) * 0.08,
        gravity: 0.19,
        drag: 0.985,
        alpha: 1,
        decay: 0.013
      });
    }

    setTimeout(() => {
      const fRect = slotFrame.getBoundingClientRect();
      const leftX = fRect.left + 12;
      const rightX = fRect.right - 12;
      const cannonY = fRect.bottom - 18;
      for (let i = 0; i < 28; i++) {
        const aL = -Math.PI * 0.22 - Math.random() * 0.45;
        const spL = 7 + Math.random() * 6.5;
        particles.push({
          kind: i % 3 === 0 ? 'star' : 'ribbon',
          x: leftX, y: cannonY,
          vx: Math.cos(aL) * spL, vy: Math.sin(aL) * spL,
          size: 4.5 + Math.random() * 5, color: colors[i % colors.length],
          rotation: Math.random() * Math.PI * 2, vRot: (Math.random() - 0.5) * 0.3,
          gravity: 0.22, drag: 0.982, alpha: 1, decay: 0.012 + Math.random() * 0.008
        });
        const aR = -Math.PI * 0.78 + Math.random() * 0.45;
        const spR = 7 + Math.random() * 6.5;
        particles.push({
          kind: i % 3 === 0 ? 'star' : 'ribbon',
          x: rightX, y: cannonY,
          vx: Math.cos(aR) * spR, vy: Math.sin(aR) * spR,
          size: 4.5 + Math.random() * 5, color: colors[(i + 2) % colors.length],
          rotation: Math.random() * Math.PI * 2, vRot: (Math.random() - 0.5) * 0.3,
          gravity: 0.22, drag: 0.982, alpha: 1, decay: 0.012 + Math.random() * 0.008
        });
      }
      ensureParticleLoop();
    }, 200);

    ensureParticleLoop();
  }

  function drawStar(c, r) {
    c.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      c.lineTo(Math.cos(a + Math.PI / 4) * (r * 0.35), Math.sin(a + Math.PI / 4) * (r * 0.35));
    }
    c.closePath();
    c.fill();
  }

  function renderParticles() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    particles = particles.filter(p => p.alpha > 0.02);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity ?? 0.2;
      p.vx *= p.drag ?? 0.985;
      p.rotation = (p.rotation || 0) + (p.vRot || 0);
      p.alpha -= p.decay;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation || 0);

      if (p.kind === 'emoji') {
        ctx.font = `${Math.round(p.size)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.emoji, 0, 0);
      } else if (p.kind === 'spark') {
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 8;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'star') {
        ctx.fillStyle = p.color;
        drawStar(ctx, p.size * 0.85);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.roundRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.58, 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (particles.length > 0) animFrameId = requestAnimationFrame(renderParticles);
    else {
      animFrameId = null;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  // =========================================================================
  // 2. Web Audio ガチャ効果音
  // =========================================================================
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playWindupSound() {
    try {
      const ac = getAudioCtx();
      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(620, now + 0.26);
      gain.gain.setValueAtTime(0.005, now);
      gain.gain.linearRampToValueAtTime(0.055, now + 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.29);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (_) {}
  }

  function playTickSound(freq = 520, volume = 0.045) {
    try {
      const ac = getAudioCtx();
      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.72, now + 0.036);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.038);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    } catch (_) {}
  }

  function playSelectSound() {
    playTickSound(640, 0.025);
  }

  function playJackpotFanfare() {
    try {
      const ac = getAudioCtx();
      const now = ac.currentTime;
      const bass = ac.createOscillator();
      const bassGain = ac.createGain();
      bass.type = 'triangle';
      bass.frequency.setValueAtTime(130.81, now);
      bass.frequency.exponentialRampToValueAtTime(65.41, now + 0.35);
      bassGain.gain.setValueAtTime(0.12, now);
      bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      bass.connect(bassGain);
      bassGain.connect(ac.destination);
      bass.start(now);
      bass.stop(now + 0.4);

      const notes = [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.51];
      notes.forEach((n, idx) => {
        const t = now + idx * 0.055;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = idx >= 4 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(n, t);
        gain.gain.setValueAtTime(0.075, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + (idx === notes.length - 1 ? 0.55 : 0.28));
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(t);
        osc.stop(t + 0.6);
      });
    } catch (_) {}
  }

  // =========================================================================
  // 3. 完全オフライン食の好み学習エンジン (localStorage)
  // =========================================================================
  const TASTE_STORAGE_KEY = 'jp_food_rec_taste_v1';

  const FLAVOR_DIMENSIONS = [
    { key: '和風だし・あっさり', regex: /(和食|鮭|サバ|ぶり|味噌|だし|茶漬け|そば|おにぎり|納豆|豆腐|豚汁|鍋|ポン酢|寿司|さっぱり)/ },
    { key: 'こってり・ガッツリ', regex: /(ガッツリ|焼肉|唐揚げ|カツ|ハンバーグ|豚バラ|油そば|ラーメン|チーズ|チキン南蛮|マヨ|背徳|とんかつ)/ },
    { key: '甘辛・照り焼き', regex: /(照り焼き|生姜焼き|牛丼|親子丼|肉じゃが|そぼろ|回鍋肉|ヤンニョム|甘辛|甘酢)/ },
    { key: 'ピリ辛・スタミナ', regex: /(ピリ辛|旨辛|麻婆|担々|キムチ|スンドゥブ|カレー|ビビンバ|にんにく|スタミナ|スパイス)/ },
    { key: '麺・炭水化物', regex: /(ラーメン|うどん|そば|パスタ|焼きそば|つけ麺|丼|チャーハン|オムライス|トースト)/ },
    { key: '洋風・クリーミー', regex: /(洋食|パスタ|シチュー|オムライス|バター|クリーム|豆乳|チーズ|グラタン|バーガー|ピザ|ポトフ)/ },
    { key: 'ヘルシー・野菜', regex: /(ヘルシー|サラダ|豆腐|オートミール|低糖質|高タンパク|ピーマン|ポキ|アボカド|スープ|野菜)/ },
    { key: '時短・レンチン', regex: /(レンチン|レンジ|炊飯器|ズボラ|5分|10分|ワンパン|包丁いらず|冷凍うどん|コンビニ)/ }
  ];

  function createEmptyTasteProfile() {
    return {
      version: 1,
      totalDraws: 0,
      totalInteractions: 0,
      mealCounts: { breakfast: 0, lunch: 0, dinner: 0 },
      modeCounts: { cook: 0, lazy: 0, takeout: 0, guess: 0 },
      cuisineScores: {},
      flavorScores: {},
      likedItems: [],
      dislikedItems: [],
      recentHistory: []
    };
  }

  function loadTasteProfile() {
    try {
      const raw = localStorage.getItem(TASTE_STORAGE_KEY);
      if (!raw) return createEmptyTasteProfile();
      const parsed = JSON.parse(raw);
      return {
        ...createEmptyTasteProfile(),
        ...parsed,
        mealCounts: { breakfast: 0, lunch: 0, dinner: 0, ...(parsed.mealCounts || {}) },
        modeCounts: { cook: 0, lazy: 0, takeout: 0, guess: 0, ...(parsed.modeCounts || {}) },
        cuisineScores: { ...(parsed.cuisineScores || {}) },
        flavorScores: { ...(parsed.flavorScores || {}) },
        likedItems: Array.isArray(parsed.likedItems) ? parsed.likedItems : [],
        dislikedItems: Array.isArray(parsed.dislikedItems) ? parsed.dislikedItems : [],
        recentHistory: Array.isArray(parsed.recentHistory) ? parsed.recentHistory : []
      };
    } catch (_) {
      return createEmptyTasteProfile();
    }
  }

  let tasteProfile = loadTasteProfile();

  function saveTasteProfile() {
    try {
      localStorage.setItem(TASTE_STORAGE_KEY, JSON.stringify(tasteProfile));
    } catch (_) {}
  }

  function extractItemFlavors(item) {
    const text = `${item?.name || ''} ${item?.tag || ''} ${item?.cuisine || ''} ${item?.lazyTool || ''}`;
    const matched = [];
    for (const dim of FLAVOR_DIMENSIONS) {
      if (dim.regex.test(text)) matched.push(dim.key);
    }
    return matched.length > 0 ? matched : ['和風だし・あっさり'];
  }

  function bumpScoreMap(map, key, delta) {
    if (!key || key === 'all' || key === '厳選') return;
    map[key] = Number(((map[key] || 0) + delta).toFixed(2));
    if (map[key] < -20) map[key] = -20;
  }

  function isItemLiked(name) {
    return tasteProfile.likedItems.some(x => x.name === name);
  }

  function isItemDisliked(name) {
    return tasteProfile.dislikedItems.some(x => x.name === name);
  }

  function recordTasteSignal(signalType, payload) {
    const now = Date.now();
    tasteProfile.totalInteractions += 1;

    if (signalType === 'select_cuisine') {
      bumpScoreMap(tasteProfile.cuisineScores, payload?.cuisine, 0.6);
    } else if (signalType === 'draw' && payload?.item) {
      const { item, meal, mode } = payload;
      tasteProfile.totalDraws += 1;
      if (meal && tasteProfile.mealCounts[meal] != null) tasteProfile.mealCounts[meal] += 1;
      if (mode && tasteProfile.modeCounts[mode] != null) tasteProfile.modeCounts[mode] += 1;
      bumpScoreMap(tasteProfile.cuisineScores, item.cuisine, 1.2);
      extractItemFlavors(item).forEach(f => bumpScoreMap(tasteProfile.flavorScores, f, 1));
      tasteProfile.recentHistory = [
        { name: item.name, cuisine: item.cuisine, meal, mode, ts: now },
        ...tasteProfile.recentHistory.filter(x => x.name !== item.name || now - x.ts > 3600 * 1000)
      ].slice(0, 80);
    } else if (signalType === 'open_detail' && payload?.item) {
      bumpScoreMap(tasteProfile.cuisineScores, payload.item.cuisine, 2.5);
      extractItemFlavors(payload.item).forEach(f => bumpScoreMap(tasteProfile.flavorScores, f, 2));
    } else if (signalType === 'copy' && payload?.item) {
      bumpScoreMap(tasteProfile.cuisineScores, payload.item.cuisine, 3.5);
      extractItemFlavors(payload.item).forEach(f => bumpScoreMap(tasteProfile.flavorScores, f, 2.5));
    } else if (signalType === 'like' && payload?.item) {
      const { item } = payload;
      const already = isItemLiked(item.name);
      tasteProfile.dislikedItems = tasteProfile.dislikedItems.filter(x => x.name !== item.name);
      if (already) {
        tasteProfile.likedItems = tasteProfile.likedItems.filter(x => x.name !== item.name);
        bumpScoreMap(tasteProfile.cuisineScores, item.cuisine, -4);
      } else {
        tasteProfile.likedItems = [
          { name: item.name, cuisine: item.cuisine, tag: item.tag || '', emoji: item.emoji || '🍲', ts: now },
          ...tasteProfile.likedItems
        ].slice(0, 60);
        bumpScoreMap(tasteProfile.cuisineScores, item.cuisine, 8);
        extractItemFlavors(item).forEach(f => bumpScoreMap(tasteProfile.flavorScores, f, 5));
      }
    } else if (signalType === 'dislike' && payload?.item) {
      const { item } = payload;
      const already = isItemDisliked(item.name);
      tasteProfile.likedItems = tasteProfile.likedItems.filter(x => x.name !== item.name);
      if (already) {
        tasteProfile.dislikedItems = tasteProfile.dislikedItems.filter(x => x.name !== item.name);
        bumpScoreMap(tasteProfile.cuisineScores, item.cuisine, 4);
      } else {
        tasteProfile.dislikedItems = [
          { name: item.name, cuisine: item.cuisine, tag: item.tag || '', ts: now },
          ...tasteProfile.dislikedItems
        ].slice(0, 60);
        bumpScoreMap(tasteProfile.cuisineScores, item.cuisine, -6);
        extractItemFlavors(item).forEach(f => bumpScoreMap(tasteProfile.flavorScores, f, -3.5));
      }
    }

    saveTasteProfile();
    updateGuessStatusSummary();
  }

  function getTopEntries(scoreMap, limit = 5) {
    return Object.entries(scoreMap || {})
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  function computePersonalizedMatch(item) {
    if (isItemDisliked(item.name)) return { rawScore: -999, pct: 30, reason: 'パス済み' };
    const now = Date.now();
    const topC = getTopEntries(tasteProfile.cuisineScores, 10);
    const maxC = topC[0]?.[1] || 1;
    const topF = getTopEntries(tasteProfile.flavorScores, 8);
    const maxF = topF[0]?.[1] || 1;
    const hasHistory = tasteProfile.totalInteractions >= 3;

    let raw = 50;
    let bestReason = '';

    const cScore = tasteProfile.cuisineScores[item.cuisine] || 0;
    if (hasHistory && cScore > 0) {
      const cBoost = Math.min(28, (cScore / maxC) * 28);
      raw += cBoost;
      if (cBoost >= 14) bestReason = `よく選ぶ${item.cuisine}`;
    } else if (cScore < 0) {
      raw += Math.max(-18, cScore * 1.5);
    }

    let flavorBoost = 0;
    let topFlavor = '';
    for (const f of extractItemFlavors(item)) {
      const fs = tasteProfile.flavorScores[f] || 0;
      if (hasHistory && fs > 0) {
        const contrib = (fs / maxF) * 14;
        if (contrib > flavorBoost) {
          flavorBoost = contrib;
          topFlavor = f;
        }
      }
    }
    raw += Math.min(20, flavorBoost);
    if (!bestReason && topFlavor) bestReason = `「${topFlavor}」好み`;

    if (isItemLiked(item.name)) {
      raw += 16;
      bestReason = 'お気に入り登録済';
    }

    const totalModes = Object.values(tasteProfile.modeCounts).reduce((a, b) => a + b, 0);
    if (totalModes >= 4) {
      if ((tasteProfile.modeCounts.lazy || 0) / totalModes >= 0.35 && item.modes?.includes('lazy')) raw += 8;
      if ((tasteProfile.modeCounts.takeout || 0) / totalModes >= 0.35 && item.isRealShop) raw += 8;
    }

    if (item.aiPick) {
      raw += 9;
      if (!bestReason) bestReason = '定番ハズレなし';
    }
    if (item.isRealShop && item.rating && parseFloat(item.rating) >= 4.0) {
      raw += 10;
      if (!bestReason) bestReason = `周辺高評価 ★${item.rating}`;
    }

    const recentEntry = tasteProfile.recentHistory.find(h => h.name === item.name && now - h.ts < 24 * 3600 * 1000);
    if (recentEntry) raw -= 22;
    if (item.meals?.includes(state.meal)) raw += 6;

    const pct = Math.max(68, Math.min(99, Math.round(raw)));
    return {
      rawScore: raw,
      pct,
      reason: bestReason || (hasHistory ? 'あなたの傾向にマッチ' : '人気の定番おすすめ')
    };
  }

  function updateGuessStatusSummary() {
    if (!guessStatusText) return;
    const topC = getTopEntries(tasteProfile.cuisineScores, 2).map(x => x[0]);
    const topF = getTopEntries(tasteProfile.flavorScores, 2).map(x => x[0]);
    if (tasteProfile.totalInteractions < 3) {
      guessStatusText.textContent = 'おすすめ · ガチャや 👍/👎 を押すほどローカルで好みを学習します';
    } else {
      const prefText = [...topC, ...topF].slice(0, 3).join(' · ') || 'バランス派';
      guessStatusText.textContent = `学習済み（${tasteProfile.totalDraws}回）· 傾向：${prefText}`;
    }
  }

  // =========================================================================
  // 4. 日本特化・周辺実店舗ジャンル分類＆マルチAPI検索エンジン（7大ジャンル対応）
  // =========================================================================
  const jpShopClassifier = [
    {
      cuisine: '麺類・パスタ',
      emoji: '🍜',
      tag: '麺類・パスタ',
      combos: ['特製味玉ラーメン＋半ライス', '明太子パスタ＆サラダセット', 'かけうどん＋かしわ天'],
      regex: /(ラーメン|らーめん|拉麺|つけ麺|油そば|まぜそば|家系|二郎|一蘭|一風堂|天下一品|幸楽苑|日高屋|うどん|丸亀製麺|はなまる|そば|蕎麦|富士そば|ゆで太郎|パスタ|五右衛門|鎌倉パスタ|ramen|noodle|udon|soba|pasta)/i
    },
    {
      cuisine: '韓国・エスニック',
      emoji: '🍛',
      tag: '韓国・カレー・アジア',
      combos: ['ロースカツカレー', 'バターチキン＆チーズナン', 'スンドゥブチゲ・ビビンバ定食'],
      regex: /(カレー|CoCo壱|ココイチ|スープカレー|インド|ネパール|タイ|タイ料理|ベトナム|フォー|エスニック|韓国|サムギョプサル|スンドゥブ|ビビンバ|チヂミ|ヤンニョム|タッカルビ|curry|indian|thai|vietnamese|korean)/i
    },
    {
      cuisine: '中華・台湾料理',
      emoji: '🥟',
      tag: '中華・台湾料理',
      combos: ['焼餃子＆炒飯セット', '麻婆豆腐定食', '油淋鶏＆小籠包セット'],
      regex: /(中華|餃子|王将|バーミヤン|四川|麻婆|担々|点心|飲茶|小籠包|台湾|魯肉飯|chinese)/i
    },
    {
      cuisine: 'ガッツリ肉・揚げ物',
      emoji: '🥩',
      tag: '焼肉・とんかつ・肉',
      combos: ['カルビ＆ハラミ焼肉定食', 'ロースかつ定食', '特製からあげ定食'],
      regex: /(焼肉|ホルモン|ステーキ|とんかつ|トンカツ|和幸|さぼてん|からあげ|からやま|から好し|焼鳥|焼き鳥|鳥貴族|串カツ|ケンタッキー|KFC|yakiniku|steak|tonkatsu|bbq)/i
    },
    {
      cuisine: '洋食・欧米料理',
      emoji: '🍝',
      tag: '洋食・イタリアン・欧米',
      combos: ['ハンバーグ＆ライスセット', 'チーズバーガー＆ポテトセット', 'マルゲリータピザ＆サラダ'],
      regex: /(サイゼリヤ|ガスト|ジョナサン|デニーズ|ロイヤルホスト|びっくりドンキー|マクドナルド|モスバーガー|バーガーキング|ドミノ|ピザーラ|イタリアン|フレンチ|洋食|オムライス|ピザ|ハンバーガー|ファミレス|ハンバーグ|メキシカン|タコス|italian|french|burger|pizza|mexican)/i
    },
    {
      cuisine: '軽食・朝ごはん・サラダ',
      emoji: '🥪',
      tag: 'カフェ・軽食・サラダ',
      combos: ['サンドイッチ＆カフェセット', 'パワーサラダボウル', 'モーニングトーストセット'],
      regex: /(サブウェイ|サラダ|サンドイッチ|ベーカリー|パン|コメダ|ベローチェ|サンマルク|スープストック|Soup Stock|sandwich|salad|bakery)/i
    }
  ];

  function classifyNearbyShop(rawShop) {
    const combined = `${rawShop.name} ${rawShop.rawCuisine || ''} ${rawShop.rawType || ''} ${rawShop.brand || ''}`;
    let matchedCuisine = '和食・丼・鍋';
    let emoji = '🍱';
    let tag = '和食・丼・定食';
    let combos = ['お店自慢の日替わり和定食', '人気丼＋みそ汁セット', 'テイクアウトおすすめセット'];

    for (const rule of jpShopClassifier) {
      if (rule.regex.test(combined)) {
        matchedCuisine = rule.cuisine;
        emoji = rule.emoji;
        tag = rule.tag;
        combos = rule.combos;
        break;
      }
    }

    if (matchedCuisine === '和食・丼・鍋') {
      if (/(寿司|すし|鮨|スシロー|くら寿司|はま寿司|かっぱ寿司|回転寿司|sushi)/i.test(combined)) {
        emoji = '🍣';
        tag = '寿司・海鮮';
        combos = ['人気にぎり盛り合わせ', 'サーモン＆マグロ丼セット'];
      } else if (/(吉野家|松屋|すき家|なか卯|牛丼|親子丼|カツ丼|かつや|天丼|てんや|海鮮丼)/.test(combined)) {
        emoji = '🥣';
        tag = '丼もの';
        combos = ['牛丼並盛＋みそ汁おしんこセット', 'ふわとろ親子丼・カツ丼'];
      } else if (/(鍋|しゃぶしゃぶ|すき焼き|もつ鍋|おでん)/.test(combined)) {
        emoji = '🍲';
        tag = '鍋・しゃぶしゃぶ';
        combos = ['一人しゃぶしゃぶセット', '博多もつ鍋・おでん盛り'];
      } else if (/(居酒屋|酒場|磯丸)/.test(combined)) {
        emoji = '🏮';
        tag = '居酒屋・和食';
        combos = ['焼魚・お刺身定食', '唐揚げ＆焼き鳥テイクアウト'];
      }
    }

    const isBreakfastFriendly = /(吉野家|松屋|すき家|なか卯|マクドナルド|モスバーガー|ガスト|デニーズ|ジョナサン|コメダ|富士そば|ゆで太郎|やよい軒|サブウェイ|ベーカリー|パン|おにぎり|fast_food|burger|bakery)/i.test(combined);
    const isDinnerOnly = /(居酒屋|鳥貴族|酒場|ホルモン|もつ鍋|バー)/i.test(rawShop.name);

    let meals = ['lunch', 'dinner'];
    if (isBreakfastFriendly) meals = ['breakfast', 'lunch', 'dinner'];
    else if (isDinnerOnly) meals = ['dinner'];

    const estDeliveryMin = Math.max(15, Math.min(50, Math.round(14 + (rawShop.distance || 500) / 140)));

    return {
      ...rawShop,
      cuisine: matchedCuisine,
      meals,
      modes: ['takeout'],
      isRealShop: true,
      emoji,
      tag,
      combos,
      estDeliveryMin
    };
  }

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

  // Google Maps JS SDK (Places New, language=ja)
  let loadedGoogleKey = '';
  function loadGoogleMapsSDK(apiKey) {
    return new Promise((resolve, reject) => {
      if (window.google?.maps?.importLibrary && loadedGoogleKey === apiKey) {
        resolve();
        return;
      }
      const existing = document.getElementById('gmaps-places-sdk');
      if (existing) existing.remove();
      const script = document.createElement('script');
      script.id = 'gmaps-places-sdk';
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=ja&loading=async`;
      script.async = true;
      script.defer = true;
      const timer = setTimeout(() => reject(new Error('Google Maps SDK タイムアウト')), 9000);
      script.onload = () => {
        clearTimeout(timer);
        loadedGoogleKey = apiKey;
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Google Maps SDK の読み込みに失敗しました'));
      };
      document.head.appendChild(script);
    });
  }

  async function fetchDirectGooglePlaces(lat, lng, radius, apiKey) {
    await loadGoogleMapsSDK(apiKey);
    const { Place, SearchNearbyRankPreference } = await window.google.maps.importLibrary('places');
    const request = {
      fields: ['displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount', 'types', 'primaryTypeDisplayName', 'priceLevel', 'photos'],
      locationRestriction: { center: { lat, lng }, radius: Math.min(Math.max(radius, 500), 5000) },
      includedPrimaryTypes: [
        'restaurant', 'fast_food_restaurant', 'ramen_restaurant', 'sushi_restaurant',
        'japanese_restaurant', 'chinese_restaurant', 'korean_restaurant', 'italian_restaurant',
        'hamburger_restaurant', 'pizza_restaurant', 'barbecue_restaurant', 'meal_takeaway'
      ],
      maxResultCount: 20,
      rankPreference: SearchNearbyRankPreference ? SearchNearbyRankPreference.POPULARITY : 'POPULARITY'
    };

    const { places } = await Place.searchNearby(request);
    if (!Array.isArray(places) || places.length === 0) return [];

    const priceMap = {
      FREE: '無料',
      INEXPENSIVE: 'お手頃（〜1,000円）',
      MODERATE: '標準（1,000〜2,500円）',
      EXPENSIVE: 'やや高め',
      VERY_EXPENSIVE: '高級'
    };

    const shops = places
      .filter(p => p.displayName)
      .map(p => {
        const pLat = typeof p.location?.lat === 'function' ? p.location.lat() : p.location?.lat || lat;
        const pLng = typeof p.location?.lng === 'function' ? p.location.lng() : p.location?.lng || lng;
        let photoUrl = '';
        try {
          if (p.photos?.[0]?.getURI) photoUrl = p.photos[0].getURI({ maxWidth: 640 });
        } catch (_) {}
        return {
          name: String(p.displayName).trim(),
          address: p.formattedAddress || '周辺エリア',
          distance: haversineMeters(lat, lng, pLat, pLng),
          rawType: p.primaryTypeDisplayName || (p.types || []).join(' '),
          rawCuisine: (p.types || []).join(' '),
          rating: p.rating ? Number(p.rating).toFixed(1) : '',
          ratingCount: p.userRatingCount || 0,
          budgetText: priceMap[p.priceLevel] || '',
          photoUrl,
          lat: pLat,
          lng: pLng,
          source: 'google'
        };
      });

    shops.sort((a, b) => (parseFloat(b.rating || 0) - parseFloat(a.rating || 0)) || (a.distance - b.distance));
    return shops;
  }

  // Recruit Hot Pepper Gourmet API (JSONP)
  function fetchDirectHotPepperJSONP(lat, lng, radius, apiKey) {
    return new Promise((resolve, reject) => {
      const range = radius <= 500 ? 2 : radius <= 1000 ? 3 : radius <= 2000 ? 4 : 5;
      const cbName = `__jp_hp_cb_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const script = document.createElement('script');

      const cleanup = () => {
        clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        try {
          delete window[cbName];
        } catch (_) {
          window[cbName] = undefined;
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('ホットペッパーAPI タイムアウト'));
      }, 9000);

      window[cbName] = data => {
        cleanup();
        const rawList = data?.results?.shop;
        if (!Array.isArray(rawList)) {
          reject(new Error(data?.results?.error?.[0]?.message || '店舗データが見つかりませんでした'));
          return;
        }
        const shops = rawList
          .filter(s => s.name)
          .map(s => {
            const sLat = parseFloat(s.lat) || lat;
            const sLng = parseFloat(s.lng) || lng;
            return {
              name: String(s.name).trim(),
              address: s.address || s.station_name || '周辺エリア',
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
          });
        shops.sort((a, b) => a.distance - b.distance);
        resolve(shops);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error('ホットペッパーAPI 接続エラー'));
      };
      script.src = `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?key=${encodeURIComponent(apiKey)}&lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&range=${range}&count=60&format=jsonp&callback=${cbName}`;
      document.head.appendChild(script);
    });
  }

  // OpenStreetMap Overpass (タイムアウト7秒付き)
  async function fetchDirectOverpass(lat, lng, radius) {
    const radiusKm = Math.max(0.5, Math.min(5, radius / 1000));
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
    const bbox = `${(lat - dLat).toFixed(4)},${(lng - dLng).toFixed(4)},${(lat + dLat).toFixed(4)},${(lng + dLng).toFixed(4)}`;
    const q = `[out:json][timeout:6];node["amenity"~"restaurant|fast_food"](${bbox});out 140;`;
    const skipCafeRegex = /(スターバックス|Starbucks|ドトール|タリーズ|珈琲館|喫茶|カフェ|Cafe|Coffee|タピオカ|アイス|サーティワン|バー|Bar|Pub|スナック|カラオケ)/i;

    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter'
    ];

    let data = null;
    for (const ep of endpoints) {
      try {
        const res = await fetch(`${ep}?data=${encodeURIComponent(q)}`, {
          signal: AbortSignal.timeout ? AbortSignal.timeout(7000) : undefined
        });
        if (res.ok) {
          data = await res.json();
          if (data && Array.isArray(data.elements)) break;
        }
      } catch (_) {}
    }
    if (!data) throw new Error('OSM タイムアウト');

    const seen = new Set();
    const shops = [];
    for (const el of data.elements || []) {
      const tags = el.tags || {};
      const name = (tags['name:ja'] || tags.name || tags['name:en'] || '').trim();
      if (!name || name.length < 2 || skipCafeRegex.test(name)) continue;
      if (/(coffee_shop|ice_cream|bubble_tea)/i.test(tags.cuisine || '')) continue;
      const dist = haversineMeters(lat, lng, el.lat, el.lon);
      if (dist > radius) continue;
      const key = `${name}_${Math.round(dist / 200)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const addr = [tags['addr:city'], tags['addr:suburb'] || tags['addr:quarter'], tags['addr:block_number']].filter(Boolean).join(' ');
      shops.push({
        name,
        address: addr || '周辺エリア',
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

  async function scanNearbyShops(force = false) {
    if (!state.location.lat || !state.location.lng) return;
    const keySig = `${state.googleKey ? 'g' : ''}${state.hotpepperKey ? 'h' : ''}` || 'free';
    const scanKey = `${state.location.lat.toFixed(3)}_${state.location.lng.toFixed(3)}_${state.radius}_${keySig}`;
    if (!force && state.nearbyScannedKey === scanKey && state.nearbyShops.length > 0) return;

    state.nearbyLoading = true;
    locDot.classList.add('loading');
    locText.textContent = `${state.location.label} ${state.radius / 1000}km圏内を検索中...`;

    try {
      let rawShops = [];
      let source = 'osm';

      if (state.googleKey) {
        try {
          rawShops = await fetchDirectGooglePlaces(state.location.lat, state.location.lng, state.radius, state.googleKey);
          source = 'google';
        } catch (err) {
          showToast(`⚠️ Google Places: ${err.message}`);
        }
      }

      if (rawShops.length === 0 && state.hotpepperKey) {
        try {
          rawShops = await fetchDirectHotPepperJSONP(state.location.lat, state.location.lng, state.radius, state.hotpepperKey);
          source = 'hotpepper';
        } catch (err) {
          showToast(`⚠️ ホットペッパー: ${err.message}`);
        }
      }

      if (rawShops.length === 0) {
        rawShops = await fetchDirectOverpass(state.location.lat, state.location.lng, state.radius);
        source = 'osm';
      }

      if (rawShops.length > 0) {
        state.nearbyShops = rawShops.map(classifyNearbyShop);
        state.nearbySource = source;
        state.nearbyScannedKey = scanKey;
        locDot.classList.remove('loading');
        const srcMap = { google: 'Google星評価付', hotpepper: 'HotPepper店舗', osm: '周辺実店舗' };
        locText.textContent = `${state.location.label} · ${state.nearbyShops.length}軒の${srcMap[source] || '実店舗'}を発見`;
      } else {
        throw new Error('周辺店舗が見つかりませんでした');
      }
    } catch (_) {
      locDot.classList.remove('loading');
      state.nearbyShops = [];
      locText.textContent = `${state.location.label} · 定番チェーン・宅配候補で抽選（⚙️で実店舗検索可）`;
    } finally {
      state.nearbyLoading = false;
      syncUI();
    }
  }

  // =========================================================================
  // 5. 候補プール計算＆UI同期
  // =========================================================================
  function getGuessPool() {
    const candidates = [];
    const seen = new Set();
    const pushIfValid = item => {
      if (!item || !item.name || seen.has(item.name)) return;
      if (state.cuisine !== 'all' && state.cuisine !== '厳選' && item.cuisine !== state.cuisine) return;
      if (state.cuisine === '厳選' && !item.aiPick && !(item.isRealShop && item.rating && parseFloat(item.rating) >= 4.0)) return;
      seen.add(item.name);
      candidates.push(item);
    };

    for (const d of staticDishes) {
      if (d.meals?.includes(state.meal) && (d.modes?.includes('cook') || d.modes?.includes('lazy'))) {
        pushIfValid(d);
      }
    }
    for (const s of state.nearbyShops) {
      if (s.meals?.includes(state.meal)) pushIfValid(s);
    }

    let scored = candidates
      .filter(item => !isItemDisliked(item.name))
      .map(item => {
        const m = computePersonalizedMatch(item);
        return { ...item, _matchPct: m.pct, _matchReason: m.reason, _rawScore: m.rawScore };
      })
      .sort((a, b) => b._rawScore - a._rawScore);

    if (scored.length === 0) {
      scored = staticDishes
        .filter(d => d.modes?.includes('cook'))
        .slice(0, 24)
        .map(d => ({ ...d, _matchPct: 84, _matchReason: '人気の定番おすすめ', _rawScore: 84 }));
    }
    return scored.slice(0, 40);
  }

  function getFilteredPool() {
    if (state.mode === 'guess') return getGuessPool();

    if (state.mode === 'takeout' && state.nearbyShops.length > 0) {
      if (state.cuisine === '厳選') {
        const topShops = state.nearbyShops.filter(s => s.meals.includes(state.meal) && (s.rating && parseFloat(s.rating) >= 4.0));
        return topShops.length > 0 ? topShops : state.nearbyShops.slice(0, 18);
      }
      const exact = state.nearbyShops.filter(s => s.meals.includes(state.meal) && (state.cuisine === 'all' || s.cuisine === state.cuisine));
      if (exact.length > 0) return exact;
      const relaxed = state.nearbyShops.filter(s => state.cuisine === 'all' || s.cuisine === state.cuisine);
      if (relaxed.length > 0) return relaxed;
    }

    if (state.cuisine === '厳選') {
      const exactAi = staticDishes.filter(d => d.aiPick && d.meals.includes(state.meal) && d.modes.includes(state.mode));
      if (exactAi.length > 0) return exactAi;
      const relaxedAi = staticDishes.filter(d => d.aiPick && d.modes.includes(state.mode));
      if (relaxedAi.length > 0) return relaxedAi;
    }

    const matched = staticDishes.filter(d => {
      const mealMatch = d.meals.includes(state.meal);
      const modeMatch = d.modes.includes(state.mode);
      const cuisineMatch = state.cuisine === 'all' || state.cuisine === '厳選' || d.cuisine === state.cuisine;
      return mealMatch && modeMatch && cuisineMatch;
    });

    if (matched.length > 0) return matched;
    // 朝ごはん×鍋など該当が少ない場合は時間帯条件を緩和して候補ゼロを防ぐ
    return staticDishes.filter(d => d.modes.includes(state.mode) && (state.cuisine === 'all' || state.cuisine === '厳選' || d.cuisine === state.cuisine));
  }

  function updateCuisineChipCounts() {
    const showRealCounts = state.mode === 'takeout' && state.nearbyShops.length > 0;
    cuisineGroup.querySelectorAll('.cuisine-chip').forEach(btn => {
      const c = btn.dataset.cuisine;
      const baseLabel = cuisineBaseLabels.get(c) || btn.textContent;
      if (showRealCounts) {
        let cnt = 0;
        if (c === 'all') cnt = state.nearbyShops.length;
        else if (c === '厳選') cnt = state.nearbyShops.filter(s => s.rating && parseFloat(s.rating) >= 4.0).length || Math.min(18, state.nearbyShops.length);
        else cnt = state.nearbyShops.filter(s => s.cuisine === c).length;
        btn.innerHTML = `${baseLabel}<span class="cuisine-chip-count">(${cnt})</span>`;
      } else {
        btn.textContent = baseLabel;
      }
    });
  }

  let countAnimId = null;
  function animatePoolCount(targetCount) {
    if (countAnimId) cancelAnimationFrame(countAnimId);
    const startCount = state.displayedPoolCount || 0;
    const isRealTakeout = state.mode === 'takeout' && state.nearbyShops.length > 0 && getFilteredPool()[0]?.isRealShop;
    const unit = isRealTakeout ? '軒' : '品';

    poolCountEl.innerHTML = `候補 <b id="poolCountNum">${startCount}</b> ${unit}`;
    const numEl = document.getElementById('poolCountNum');
    if (startCount === targetCount) {
      if (numEl) numEl.textContent = targetCount;
      return;
    }

    poolCountEl.classList.add('bump');
    setTimeout(() => poolCountEl.classList.remove('bump'), 200);
    const startTime = performance.now();
    const duration = 240;

    function tick(now) {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startCount + (targetCount - startCount) * eased);
      const liveNumEl = document.getElementById('poolCountNum');
      if (liveNumEl) liveNumEl.textContent = current;
      state.displayedPoolCount = current;
      if (progress < 1) countAnimId = requestAnimationFrame(tick);
    }
    countAnimId = requestAnimationFrame(tick);
  }

  function setDockMode(mode) {
    if (mode === 'result') {
      dockIdle.classList.remove('active');
      dockResult.classList.add('active');
      resultDock.classList.add('has-result');
    } else {
      dockResult.classList.remove('active');
      dockIdle.classList.add('active');
      resultDock.classList.remove('has-result');
    }
  }

  function syncUI() {
    document.body.dataset.theme = state.meal;
    if (mealSkyHint) {
      const skyMap = { breakfast: '🌅 朝焼けの空', lunch: '☀️ 快晴の青空', dinner: '🌙 星降る夜空' };
      mealSkyHint.textContent = skyMap[state.meal] || '🌅 朝焼けの空';
    }

    const mealIdxMap = { breakfast: 0, lunch: 1, dinner: 2 };
    mealGroup.style.setProperty('--active-idx', mealIdxMap[state.meal] ?? 0);
    mealGroup.querySelectorAll('.segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.meal === state.meal);
    });

    const modeIdxMap = { cook: 0, lazy: 1, takeout: 2, guess: 3 };
    modeGroup.style.setProperty('--active-idx', modeIdxMap[state.mode] ?? 0);
    modeGroup.querySelectorAll('.segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === state.mode);
    });

    cuisineGroup.querySelectorAll('.cuisine-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cuisine === state.cuisine);
    });

    cookStatusLayer.classList.toggle('active', state.mode === 'cook');
    lazyStatusLayer.classList.toggle('active', state.mode === 'lazy');
    takeoutStatusLayer.classList.toggle('active', state.mode === 'takeout');
    if (guessStatusLayer) guessStatusLayer.classList.toggle('active', state.mode === 'guess');
    updateGuessStatusSummary();

    if (state.mode === 'takeout' && state.location.ready && !state.nearbyLoading && state.nearbyShops.length === 0 && !state.nearbyScannedKey) {
      scanNearbyShops();
    }

    updateCuisineChipCounts();
    const pool = getFilteredPool();
    animatePoolCount(pool.length);

    if (!state.currentDish && !state.isSpinning) {
      if (state.mode === 'cook') {
        dockIdleText.textContent = '「ガチャを回す」を押すと、具体的な分量と代用ガイド付きレシピが見られます';
      } else if (state.mode === 'lazy') {
        dockIdleText.textContent = '⚡ レンチン・炊飯器・冷凍うどんなど超時短ズボラ飯から抽選します！';
      } else if (state.mode === 'guess') {
        dockIdleText.textContent =
          tasteProfile.totalInteractions >= 3
            ? `❤️ ローカル履歴（${tasteProfile.totalDraws}回）から好みに合う一品を厳選します！`
            : '❤️ 抽選後に 👍/👎 を押すほど、あなた好みのメニューが出やすくなります';
      } else if (!state.location.ready) {
        dockIdleText.textContent = '📍 ブラウザの位置情報を許可すると、周辺のお店を検索してガチャできます';
      } else {
        dockIdleText.textContent =
          state.nearbyShops.length > 0
            ? `周辺 ${state.radius / 1000}km圏内で ${state.nearbyShops.length}軒を発見！今すぐガチャを回そう`
            : '位置情報取得済み · 「ガチャを回す」で今日の外食・デリバリーを決めよう！';
      }
    }
  }

  // =========================================================================
  // 6. ブラウザ位置情報（デフォルト都市なし・純粋なブラウザ許可）
  // =========================================================================
  async function reverseGeocode(lat, lng) {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=ja`;
    const res = await fetch(url);
    return res.json();
  }

  function requestBrowserLocation(onAuthorized, silentOnInit = false) {
    if (state.location.locating) return;
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      locDot.classList.remove('loading');
      locDot.classList.add('error');
      locText.textContent = !window.isSecureContext ? 'HTTPS環境でのみ位置情報が利用できます' : 'お使いのブラウザは位置情報APIに非対応です';
      if (!silentOnInit) showToast('⚠️ 位置情報を取得できませんでした（定番メニューで抽選できます）');
      return;
    }

    state.location.locating = true;
    locDot.classList.remove('error');
    locDot.classList.add('loading');
    locText.textContent = 'ブラウザに位置情報の許可をリクエスト中...';

    navigator.geolocation.getCurrentPosition(
      async pos => {
        state.location.locating = false;
        state.location.denied = false;
        const { latitude, longitude } = pos.coords;
        state.location.lat = latitude;
        state.location.lng = longitude;
        state.location.ready = true;
        btnRelocate.textContent = '📍 再取得';
        btnRelocate.classList.remove('loc-auth-btn');

        try {
          const data = await reverseGeocode(latitude, longitude);
          const pref = data.principalSubdivision || '';
          const city = data.city || data.locality || '';
          state.location.city = pref;
          state.location.district = city;
          state.location.label = [pref, city].filter(Boolean).join('・') || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
        } catch (_) {
          state.location.label = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
        }

        await scanNearbyShops(true);
        if (typeof onAuthorized === 'function') onAuthorized();
      },
      err => {
        state.location.locating = false;
        state.location.ready = false;
        if (err && err.code === 1) state.location.denied = true;
        state.nearbyShops = [];
        locDot.classList.remove('loading');
        locDot.classList.add('error');
        btnRelocate.textContent = '📍 再試行';
        btnRelocate.classList.add('loc-auth-btn');

        if (err && err.code === 1) {
          locText.textContent = '位置情報未許可 · そのまま定番チェーンからガチャ可能です';
          if (!silentOnInit) showToast('⚠️ 位置情報が未許可です（定番チェーン・宅配候補で抽選できます）');
        } else {
          locText.textContent = '現在地を取得できませんでした · 定番候補でガチャ可能です';
          if (!silentOnInit) showToast('⚠️ 現在地取得失敗（定番候補で抽選できます）');
        }
        syncUI();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 180000 }
    );
  }

  // =========================================================================
  // 7. スロットカード描画＆4段階ガチャ演出
  // =========================================================================
  function formatDistance(meters) {
    if (meters == null) return '周辺';
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`;
  }

  function formatRatingBadge(item) {
    if (!item.rating) return '';
    const cnt = item.ratingCount ? ` (${item.ratingCount}件)` : '';
    return `<span class="badge badge-rating">⭐ ${item.rating}${cnt}</span>`;
  }

  function createReelCardHTML(item) {
    const titleClass = item.name.length > 12 ? 'dish-name combo-title' : 'dish-name';
    if (item.isRealShop) {
      const ratingHTML = formatRatingBadge(item);
      const midBadge = ratingHTML
        ? ratingHTML
        : item.budgetText
          ? `<span class="badge badge-flavor">💰 ${item.budgetText}</span>`
          : `<span class="badge badge-flavor">目安 ${item.estDeliveryMin}分</span>`;
      const leftBadge = state.mode === 'guess' && item._matchPct
        ? `<span class="badge badge-match">❤️ 相性 ${item._matchPct}%</span>`
        : `<span class="badge badge-cuisine">${item.cuisine}</span>`;

      return `
        <div class="reel-card">
          <div class="dish-emoji">${item.emoji || '🏪'}</div>
          <div class="dish-name-wrap">
            <div class="${titleClass}">${item.name}</div>
          </div>
          <div class="dish-badges">
            ${leftBadge}
            ${midBadge}
            <span class="badge badge-mode">📍 ${formatDistance(item.distance)}</span>
          </div>
        </div>
      `;
    }

    const isTakeout = item.modes.includes('takeout') && !item.modes.includes('cook');
    let modeLabel = '🍳 自炊';
    let modeBadgeClass = 'badge badge-mode';
    if (state.mode === 'guess' && item._matchPct) {
      modeLabel = `❤️ 相性 ${item._matchPct}%`;
      modeBadgeClass = 'badge badge-match';
    } else if (isTakeout) {
      modeLabel = '🛵 外食・宅配';
    } else if (state.mode === 'lazy') {
      modeLabel = item.lazyTool || '⚡ ズボラ飯';
      modeBadgeClass = 'badge badge-lazy-tool';
    } else if (item.aiPick) {
      modeLabel = '✨ ハズレなし';
      modeBadgeClass = 'badge badge-lazy-tool';
    }
    const rightTag = state.mode === 'guess' && item._matchReason ? item._matchReason : (item.tag || '定番人気');

    return `
      <div class="reel-card">
        <div class="dish-emoji">${item.emoji || '🍲'}</div>
        <div class="dish-name-wrap">
          <div class="${titleClass}">${item.name}</div>
        </div>
        <div class="dish-badges">
          <span class="badge badge-cuisine">${item.cuisine}</span>
          <span class="${modeBadgeClass}">${modeLabel}</span>
          <span class="badge badge-flavor">${rightTag}</span>
        </div>
      </div>
    `;
  }

  function pickWeightedWinner(pool) {
    if (state.mode !== 'guess' || pool.length <= 1) {
      return pool[Math.floor(Math.random() * pool.length)];
    }
    const weights = pool.map((item, idx) => Math.max(1, (item._matchPct || 75) - 55) + Math.max(0, 12 - idx * 0.4));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[0];
  }

  function spinSlotMachine() {
    if (state.isSpinning) return;
    let pool = getFilteredPool();
    if (pool.length === 0) pool = staticDishes;

    state.isSpinning = true;
    btnDraw.disabled = true;
    btnDraw.classList.add('charging');
    btnDraw.querySelector('.draw-btn-text').textContent = '⚡ パワー充填中...';

    slotFrame.classList.remove('won', 'rush', 'braking', 'spinning');
    slotShockwave.classList.remove('boom');
    slotShockwave2.classList.remove('boom');
    slotFlashSweep.classList.remove('flash');
    slotWinBanner.classList.remove('show');

    ritualSpotlight.classList.add('active');
    slotMachineSection.classList.add('in-ritual');
    slotFrame.classList.add('winding-up');
    playWindupSound();

    dockIdleText.textContent =
      state.mode === 'guess'
        ? '❤️ あなたの好みカルテから運命の一品をセレクト中...'
        : state.mode === 'takeout' && pool[0]?.isRealShop
          ? `🛵 周辺 ${state.radius / 1000}km圏内の ${pool.length}軒から抽選中...`
          : '⚡ 運命のごはんスロット回転開始！';
    setDockMode('idle');

    let winner = pickWeightedWinner(pool);
    if (pool.length > 1 && state.currentDish && winner.name === state.currentDish.name) {
      const others = pool.filter(d => d.name !== state.currentDish.name);
      winner = pickWeightedWinner(others);
    }

    const currentFirstCardHTML = slotReel.lastElementChild ? slotReel.lastElementChild.outerHTML : slotReel.innerHTML;
    const totalNewCards = 40;
    const sequenceHTML = [currentFirstCardHTML];
    for (let i = 0; i < totalNewCards - 1; i++) {
      sequenceHTML.push(createReelCardHTML(pool[Math.floor(Math.random() * pool.length)]));
    }
    sequenceHTML.push(createReelCardHTML(winner));

    slotReel.style.transition = 'none';
    slotReel.style.transform = 'translate3d(0, 0, 0)';
    slotReel.innerHTML = sequenceHTML.join('');
    void slotReel.offsetHeight;

    slotReel.style.transition = 'transform 260ms cubic-bezier(0.3, 0, 0.2, 1)';
    slotReel.style.transform = 'translate3d(0, 26px, 0)';

    const targetOffset = -totalNewCards * CARD_HEIGHT;
    const spinDurationMs = 2850;
    const tickTimers = [];
    let sparkInterval = null;

    setTimeout(() => {
      slotFrame.classList.remove('winding-up');
      slotFrame.classList.add('spinning', 'rush');
      btnDraw.querySelector('.draw-btn-text').textContent = '🔥 高速回転中...';
      dockIdleText.textContent = '🔥 今日は何が出るかな…？';

      void slotReel.offsetHeight;
      slotReel.style.transition = `transform ${spinDurationMs}ms cubic-bezier(0.11, 0.92, 0.18, 1.018)`;
      slotReel.style.transform = `translate3d(0, ${targetOffset}px, 0)`;

      sparkInterval = setInterval(emitSpinSparks, 110);

      for (let i = 0; i < 24; i++) {
        const delay = Math.pow(i / 24, 2.05) * (spinDurationMs - 200);
        const isLastThree = i >= 21;
        tickTimers.push(
          setTimeout(() => {
            playTickSound(isLastThree ? 360 + (i - 21) * 55 : 440 + (i % 7) * 42, isLastThree ? 0.062 : 0.042);
          }, delay)
        );
      }

      setTimeout(() => {
        slotFrame.classList.remove('rush');
        slotFrame.classList.add('braking');
        btnDraw.querySelector('.draw-btn-text').textContent = '🥁 まもなく決定...！';
        dockIdleText.textContent = '🥁 ドキドキのストップ直前…';
        if (sparkInterval) {
          clearInterval(sparkInterval);
          sparkInterval = null;
        }
      }, Math.round(spinDurationMs * 0.58));

      setTimeout(() => {
        tickTimers.forEach(clearTimeout);
        if (sparkInterval) clearInterval(sparkInterval);

        state.isSpinning = false;
        state.currentDish = winner;

        ritualSpotlight.classList.remove('active');
        slotMachineSection.classList.remove('in-ritual');
        slotFrame.classList.remove('spinning', 'rush', 'braking');
        slotFrame.classList.add('won');

        void slotFlashSweep.offsetWidth;
        slotFlashSweep.classList.add('flash');
        slotShockwave.classList.add('boom');
        slotShockwave2.classList.add('boom');

        if (state.mode === 'guess' && winner._matchPct) {
          slotWinBanner.textContent = `❤️ あなたとの相性 ${winner._matchPct}% · ${winner._matchReason}`;
        } else if (winner.isRealShop) {
          slotWinBanner.textContent = winner.rating ? `⭐ ${winner.rating} 周辺の注目店！ ✨` : '✨ 今日のお店が決定！ ✨';
        } else {
          slotWinBanner.textContent = '✨ 今日のごはん決定！ ✨';
        }
        slotWinBanner.classList.add('show');

        playJackpotFanfare();
        triggerJackpotFireworks(winner.emoji);

        btnDraw.disabled = false;
        btnDraw.classList.remove('charging');
        btnDraw.querySelector('.draw-btn-text').textContent = 'もう一回回す！';

        recordTasteSignal('draw', { item: winner, meal: state.meal, mode: state.mode });
        addToHistory(winner);
        renderResultDock(winner);
      }, spinDurationMs + 30);
    }, 270);
  }

  // =========================================================================
  // 8. 結果アクションドック（👍 食べたい / 👎 パス 付き）
  // =========================================================================
  function buildFeedbackHTML(item) {
    const liked = isItemLiked(item.name);
    const disliked = isItemDisliked(item.name);
    return `
      <span class="feedback-inline-group">
        <button type="button" class="feedback-pill-btn ${liked ? 'active-like' : ''}" id="btnTasteLike" title="お気に入り登録（おすすめに出やすくなります）">👍 ${liked ? '済' : '食べたい'}</button>
        <button type="button" class="feedback-pill-btn ${disliked ? 'active-dislike' : ''}" id="btnTasteDislike" title="パス（おすすめから控えめにします）">👎</button>
      </span>
    `;
  }

  function bindFeedbackEvents(item) {
    document.getElementById('btnTasteLike')?.addEventListener('click', () => {
      playSelectSound();
      const willLike = !isItemLiked(item.name);
      recordTasteSignal('like', { item });
      renderResultDock(item);
      showToast(willLike ? `❤️ 「${item.name}」を好みに記録しました` : 'お気に入りを解除しました');
    });
    document.getElementById('btnTasteDislike')?.addEventListener('click', () => {
      playSelectSound();
      const willDislike = !isItemDisliked(item.name);
      recordTasteSignal('dislike', { item });
      renderResultDock(item);
      showToast(willDislike ? `👌 「${item.name}」を次回から控えめにします` : 'パスを解除しました');
    });
  }

  function getYouTubeRecipeUrl(dish) {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${dish?.name || ''} レシピ 作り方`)}`;
  }

  function renderResultDock(item) {
    const isShopOrTakeout = item.isRealShop || (item.modes?.includes('takeout') && !item.modes?.includes('cook'));

    if (!isShopOrTakeout) {
      const modeIcon = state.mode === 'guess' ? '❤️' : (state.mode === 'lazy' ? '⚡' : '🍳');
      const matchedSubs = getDishSubstitutions(item.ingredients || []);
      const subText = matchedSubs.length > 0 ? ` · 代用${matchedSubs.length}件` : '';
      const ytUrl = getYouTubeRecipeUrl(item);
      resultActionContent.innerHTML = `
        <div class="action-panel-header">
          <span>${modeIcon} 「<strong>${item.name}</strong>」· ${item.time || '約15分'}${subText}</span>
          <div class="dock-header-right">${buildFeedbackHTML(item)}</div>
        </div>
        <div class="action-btn-grid cols-3">
          <button type="button" class="action-link-btn primary-action" id="btnOpenRecipeModal">
            📖 レシピを見る
          </button>
          <a href="${ytUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn video-action" id="btnOpenYouTubeQuick">
            📺 YouTube動画
          </a>
          <button type="button" class="action-link-btn" id="btnCopyRecipeQuick">
            📋 買い物リスト
          </button>
        </div>
      `;
      document.getElementById('btnOpenRecipeModal')?.addEventListener('click', () => openRecipeModal(item));
      document.getElementById('btnOpenYouTubeQuick')?.addEventListener('click', () => {
        playSelectSound();
        recordTasteSignal('open_detail', { item });
      });
      document.getElementById('btnCopyRecipeQuick')?.addEventListener('click', () => copyRecipeToClipboard(item));
      bindFeedbackEvents(item);
    } else {
      const copyTarget = item.isRealShop ? item.name : (item.searchKeyword || item.name);
      const starText = item.rating ? `⭐${item.rating} · ` : '';
      const distBadge = item.isRealShop ? `${starText}${formatDistance(item.distance)}` : state.location.label;
      const gmapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.isRealShop && item.address ? `${item.name} ${item.address}` : copyTarget)}`;
      const uberUrl = `https://www.ubereats.com/jp/search?q=${encodeURIComponent(copyTarget)}`;

      resultActionContent.innerHTML = `
        <div class="action-panel-header">
          <span>🏪 「<strong>${item.name}</strong>」· ${distBadge}</span>
          <div class="dock-header-right">${buildFeedbackHTML(item)}</div>
        </div>
        <div class="action-btn-grid cols-3">
          <button type="button" class="action-link-btn primary-action" id="btnOpenShopModal">
            🏪 店舗＆注文
          </button>
          <a href="${gmapUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn map-action" id="btnJpMapQuick">
            🗺️ Googleマップ
          </a>
          <a href="${uberUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn meituan-action" id="btnJpUberQuick">
            🛵 Uber Eats
          </a>
        </div>
      `;
      document.getElementById('btnOpenShopModal')?.addEventListener('click', () => openShopModal(item));
      document.getElementById('btnJpUberQuick')?.addEventListener('click', () => {
        playSelectSound();
        recordTasteSignal('copy', { item });
        navigator.clipboard?.writeText(copyTarget).catch(() => {});
      });
      bindFeedbackEvents(item);
    }

    setDockMode('result');
  }

  // =========================================================================
  // 9. 日本のキッチン向け・非線形分量換算（1人前 / 2人前 / 4人前）＆レシピモーダル
  // =========================================================================
  function getCulinaryScaleProfile(ingName, baseFactor) {
    if (!baseFactor || baseFactor === 1) return { factor: 1, label: '' };
    const n = String(ingName || '').trim();

    if (/(鷹の爪|唐辛子|ラー油|豆板醤|コチュジャン|黒こしょう|こしょう|ナツメグ|わさび|七味|一味|ごま油|パセリ|青のり|わさび|からし)/.test(n)) {
      const f = baseFactor > 1 ? 1.4 : 0.7;
      return { factor: f, label: `スパイス・香味料は非線形換算 ×${f}（風味が強くなりすぎない調整）` };
    }
    if (/(サラダ油|オリーブオイル|バター|マーガリン|にんにく|生姜|しょうが|長ねぎ|小ねぎ|青ねぎ|刻みねぎ|三つ葉|^水$|熱湯|お湯|緑茶|茹で汁)/.test(n)) {
      const f = baseFactor > 1 ? 1.5 : 0.65;
      return { factor: f, label: `炒め油・薬味・煮汁は鍋面積＆蒸発率で ×${f} 換算` };
    }
    if (/(醤油|みりん|酒|料理酒|砂糖|塩|味噌|めんつゆ|白だし|だしの素|鶏がら|コンソメ|オイスター|ケチャップ|ソース|マヨネーズ|酢|ポン酢|焼肉のたれ|甜麺醤|はちみつ|塩麹|片栗粉|レモン汁|ねりごま|カレールウ)/.test(n)) {
      const f = baseFactor > 1 ? 1.65 : 0.6;
      return { factor: f, label: `基本調味料は非線形換算 ×${f}（塩辛くなりすぎ防止）` };
    }
    return { factor: baseFactor, label: `メイン食材は等比換算 ×${baseFactor}` };
  }

  function scaleAmountString(amountStr, factor) {
    if (!factor || factor === 1) return amountStr;
    return String(amountStr).replace(/(\d+)\/(\d+)|(\d+(?:\.\d+)?)/g, (match, num, den, dec) => {
      if (num && den) {
        const val = (parseFloat(num) / parseFloat(den)) * factor;
        if (Math.abs(val - 1) < 0.08) return '1';
        if (Math.abs(val - 0.5) < 0.08) return '1/2';
        if (Math.abs(val - 2 / 3) < 0.08) return '2/3';
        if (Math.abs(val - 1 / 3) < 0.08) return '1/3';
        if (Math.abs(val - 0.25) < 0.06) return '1/4';
        return String(Math.round(val * 10) / 10).replace(/\.0$/, '');
      }
      const val = parseFloat(dec);
      if (isNaN(val)) return match;
      const scaled = val * factor;
      if (scaled >= 10) return String(Math.round(scaled));
      const rounded = Math.round(scaled * 2) / 2;
      return rounded === 0 ? '0.5' : String(rounded).replace(/\.0$/, '');
    });
  }

  function parseJpIngredient(raw, scaleFactor = 1) {
    const str = String(raw || '').trim();
    const parts = str.split(/\s+/);
    let name = str;
    let amount = '';
    if (parts.length >= 2) {
      name = parts[0];
      amount = parts.slice(1).join(' ');
    }
    const profile = getCulinaryScaleProfile(name, scaleFactor);
    return {
      name,
      amount: amount ? scaleAmountString(amount, profile.factor) : '1人前目安',
      scaleNote: profile.label
    };
  }

  function getDishSubstitutions(ings) {
    const matched = [];
    const seen = new Set();
    const text = (ings || []).join(' ');
    for (const rule of jpSubstitutions) {
      if (rule.match.test(text) && !seen.has(rule.label)) {
        seen.add(rule.label);
        matched.push(rule);
      }
    }
    return matched;
  }

  function hasIngredientSub(rawIng) {
    return jpSubstitutions.some(r => r.match.test(rawIng));
  }

  function analyzeStepVisual(stepText, idx, total) {
    let stage = '調理';
    let heat = '';
    let time = '';
    let svgIcon = '';

    const timeMatch = stepText.match(/([0-9]+(?:\s*[〜~-]\s*[0-9]+)?\s*(?:分半|分|秒))/);
    if (timeMatch) time = `⏱️ ${timeMatch[1].replace(/\s+/g, '')}`;

    if (stepText.includes('強火') || stepText.includes('強中火')) heat = '🔥 強火';
    else if (stepText.includes('弱中火') || stepText.includes('中弱火')) heat = '🔉 弱中火';
    else if (stepText.includes('弱火')) heat = '🕯️ 弱火';
    else if (stepText.includes('中火')) heat = '🍳 中火';
    else if (stepText.includes('600W') || stepText.includes('レンジ')) heat = '📻 レンジ600W';
    else if (stepText.includes('炊飯')) heat = '🍚 炊飯器';

    if (/(切|下ごしらえ|下処理|カット|水気|拭)/.test(stepText) && idx === 0) {
      stage = '下ごしらえ';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><rect x="6" y="30" width="36" height="8" rx="3" fill="#d97706" opacity="0.35"/><path d="M12 24L34 10L38 18L18 28Z" fill="#fbbf24" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M9 26L14 23" stroke="#ff7043" stroke-width="3.5" stroke-linecap="round"/><circle cx="28" cy="27" r="3" fill="#4ade80"/><circle cx="35" cy="27" r="2.5" fill="#f87171"/></svg>`;
    } else if (/(下味|揉み|混ぜ|和え|タレ|ソース)/.test(stepText) && idx <= 1) {
      stage = '下味・タレ';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><path d="M10 22C10 31 16 37 24 37C32 37 38 31 38 22H10Z" fill="#fb923c" opacity="0.35" stroke="#fbbf24" stroke-width="2"/><path d="M29 11L21 24" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="19" cy="18" r="2" fill="#fde047"/></svg>`;
    } else if (/(レンジ|600W|炊飯|蒸し)/.test(stepText)) {
      stage = '時短加熱';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><rect x="10" y="22" width="28" height="14" rx="4" fill="#fbbf24" opacity="0.28" stroke="#fcd34d" stroke-width="2"/><path d="M15 22C17 17 31 17 33 22" stroke="#fcd34d" stroke-width="2"/><path d="M18 14C18 11 20 11 20 8M24 14C24 11 26 11 26 8M30 14C30 11 32 11 32 8" stroke="#7dd3fc" stroke-width="2" stroke-linecap="round"/></svg>`;
    } else if (/(煮|沸騰|スープ|茹で)/.test(stepText)) {
      stage = '煮込み';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><path d="M11 23H37L35 36C34.5 38 32 39 24 39C16 39 13.5 38 13 36L11 23Z" fill="#f59e0b" opacity="0.35" stroke="#fbbf24" stroke-width="2"/><path d="M13 22C15 17 33 17 35 22" stroke="#fde047" stroke-width="2"/><path d="M18 42L21 39M30 42L27 39M24 43V39" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/></svg>`;
    } else if (idx === total - 1 || /(仕上げ|完成|盛り付け|のせて)/.test(stepText)) {
      stage = '仕上げ';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><ellipse cx="24" cy="31" rx="16" ry="6" fill="#fbbf24" opacity="0.3" stroke="#fde047" stroke-width="2"/><path d="M16 28C17 22 31 22 32 28" fill="#f97316" opacity="0.6"/><path d="M24 11L25.5 15L29.5 16.5L25.5 18L24 22L22.5 18L18.5 16.5L22.5 15L24 11Z" fill="#fde047"/></svg>`;
    } else {
      stage = '焼く・炒める';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><path d="M10 26C12 33 17 36 24 36C31 36 36 33 38 26H10Z" fill="#ea580c" opacity="0.45" stroke="#fbbf24" stroke-width="2"/><path d="M38 27L44 24" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/><path d="M24 12C27 16 29 19 26 23C24 25 21 24 21 21C21 18 23 15 24 12Z" fill="#f97316"/></svg>`;
    }

    return { stage, heat, time, svgIcon };
  }

  function highlightStepText(text) {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^【(.+?)】/, '<mark>$1</mark> ');
    return escaped.replace(
      /([0-9.\/〜~-]+\s*(?:分半|分|秒|g|ml|℃|W|大さじ[0-9.\/]+|小さじ[0-9.\/]+)|大さじ[0-9.\/]+|小さじ[0-9.\/]+)/g,
      '<mark>$1</mark>'
    );
  }

  function buildIllustratedRecipeHTML(dish, scaleFactor = 1) {
    const ings = dish.ingredients || [];
    const steps = dish.steps || [];
    const tips = dish.tips || [];
    const matchedSubs = getDishSubstitutions(ings);

    const ingredientsGridHTML = ings
      .map(rawIng => {
        const { name, amount, scaleNote } = parseJpIngredient(rawIng, scaleFactor);
        const subMark = hasIngredientSub(rawIng) ? `<span class="ing-sub-dot" title="下に代用ガイドあり">代用可</span>` : '';
        const titleAttr = scaleNote ? `title="${scaleNote}"` : '';
        return `
        <div class="ing-check-item" role="button" tabindex="0">
          <div class="ing-check-left">
            <span class="ing-checkbox">✓</span>
            <span class="ing-name">${name}</span>
            ${subMark}
          </div>
          <span class="ing-amount" ${titleAttr}>${amount}</span>
        </div>
      `;
      })
      .join('');

    const subGuideHTML =
      matchedSubs.length > 0
        ? `
        <div class="sub-guide-box">
          <div class="recipe-block-header" style="margin-bottom:8px;">
            <span class="recipe-block-title" style="color:#7dd3fc;">🔄 家にある調味料で代用ガイド</span>
            <span class="recipe-block-sub">${matchedSubs.length}件の代用ワザ</span>
          </div>
          <div class="sub-guide-list">
            ${matchedSubs
              .map(
                s => `
              <div class="sub-guide-row">
                <span class="sub-orig-tag">${s.label}</span>
                <span class="sub-arrow">→</span>
                <span class="sub-alt-text">${s.sub}</span>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `
        : '';

    const stepsListHTML = steps
      .map((stepText, idx) => {
        const vis = analyzeStepVisual(stepText, idx, steps.length);
        const stepNumStr = String(idx + 1).padStart(2, '0');
        return `
        <div class="illustrated-step-card step-clean-card" role="button" tabindex="0">
          <div class="step-num-col">
            <span class="step-big-num">${stepNumStr}</span>
            <span class="step-check-mark">✓</span>
          </div>
          <div class="step-content-col">
            <div class="step-top-bar">
              <span class="step-num-badge">STEP ${idx + 1} / ${steps.length}</span>
              <div class="step-tech-tags">
                ${vis.heat ? `<span class="step-tech-tag">${vis.heat}</span>` : ''}
                ${vis.time ? `<span class="step-tech-tag">${vis.time}</span>` : ''}
              </div>
            </div>
            <div class="step-desc-text">${highlightStepText(stepText)}</div>
          </div>
        </div>
      `;
      })
      .join('');

    const tipsHTML =
      tips.length > 0
        ? `
        <div class="chef-tips-box">
          <div class="recipe-block-header" style="margin-bottom:6px;">
            <span class="recipe-block-title">💡 おいしく作るコツ</span>
          </div>
          <ul class="chef-tips-list">
            ${tips.map(t => `<li><span>${t}</span></li>`).join('')}
          </ul>
        </div>
      `
        : '';

    return `
      <div class="recipe-hero-banner">
        <div class="recipe-meta-pills">
          ${dish.aiPick ? `<span class="meta-pill" style="border-color:rgba(251,191,36,0.5);color:#fde68a;">✨ 厳選ハズレなし</span>` : ''}
          ${dish.lazyTool ? `<span class="meta-pill" style="border-color:rgba(192,132,252,0.5);color:#e9d5ff;">${dish.lazyTool}</span>` : ''}
          <span class="meta-pill">⏱️ ${dish.time || '約15分'}</span>
          <span class="meta-pill">🔥 ${dish.difficulty || '★★☆☆☆'}</span>
          <span class="meta-pill">🛒 材料 ${ings.length} 品</span>
        </div>
        ${dish.intro ? `<div class="recipe-intro-text">${dish.intro}</div>` : ''}
      </div>

      <div>
        <div class="recipe-block-header" style="flex-wrap:wrap;">
          <span class="recipe-block-title">🛒 材料と具体的な分量</span>
          <div class="serving-scale-bar" role="group" aria-label="人数切替">
            <button type="button" class="serving-pill ${scaleFactor === 0.5 ? 'active' : ''}" data-scale="0.5">1人前</button>
            <button type="button" class="serving-pill ${scaleFactor === 1 ? 'active' : ''}" data-scale="1">2人前</button>
            <button type="button" class="serving-pill ${scaleFactor === 2 ? 'active' : ''}" data-scale="2">4人前</button>
          </div>
        </div>
        <div class="dosage-measure-hint">${
          scaleFactor === 1
            ? '📏 すべて具体的な分量で表示（大さじ1=15ml / 小さじ1=5ml）· タップでチェック'
            : '👨‍🍳 プロの非線形換算を適用中：メイン食材は等比、醤油・塩・油・スパイスは塩辛くならないよう調整済み'
        }</div>
        <div class="ing-checklist-grid">${ingredientsGridHTML}</div>
      </div>

      ${subGuideHTML}

      <div>
        <div class="recipe-block-header">
          <span class="recipe-block-title">⚡ 作り方ステップ</span>
          <span class="recipe-block-sub">タップで完了マーク</span>
        </div>
        <div class="illustrated-steps-list">${stepsListHTML}</div>
      </div>

      ${tipsHTML}
    `;
  }

  function bindRecipeInteractions(containerEl, dish) {
    containerEl.querySelectorAll('.ing-check-item').forEach(item => {
      item.addEventListener('click', () => {
        playSelectSound();
        item.classList.toggle('checked');
      });
    });
    containerEl.querySelectorAll('.illustrated-step-card').forEach(card => {
      card.addEventListener('click', () => {
        playSelectSound();
        card.classList.toggle('step-done');
      });
    });
    containerEl.querySelectorAll('.serving-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const scale = parseFloat(btn.dataset.scale) || 1;
        playSelectSound();
        dish._servingScale = scale;
        const prevScroll = containerEl.scrollTop;
        containerEl.innerHTML = buildIllustratedRecipeHTML(dish, scale);
        bindRecipeInteractions(containerEl, dish);
        containerEl.scrollTop = prevScroll;
      });
    });
  }

  function copyRecipeToClipboard(dish) {
    playSelectSound();
    recordTasteSignal('copy', { item: dish });
    const scale = dish._servingScale || 1;
    const scaleLabel = scale === 0.5 ? '1人前' : scale === 2 ? '4人前' : '2人前';
    const ingLines = (dish.ingredients || []).map(raw => {
      const { name, amount } = parseJpIngredient(raw, scale);
      return `- ${name}：${amount}`;
    });
    const lines = [
      `【${dish.name} レシピ】(${dish.cuisine} · ${scaleLabel})`,
      `所要時間：${dish.time || '約15分'}`,
      '',
      '🛒 材料（大さじ1=15ml / 小さじ1=5ml）：',
      ...ingLines,
      '',
      '⚡ 作り方：',
      ...(dish.steps || []).map((s, idx) => `${idx + 1}. ${s}`)
    ];
    navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => showToast(`✅ 「${dish.name}」(${scaleLabel}) の買い物リストをコピーしました`))
      .catch(() => showToast(`✅ 「${dish.name}」リスト生成完了`));
  }

  function openRecipeModal(dish) {
    playSelectSound();
    recordTasteSignal('open_detail', { item: dish });
    modalEmoji.textContent = dish.emoji || '🍲';
    modalDishName.textContent = dish.name;
    modalTags.innerHTML = `
      <span class="badge badge-cuisine">${dish.cuisine}</span>
      <span class="badge badge-flavor">${dish.tag || '定番レシピ'}</span>
    `;

    modalBody.scrollTop = 0;
    modalBody.innerHTML = buildIllustratedRecipeHTML(dish, dish._servingScale || 1);
    bindRecipeInteractions(modalBody, dish);

    const ytUrl = getYouTubeRecipeUrl(dish);
    const cookpadUrl = `https://cookpad.com/jp/search/${encodeURIComponent(dish.name)}`;
    modalFooter.style.gridTemplateColumns = 'repeat(3, 1fr)';
    modalFooter.innerHTML = `
      <a href="${cookpadUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn primary-action" id="btnModalCookpad">🔍 クックパッド検索</a>
      <a href="${ytUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn video-action" id="btnModalYouTube">📺 YouTube動画</a>
      <button type="button" class="action-link-btn" id="btnModalCopy">📋 買い物リスト</button>
    `;
    document.getElementById('btnModalCopy')?.addEventListener('click', () => copyRecipeToClipboard(dish));

    recipeModal.classList.add('open');
    recipeModal.setAttribute('aria-hidden', 'false');
  }

  function openShopModal(item) {
    playSelectSound();
    recordTasteSignal('open_detail', { item });
    const peerShops = (state.mode === 'takeout' ? getFilteredPool() : state.nearbyShops).filter(s => s.isRealShop);
    const radiusKm = (state.radius / 1000).toFixed(0);
    const cuisineLabel = state.cuisine === 'all' ? '全ジャンル' : state.cuisine;
    const srcBadgeMap = {
      google: '🌍 Google Places 星評価付',
      hotpepper: '🇯🇵 ホットペッパーグルメ',
      osm: '🗺️ オープン地図実店舗'
    };
    const srcBadge = srcBadgeMap[item.source || state.nearbySource] || '周辺実店舗';
    const copyTarget = item.isRealShop ? item.name : (item.searchKeyword || item.name);

    modalEmoji.textContent = item.emoji || '🏪';
    modalDishName.textContent = item.name;
    modalTags.innerHTML = `
      <span class="badge badge-cuisine">${item.cuisine}</span>
      ${item.rating ? formatRatingBadge(item) : ''}
      <span class="badge badge-flavor">${item.isRealShop ? srcBadge : '定番チェーン・宅配'}</span>
    `;

    const combosHTML = (item.combos || ['定番人気ランチセット', 'おすすめ1人前メニュー'])
      .map(c => `<span class="combo-suggest-chip">🍽️ ${c}</span>`)
      .join('');

    const shopPhotoHTML = item.photoUrl
      ? `<img src="${item.photoUrl}" alt="${item.name}" class="shop-hero-photo" loading="lazy" onerror="this.style.display='none'" />`
      : '';

    const ratingPill = item.rating
      ? `<span class="meta-pill" style="border-color:rgba(250,204,21,0.55);color:#fef08a;">⭐ ${item.rating}${item.ratingCount ? `（口コミ${item.ratingCount}件）` : ''}</span>`
      : '';

    const heroHTML = item.isRealShop
      ? `
        <div class="recipe-hero-banner">
          ${shopPhotoHTML}
          <div class="recipe-meta-pills">
            ${ratingPill}
            <span class="meta-pill">📍 現在地から ${formatDistance(item.distance)}</span>
            <span class="meta-pill">🛵 目安 ${item.estDeliveryMin}分</span>
            ${item.budgetText ? `<span class="meta-pill">💰 ${item.budgetText}</span>` : ''}
          </div>
          <div class="recipe-intro-text">
            📍 住所：<strong>${item.address || `${state.location.label} ${radiusKm}km圏内`}</strong>
            ${item.openTime ? `<br/>🕒 営業時間：${item.openTime}` : ''}
          </div>
          <div>
            <div class="recipe-block-header" style="margin-bottom:6px;">
              <span class="recipe-block-title">🍱 おすすめ注文イメージ</span>
            </div>
            <div class="combo-suggest-chips">${combosHTML}</div>
          </div>
        </div>
      `
      : `
        <div class="recipe-hero-banner">
          <div class="recipe-meta-pills">
            <span class="meta-pill">📍 ${state.location.label} · 定番チェーン＆デリバリー候補</span>
            <span class="meta-pill">💡 右上の ⚙️ で Google / ホットペッパー設定すると実店舗＆星評価を表示</span>
          </div>
        </div>
      `;

    const shopRowsHTML = peerShops
      .slice(0, 40)
      .map(
        (shop, idx) => `
        <div class="nearby-shop-row ${shop.name === item.name ? 'selected-shop' : ''}" data-shop-idx="${idx}">
          <div class="nearby-shop-top">
            <span class="nearby-shop-name">${shop.emoji} ${shop.name}</span>
            <span class="nearby-shop-meta-right">
              ${shop.rating ? `<span class="nearby-shop-star">⭐ ${shop.rating}</span>` : ''}
              <span class="nearby-shop-dist">${formatDistance(shop.distance)}</span>
            </span>
          </div>
          <div class="nearby-shop-bottom">
            <span class="nearby-shop-addr">📍 ${shop.address || '周辺エリア'}</span>
            <span class="nearby-shop-tag">${shop.cuisine}</span>
          </div>
        </div>
      `
      )
      .join('');

    const directoryHTML =
      peerShops.length > 0
        ? `
        <div>
          <div class="recipe-block-header">
            <span class="recipe-block-title">🏪 周辺 ${radiusKm}km圏内「${cuisineLabel}」のお店（${peerShops.length}軒）</span>
            <span class="recipe-block-sub">タップで切り替え</span>
          </div>
          <div class="shop-list-grid">${shopRowsHTML}</div>
        </div>
      `
        : '';

    const recruitCreditHTML =
      item.source === 'hotpepper' || state.nearbySource === 'hotpepper'
        ? `<div class="recruit-credit">Powered by <a href="http://webservice.recruit.co.jp/" target="_blank" rel="noopener noreferrer">ホットペッパーグルメ Webサービス</a></div>`
        : '';

    const gmapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.isRealShop && item.address ? `${item.name} ${item.address}` : copyTarget)}`;
    const uberUrl = `https://www.ubereats.com/jp/search?q=${encodeURIComponent(copyTarget)}`;
    const demaeUrl = `https://demae-can.com/search/delivery/?keyword=${encodeURIComponent(copyTarget)}`;
    const jumpBarHTML = `
      <div>
        <div class="recipe-block-header" style="margin-bottom:8px;">
          <span class="recipe-block-title">🚀 マップ・デリバリーで直接検索</span>
        </div>
        <div class="shop-jump-bar">
          <a href="${gmapUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn map-action">🗺️ Googleマップ</a>
          <a href="${uberUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn meituan-action">🛵 Uber Eats</a>
          <a href="${demaeUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn eleme-action">🍱 出前館</a>
          <button type="button" class="action-link-btn" id="btnJpCopyInline">📋 店名コピー</button>
        </div>
      </div>
    `;

    modalBody.scrollTop = 0;
    modalBody.innerHTML = heroHTML + jumpBarHTML + directoryHTML + recruitCreditHTML;
    document.getElementById('btnJpCopyInline')?.addEventListener('click', () => {
      playSelectSound();
      navigator.clipboard?.writeText(copyTarget).then(() => showToast(`✅ 「${copyTarget}」をコピーしました`)).catch(() => {});
    });

    modalBody.querySelectorAll('.nearby-shop-row').forEach(row => {
      row.addEventListener('click', () => {
        const shop = peerShops[Number(row.dataset.shopIdx)];
        if (!shop) return;
        state.currentDish = shop;
        slotReel.style.transition = 'none';
        slotReel.style.transform = 'translate3d(0, 0, 0)';
        slotReel.innerHTML = createReelCardHTML(shop);
        renderResultDock(shop);
        addToHistory(shop);
        openShopModal(shop);
      });
    });

    modalFooter.style.gridTemplateColumns = '1fr 1fr';
    modalFooter.innerHTML = `
      <button type="button" class="action-link-btn primary-action" id="btnModalCopyShop">📋 店名をコピー（Uber/マップ用）</button>
      <button type="button" class="action-link-btn" id="btnModalDoneShop">✅ 閉じる</button>
    `;
    document.getElementById('btnModalCopyShop')?.addEventListener('click', () => {
      playSelectSound();
      recordTasteSignal('copy', { item });
      navigator.clipboard
        .writeText(copyTarget)
        .then(() => showToast(`✅ 「${copyTarget}」をコピーしました`))
        .catch(() => showToast(`✅ 店名：${copyTarget}`));
    });
    document.getElementById('btnModalDoneShop')?.addEventListener('click', closeRecipeModal);

    recipeModal.classList.add('open');
    recipeModal.setAttribute('aria-hidden', 'false');
  }

  function closeRecipeModal() {
    recipeModal.classList.remove('open');
    recipeModal.setAttribute('aria-hidden', 'true');
  }

  function openSourceModal() {
    playSelectSound();
    if (googleKeyInput) googleKeyInput.value = state.googleKey;
    if (hotpepperKeyInput) hotpepperKeyInput.value = state.hotpepperKey;
    const enabled = [state.googleKey && 'Google星評価', state.hotpepperKey && 'ホットペッパー'].filter(Boolean);
    sourceStatusBadge.textContent = enabled.length > 0 ? `有効：${enabled.join(' + ')}` : '現在：キー不要モード（設定で星評価解放）';
    sourceModal.classList.add('open');
    sourceModal.setAttribute('aria-hidden', 'false');
  }

  function closeSourceModal() {
    sourceModal.classList.remove('open');
    sourceModal.setAttribute('aria-hidden', 'true');
  }

  // =========================================================================
  // 10. 完全オフライン食の好みカルテモーダル
  // =========================================================================
  function computeOfflinePersona() {
    const topC = getTopEntries(tasteProfile.cuisineScores, 3);
    const topF = getTopEntries(tasteProfile.flavorScores, 3);
    const totalModes = Object.values(tasteProfile.modeCounts).reduce((a, b) => a + b, 0) || 1;
    const lazyPct = Math.round(((tasteProfile.modeCounts.lazy || 0) / totalModes) * 100);
    const takeoutPct = Math.round(((tasteProfile.modeCounts.takeout || 0) / totalModes) * 100);

    if (tasteProfile.totalInteractions < 3) {
      return {
        title: '🌱 グルメ探索ビギナー',
        desc: 'ローカル好みカルテが起動しました！ガチャを回したり 👍/👎 を押すだけで、完全オフラインであなたの好みを覚えていきます。'
      };
    }

    const favC = topC[0]?.[0] || 'バランス派';
    const favF = topF[0]?.[0] || '和風だし・あっさり';
    let title = '🍽️ 世界グルメも楽しむ食通タイプ';
    if (favC === '麺類・パスタ') title = '🍜 無類の麺＆パスタ愛食家';
    else if (favC === '和食・丼・鍋' || favF === '和風だし・あっさり') title = '🍚 お出汁と和食を愛する達人';
    else if (favC === 'ガッツリ肉・揚げ物' || favF === 'こってり・ガッツリ') title = '🥩 ガッツリスタミナ派';
    else if (favC === '洋食・欧米料理') title = '🍝 イタリアン＆洋食カフェ派';
    else if (favC === '韓国・エスニック') title = '🌶️ スパイス＆アジア料理ハンター';
    else if (favC === '中華・台湾料理') title = '🥟 町中華＆台湾グルメ通';
    else if (lazyPct >= 40) title = '⚡ レンチン＆時短ズボラ飯マスター';
    else if (takeoutPct >= 45) title = '🛵 外食・デリバリー開拓ハンター';

    const desc = `特に <strong>${favC}</strong> と <strong>${favF}</strong> が好み。ズボラ飯比率 ${lazyPct}%・外食宅配比率 ${takeoutPct}%（累計 ${tasteProfile.totalDraws} 回記録・お気に入り ${tasteProfile.likedItems.length} 品）。`;
    return { title, desc };
  }

  function buildOfflineInsights() {
    const insights = [];
    const totalMeals = (tasteProfile.mealCounts.breakfast || 0) + (tasteProfile.mealCounts.lunch || 0) + (tasteProfile.mealCounts.dinner || 0);
    const totalModes = Object.values(tasteProfile.modeCounts).reduce((a, b) => a + b, 0);
    const topF = getTopEntries(tasteProfile.flavorScores, 3).map(([k]) => k);

    if (tasteProfile.totalDraws < 3) {
      insights.push('💡 3回以上ガチャを回すと、ここに食事リズムと栄養バランスのローカル分析が表示されます。');
      insights.push('🔒 データはブラウザ内のみに保存。下部の「バックアップ保存」で機種変更も安心です。');
      return insights;
    }

    if (totalMeals > 0) {
      const bPct = Math.round(((tasteProfile.mealCounts.breakfast || 0) / totalMeals) * 100);
      const lPct = Math.round(((tasteProfile.mealCounts.lunch || 0) / totalMeals) * 100);
      const dPct = Math.max(0, 100 - bPct - lPct);
      insights.push(`🕒 時間帯バランス：朝 ${bPct}% · 昼 ${lPct}% · 夜 ${dPct}%${bPct < 15 ? '（朝ごはん少なめかも？おにぎりやTKGもおすすめ！）' : ''}`);
    }

    if (totalModes > 0) {
      const cookAll = (tasteProfile.modeCounts.cook || 0) + (tasteProfile.modeCounts.lazy || 0);
      const takeoutPct = Math.round(((tasteProfile.modeCounts.takeout || 0) / totalModes) * 100);
      if (takeoutPct >= 55) {
        insights.push('🛵 外食・宅配が多めです。平日は「⚡ ズボラ飯」のレンチン5分レシピで節約＆塩分控えめも◎');
      } else if (cookAll > 0) {
        insights.push(`🍳 自炊・ズボラ飯が ${Math.round((cookAll / totalModes) * 100)}%！とても健康的なペースです。`);
      }
    }

    if (topF.includes('こってり・ガッツリ') || topF.includes('ピリ辛・スタミナ')) {
      insights.push('🥗 しっかり味が多めなので、たまに「🍲 鍋・スープ」や「🥗 軽食・ヘルシー」で野菜補給を！');
    } else if (topF.includes('麺・炭水化物')) {
      insights.push('🥚 麺・丼が多め。ゆで卵・納豆・豆腐・サラダチキンを1品足すとタンパク質バランス◎');
    } else {
      insights.push('✨ 和洋バランスよく食べられています！この調子で旬の食材も楽しんでください。');
    }

    return insights;
  }

  function renderTasteModalContent() {
    const persona = computeOfflinePersona();
    const topC = getTopEntries(tasteProfile.cuisineScores, 5);
    const maxC = topC[0]?.[1] || 1;
    const topF = getTopEntries(tasteProfile.flavorScores, 6);
    const insights = buildOfflineInsights();

    tasteCountBadge.textContent = `記録 ${tasteProfile.totalInteractions} 件`;

    const cuisineBarsHTML = topC.length > 0
      ? topC
          .map(([name, val]) => {
            const pct = Math.max(12, Math.round((val / maxC) * 100));
            return `
              <div class="taste-bar-row">
                <span class="taste-bar-label">${name}</span>
                <div class="taste-bar-track"><div class="taste-bar-fill" style="width:${pct}%"></div></div>
                <span class="taste-bar-val">${pct}%</span>
              </div>
            `;
          })
          .join('')
      : `<div style="font-size:12.5px;color:var(--text-muted);">まだ記録がありません。ガチャや 👍 ボタンを押して育ててみましょう！</div>`;

    const flavorPillsHTML = topF.length > 0
      ? topF.map(([k]) => `<span class="taste-tag-pill">✨ ${k}</span>`).join('')
      : `<span class="taste-tag-pill">これから学習します</span>`;

    const likedHTML = tasteProfile.likedItems.length > 0
      ? tasteProfile.likedItems.slice(0, 12).map(x => `<span class="taste-tag-pill liked">👍 ${x.emoji || ''} ${x.name}</span>`).join('')
      : `<span style="font-size:12px;color:var(--text-muted);">結果の「👍 食べたい」を押すとここに追加されます</span>`;

    const dislikedHTML = tasteProfile.dislikedItems.length > 0
      ? tasteProfile.dislikedItems.slice(0, 10).map(x => `<span class="taste-tag-pill disliked">👎 ${x.name}</span>`).join('')
      : '';

    tasteModalBody.innerHTML = `
      <div class="taste-persona-banner">
        <div style="font-size:15px;font-weight:800;margin-bottom:4px;">${persona.title}</div>
        <div>${persona.desc}</div>
      </div>

      <div class="taste-stat-grid">
        <div class="taste-stat-card">
          <span class="taste-stat-val">${tasteProfile.totalDraws}</span>
          <span class="taste-stat-label">累計ガチャ</span>
        </div>
        <div class="taste-stat-card">
          <span class="taste-stat-val">${tasteProfile.likedItems.length}</span>
          <span class="taste-stat-label">👍 お気に入り</span>
        </div>
        <div class="taste-stat-card">
          <span class="taste-stat-val">${tasteProfile.dislikedItems.length}</span>
          <span class="taste-stat-label">👎 パス済み</span>
        </div>
        <div class="taste-stat-card">
          <span class="taste-stat-val">${tasteProfile.recentHistory.length}</span>
          <span class="taste-stat-label">かぶり防止履歴</span>
        </div>
      </div>

      <div class="taste-section-card">
        <div class="recipe-block-header" style="margin-bottom:2px;">
          <span class="recipe-block-title">📈 好きなジャンル TOP 5</span>
          <span class="recipe-block-sub">完全オフライン計算</span>
        </div>
        <div class="taste-bar-list">${cuisineBarsHTML}</div>
        <div class="taste-chip-wrap" style="margin-top:4px;">${flavorPillsHTML}</div>
      </div>

      <div class="taste-section-card">
        <div class="recipe-block-header" style="margin-bottom:2px;">
          <span class="recipe-block-title">🧭 食生活バランスメモ</span>
        </div>
        <ul class="taste-insight-list">
          ${insights.map(line => `<li>${line}</li>`).join('')}
        </ul>
      </div>

      <div class="taste-section-card">
        <div class="recipe-block-header" style="margin-bottom:2px;">
          <span class="recipe-block-title">👍 お気に入り & 👎 パス一覧</span>
        </div>
        <div class="taste-chip-wrap">${likedHTML}</div>
        ${dislikedHTML ? `<div class="taste-chip-wrap" style="margin-top:4px;">${dislikedHTML}</div>` : ''}
      </div>
    `;
  }

  function openTasteModal() {
    playSelectSound();
    renderTasteModalContent();
    tasteModal.classList.add('open');
    tasteModal.setAttribute('aria-hidden', 'false');
  }

  function closeTasteModal() {
    tasteModal.classList.remove('open');
    tasteModal.setAttribute('aria-hidden', 'true');
  }

  // =========================================================================
  // 11. 履歴＆イベント設定
  // =========================================================================
  function addToHistory(item) {
    state.history = [
      { dish: item, meal: state.meal, mode: state.mode },
      ...state.history.filter(h => h.dish.name !== item.name)
    ].slice(0, 8);
    renderHistoryList();
  }

  function renderHistoryList() {
    if (state.history.length === 0) {
      historyList.innerHTML = `<span class="history-empty">まだ履歴がありません · 当たった料理がここに並びます</span>`;
      return;
    }
    historyList.innerHTML = state.history
      .map(
        (item, idx) => `
        <span class="history-pill ${state.currentDish?.name === item.dish.name ? 'active-pill' : ''}" data-idx="${idx}" title="タップで見返す">
          <span>${item.dish.emoji}</span>
          <span>${item.dish.name}</span>
        </span>
      `
      )
      .join('');

    historyList.querySelectorAll('.history-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const item = state.history[Number(pill.dataset.idx)];
        if (!item || state.isSpinning) return;
        playSelectSound();
        state.mode = item.mode;
        state.currentDish = item.dish;
        syncUI();
        slotReel.style.transition = 'none';
        slotReel.style.transform = 'translate3d(0, 0, 0)';
        slotReel.innerHTML = createReelCardHTML(item.dish);
        slotFrame.classList.add('won');
        renderResultDock(item.dish);
        renderHistoryList();
      });
    });
  }

  mealGroup.addEventListener('click', e => {
    const btn = e.target.closest('.segment-btn');
    if (!btn || state.isSpinning) return;
    if (state.meal !== btn.dataset.meal) {
      playSelectSound();
      state.meal = btn.dataset.meal;
      syncUI();
    }
  });

  modeGroup.addEventListener('click', e => {
    const btn = e.target.closest('.segment-btn');
    if (!btn || state.isSpinning) return;
    if (state.mode !== btn.dataset.mode) {
      playSelectSound();
      state.mode = btn.dataset.mode;
      state.currentDish = null;
      slotFrame.classList.remove('won');
      slotWinBanner.classList.remove('show');
      setDockMode('idle');

      const hintMap = {
        cook: { emoji: '🍳', title: '今日の自炊レシピを決めよう', mode: '代用ガイド＆分量換算付' },
        lazy: { emoji: '⚡', title: 'ズボラ時短飯を回そう', mode: 'レンチン・炊飯器・10分' },
        takeout: { emoji: '🛵', title: '周辺のお店・宅配を決めよう', mode: '現在地検索＆星評価対応' },
        guess: { emoji: '❤️', title: 'あなたへのおすすめ抽選', mode: 'オフライン好みカルテ連動' }
      };
      const hint = hintMap[state.mode] || hintMap.cook;
      slotReel.style.transition = 'none';
      slotReel.style.transform = 'translate3d(0, 0, 0)';
      slotReel.innerHTML = `
        <div class="reel-card">
          <div class="dish-emoji">${hint.emoji}</div>
          <div class="dish-name-wrap">
            <div class="dish-name">${hint.title}</div>
          </div>
          <div class="dish-badges">
            <span class="badge badge-cuisine">${state.cuisine === 'all' ? 'おまかせ' : state.cuisine}</span>
            <span class="badge badge-mode">${hint.mode}</span>
            <span class="badge badge-flavor">下のボタンをタップ</span>
          </div>
        </div>
      `;
      syncUI();
      renderHistoryList();

      if (state.mode === 'takeout' && !state.location.ready) {
        requestBrowserLocation();
      }
    }
  });

  cuisineGroup.addEventListener('click', e => {
    const btn = e.target.closest('.cuisine-chip');
    if (!btn || state.isSpinning) return;
    if (state.cuisine !== btn.dataset.cuisine) {
      playSelectSound();
      state.cuisine = btn.dataset.cuisine;
      recordTasteSignal('select_cuisine', { cuisine: state.cuisine });
      syncUI();
    }
  });

  radiusSelect.addEventListener('change', () => {
    playSelectSound();
    state.radius = parseInt(radiusSelect.value, 10) || 3000;
    if (state.location.ready) scanNearbyShops(true);
    else requestBrowserLocation();
  });

  btnDraw.addEventListener('click', () => {
    if (state.mode === 'takeout' && !state.location.ready && !state.location.denied && !state.location.locating) {
      playSelectSound();
      requestBrowserLocation(() => {
        if (!state.isSpinning) spinSlotMachine();
      });
      return;
    }
    spinSlotMachine();
  });

  btnRelocate.addEventListener('click', () => {
    playSelectSound();
    requestBrowserLocation();
  });

  btnSourceConfig.addEventListener('click', openSourceModal);
  btnCloseSourceModal.addEventListener('click', closeSourceModal);
  sourceModal.addEventListener('click', e => {
    if (e.target === sourceModal) closeSourceModal();
  });

  btnSaveSource.addEventListener('click', () => {
    const gKey = (googleKeyInput?.value || '').trim();
    const hKey = (hotpepperKeyInput?.value || '').trim();
    state.googleKey = gKey;
    state.hotpepperKey = hKey;
    if (gKey) localStorage.setItem('jp_food_google_key', gKey);
    else localStorage.removeItem('jp_food_google_key');
    if (hKey) localStorage.setItem('jp_food_hotpepper_key', hKey);
    else localStorage.removeItem('jp_food_hotpepper_key');
    closeSourceModal();
    const enabled = [gKey && 'Google星評価', hKey && 'ホットペッパー'].filter(Boolean);
    showToast(enabled.length > 0 ? `✅ 保存しました：${enabled.join(' + ')}` : '✅ キー不要モードに切り替えました');
    if (state.location.ready) scanNearbyShops(true);
    else if (state.mode === 'takeout') requestBrowserLocation();
  });

  btnResetSource.addEventListener('click', () => {
    state.googleKey = '';
    state.hotpepperKey = '';
    if (googleKeyInput) googleKeyInput.value = '';
    if (hotpepperKeyInput) hotpepperKeyInput.value = '';
    localStorage.removeItem('jp_food_google_key');
    localStorage.removeItem('jp_food_hotpepper_key');
    closeSourceModal();
    showToast('🔄 APIキーを消去し標準モードに戻しました');
    if (state.location.ready) scanNearbyShops(true);
  });

  document.querySelectorAll('.btn-open-taste').forEach(btn => btn.addEventListener('click', openTasteModal));
  btnCloseTasteModal?.addEventListener('click', closeTasteModal);
  tasteModal?.addEventListener('click', e => {
    if (e.target === tasteModal) closeTasteModal();
  });

  btnExportTaste?.addEventListener('click', () => {
    playSelectSound();
    const blob = new Blob([JSON.stringify(tasteProfile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jp-food-taste-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📤 好みカルテのバックアップ（JSON）を保存しました');
  });

  btnImportTaste?.addEventListener('click', () => {
    playSelectSound();
    tasteImportFile?.click();
  });

  tasteImportFile?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        if (typeof parsed !== 'object' || !parsed.cuisineScores) throw new Error('invalid');
        tasteProfile = { ...createEmptyTasteProfile(), ...parsed };
        saveTasteProfile();
        renderTasteModalContent();
        syncUI();
        showToast('📥 好みカルテを復元しました！');
      } catch (_) {
        showToast('⚠️ 復元失敗：本アプリで保存したJSONファイルを選択してください');
      }
      tasteImportFile.value = '';
    };
    reader.readAsText(file);
  });

  btnClearTaste?.addEventListener('click', () => {
    playSelectSound();
    if (!confirm('ローカルに保存された好み履歴をリセットしますか？')) return;
    tasteProfile = createEmptyTasteProfile();
    saveTasteProfile();
    renderTasteModalContent();
    syncUI();
    showToast('🗑️ 好みカルテをリセットしました');
  });

  btnCloseModal.addEventListener('click', closeRecipeModal);
  recipeModal.addEventListener('click', e => {
    if (e.target === recipeModal) closeRecipeModal();
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (recipeModal.classList.contains('open')) closeRecipeModal();
      if (sourceModal.classList.contains('open')) closeSourceModal();
      if (tasteModal?.classList.contains('open')) closeTasteModal();
    }
  });

  syncUI();
  setTimeout(() => {
    if (!state.location.ready) requestBrowserLocation(null, true);
  }, 300);
})();
