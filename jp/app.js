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
    isSpinning: false,
    currentDish: null,
    displayedPoolCount: 0,
    history: []
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
  const historyList = document.getElementById('historyList');
  const fxCanvas = document.getElementById('fxCanvas');

  const recipeModal = document.getElementById('recipeModal');
  const modalEmoji = document.getElementById('modalEmoji');
  const modalDishName = document.getElementById('modalDishName');
  const modalTags = document.getElementById('modalTags');
  const modalBody = document.getElementById('modalBody');
  const modalFooter = document.getElementById('modalFooter');
  const btnCloseModal = document.getElementById('btnCloseModal');

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
  // 5. 候補プール計算＆UI同期
  // =========================================================================
  function getGuessPool() {
    const candidates = [];
    const seen = new Set();
    const pushIfValid = item => {
      if (!item || !item.name || seen.has(item.name)) return;
      if (state.cuisine !== 'all' && state.cuisine !== '厳選' && item.cuisine !== state.cuisine) return;
      if (state.cuisine === '厳選' && !item.aiPick) return;
      seen.add(item.name);
      candidates.push(item);
    };

    for (const d of staticDishes) {
      if (d.meals?.includes(state.meal)) {
        pushIfValid(d);
      }
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
    cuisineGroup.querySelectorAll('.cuisine-chip').forEach(btn => {
      const c = btn.dataset.cuisine;
      const baseLabel = cuisineBaseLabels.get(c) || btn.textContent;
      btn.textContent = baseLabel;
    });
  }

  let countAnimId = null;
  function animatePoolCount(targetCount) {
    if (countAnimId) cancelAnimationFrame(countAnimId);
    const startCount = state.displayedPoolCount || 0;
    const unit = '品';

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
      } else {
        dockIdleText.textContent = '🛵 外食・宅配モード：当たった料理をキーワード入力済みで Googleマップ / Uber Eats / 出前館で検索！';
      }
    }
  }

  // =========================================================================
  // 7. スロットカード描画＆4段階ガチャ演出
  // =========================================================================
  function createReelCardHTML(item) {
    const titleClass = item.name.length > 12 ? 'dish-name combo-title' : 'dish-name';
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
      const copyTarget = extractJpKeyword(item);
      const gmapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(copyTarget)}`;
      const uberUrl = `https://www.ubereats.com/jp/search?q=${encodeURIComponent(copyTarget)}`;

      resultActionContent.innerHTML = `
        <div class="action-panel-header">
          <span>🛵 「<strong>${item.name}</strong>」· 検索語：${copyTarget}</span>
          <div class="dock-header-right">${buildFeedbackHTML(item)}</div>
        </div>
        <div class="action-btn-grid cols-3">
          <button type="button" class="action-link-btn primary-action" id="btnOpenShopModal">
            🛵 検索＆注文
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
      document.getElementById('btnJpMapQuick')?.addEventListener('click', () => {
        playSelectSound();
        recordTasteSignal('open_detail', { item });
        navigator.clipboard?.writeText(copyTarget).catch(() => {});
      });
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

  function extractJpKeyword(item) {
    const rawKw = String(item.searchKeyword || item.name || '').trim();
    const firstToken = rawKw.split(/[\s+/・、，,]+/).filter(Boolean)[0] || rawKw;
    return firstToken || rawKw;
  }

  function openShopModal(item) {
    playSelectSound();
    recordTasteSignal('open_detail', { item });
    const copyTarget = extractJpKeyword(item);

    modalEmoji.textContent = item.emoji || '🛵';
    modalDishName.textContent = item.name;
    modalTags.innerHTML = `
      <span class="badge badge-cuisine">${item.cuisine}</span>
      <span class="badge badge-mode">🛵 外食・宅配</span>
      <span class="badge badge-flavor">${item.tag || '定番人気'}</span>
    `;

    const heroHTML = `
      <div class="recipe-hero-banner">
        <div class="recipe-meta-pills">
          <span class="meta-pill">🔍 検索キーワード：<strong>${copyTarget}</strong></span>
          <span class="meta-pill">📍 現在地はお使いのマップ・宅配アプリ側で自動取得</span>
        </div>
        <div class="recipe-intro-text">
          下のボタンをタップすると「<strong>${copyTarget}</strong>」を自動入力して Googleマップ / Uber Eats / 出前館 を開きます（同時にクリップボードへもコピーされます）。
        </div>
      </div>
    `;

    const gmapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(copyTarget)}`;
    const uberUrl = `https://www.ubereats.com/jp/search?q=${encodeURIComponent(copyTarget)}`;
    const demaeUrl = `https://demae-can.com/search/delivery/?keyword=${encodeURIComponent(copyTarget)}`;
    const jumpBarHTML = `
      <div>
        <div class="recipe-block-header" style="margin-bottom:8px;">
          <span class="recipe-block-title">🚀 キーワード入力済みでそのまま検索</span>
          <span class="recipe-block-sub">手入力なしで周辺のお店をチェック</span>
        </div>
        <div class="shop-jump-bar">
          <a href="${gmapUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn map-action" id="btnJpModalMap">🗺️ Googleマップ</a>
          <a href="${uberUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn meituan-action" id="btnJpModalUber">🛵 Uber Eats</a>
          <a href="${demaeUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn eleme-action" id="btnJpModalDemae">🍱 出前館</a>
          <button type="button" class="action-link-btn" id="btnJpCopyInline">📋 コピー</button>
        </div>
      </div>
    `;

    modalBody.scrollTop = 0;
    modalBody.innerHTML = heroHTML + jumpBarHTML;
    ['btnJpModalMap', 'btnJpModalUber', 'btnJpModalDemae'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        playSelectSound();
        recordTasteSignal('copy', { item });
        navigator.clipboard?.writeText(copyTarget).catch(() => {});
      });
    });
    document.getElementById('btnJpCopyInline')?.addEventListener('click', () => {
      playSelectSound();
      navigator.clipboard?.writeText(copyTarget).then(() => showToast(`✅ 「${copyTarget}」をコピーしました`)).catch(() => {});
    });

    modalFooter.style.gridTemplateColumns = '1fr 1fr';
    modalFooter.innerHTML = `
      <button type="button" class="action-link-btn primary-action" id="btnModalCopyShop">📋 検索ワードをコピー</button>
      <button type="button" class="action-link-btn" id="btnModalDoneShop">✅ 閉じる</button>
    `;
    document.getElementById('btnModalCopyShop')?.addEventListener('click', () => {
      playSelectSound();
      recordTasteSignal('copy', { item });
      navigator.clipboard
        .writeText(copyTarget)
        .then(() => showToast(`✅ 「${copyTarget}」をコピーしました`))
        .catch(() => showToast(`✅ 検索語：${copyTarget}`));
    });
    document.getElementById('btnModalDoneShop')?.addEventListener('click', closeRecipeModal);

    recipeModal.classList.add('open');
    recipeModal.setAttribute('aria-hidden', 'false');
  }

  function closeRecipeModal() {
    recipeModal.classList.remove('open');
    recipeModal.setAttribute('aria-hidden', 'true');
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
        takeout: { emoji: '🛵', title: '今日の外食・宅配メニューを決めよう', mode: 'マップ・宅配アプリ直結' },
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

  btnDraw.addEventListener('click', () => {
    spinSlotMachine();
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
      if (tasteModal?.classList.contains('open')) closeTasteModal();
    }
  });

  syncUI();
})();
