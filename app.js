(function () {
  const aiCuratedDishes = window.AI_CURATED_DATA || [];
  const localSubstitutions = window.LOCAL_SUBSTITUTIONS || [];

  // 合并 AI精选菜谱库 + 开源菜谱/外卖套餐库，并自动识别归类“懒人专区”菜品
  const lazyPattern = /(电饭煲|空气炸锅|微波炉|懒人|快手|泡面|方便面|拌面|汤面|蛋炒饭|炒饭|盖饭|丼|饭团|三明治|吐司|贝果|燕麦|蒸蛋|鸡蛋羹|荷包蛋|太阳蛋|煎蛋|炒蛋|手抓饼|煎饼|速冻|水饺|馄饨|抄手|凉拌|焖饭|一锅|葱油拌面|番茄炒蛋|西红柿炒鸡蛋|煮面|酸辣粉|螺蛳粉)/;
  function detectLazyTool(d) {
    if (d.lazyTool) return d.lazyTool;
    if (d.name.includes('电饭煲') || d.name.includes('焖饭') || d.name.includes('煲仔饭')) return '🍚 电饭煲一锅出';
    if (d.name.includes('空气炸锅') || d.name.includes('烤')) return '🍟 空气炸锅免看火';
    if (d.name.includes('微波炉')) return '📻 微波炉快手';
    if (/(凉拌|沙拉|三明治|吐司|燕麦|饭团)/.test(d.name)) return '🥗 免开火快手';
    return '⚡ 10~15分钟一锅出';
  }

  const aiNames = new Set(aiCuratedDishes.map(d => d.name));
  const mergedBase = (window.DISHES_DATA || [])
    .filter(d => !aiNames.has(d.name))
    .map(d => {
      if (d.modes && d.modes.includes('cook')) {
        const isLazy = lazyPattern.test(d.name) || (d.steps && d.steps.length <= 4);
        if (isLazy) {
          return {
            ...d,
            modes: Array.from(new Set([...d.modes, 'lazy'])),
            lazyTool: detectLazyTool(d)
          };
        }
      }
      return d;
    });

  const staticDishes = [...aiCuratedDishes, ...mergedBase];
  const CARD_HEIGHT = 196;

  // 当前三步状态 + 周边实店扫描状态
  const state = {
    meal: 'breakfast',   // 'breakfast' | 'lunch' | 'dinner'
    mode: 'cook',        // 'cook' | 'lazy' | 'takeout' | 'guess'
    cuisine: 'all',      // 'all' | 'AI精选' | specific cuisine name
    radius: 3000,        // 1000 | 3000 | 5000 (meters)
    googleKey: localStorage.getItem('food_rec_google_key') || '',
    hotpepperKey: localStorage.getItem('food_rec_hotpepper_key') || '',
    amapKey: localStorage.getItem('food_rec_amap_key') || '',
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
      label: '当前位置',
      ready: false
    }
  };

  // 根据当前本地时间自动预设早/中/晚餐
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) {
    state.meal = 'breakfast';
  } else if (hour >= 10 && hour < 16) {
    state.meal = 'lunch';
  } else {
    state.meal = 'dinner';
  }

  // DOM 引用
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

  // 弹窗 DOM（点击按钮后在本页弹出，绝不跳转外网）
  const recipeModal = document.getElementById('recipeModal');
  const modalEmoji = document.getElementById('modalEmoji');
  const modalDishName = document.getElementById('modalDishName');
  const modalTags = document.getElementById('modalTags');
  const modalBody = document.getElementById('modalBody');
  const modalFooter = document.getElementById('modalFooter');
  const btnCloseModal = document.getElementById('btnCloseModal');

  // 数据源设置弹窗 DOM
  const sourceModal = document.getElementById('sourceModal');
  const sourceStatusBadge = document.getElementById('sourceStatusBadge');
  const googleKeyInput = document.getElementById('googleKeyInput');
  const hotpepperKeyInput = document.getElementById('hotpepperKeyInput');
  const amapKeyInput = document.getElementById('amapKeyInput');
  const btnCloseSourceModal = document.getElementById('btnCloseSourceModal');
  const btnSaveSource = document.getElementById('btnSaveSource');
  const btnResetSource = document.getElementById('btnResetSource');

  // 离线习惯画像 & 在线AI分析弹窗 DOM
  const tasteModal = document.getElementById('tasteModal');
  const tasteModalBody = document.getElementById('tasteModalBody');
  const tasteCountBadge = document.getElementById('tasteCountBadge');
  const btnCloseTasteModal = document.getElementById('btnCloseTasteModal');
  const btnExportTaste = document.getElementById('btnExportTaste');
  const btnImportTaste = document.getElementById('btnImportTaste');
  const btnClearTaste = document.getElementById('btnClearTaste');
  const tasteImportFile = document.getElementById('tasteImportFile');

  // 保存原始菜系按钮文本
  const cuisineBaseLabels = new Map();
  cuisineGroup.querySelectorAll('.cuisine-chip').forEach(btn => {
    cuisineBaseLabels.set(btn.dataset.cuisine, btn.textContent.trim());
  });

  // Toast 提示
  const toastEl = document.createElement('div');
  toastEl.className = 'copy-toast';
  document.body.appendChild(toastEl);
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // =========================================================================
  // 1. 多波次礼花烟花 + 美食Emoji彩带 + 聚能火星粒子系统 (60fps Canvas)
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
    if (!animFrameId) {
      renderParticles();
    }
  }

  // 转动期间环绕老虎机的上升聚能火星
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

  // 定格高光：三波次全屏狂欢特效（中心星爆 + 获奖Emoji飞舞 + 左右礼花加农炮）
  function triggerJackpotFireworks(winnerEmoji) {
    const rect = slotWindow.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colors = ['#fde047', '#fb923c', '#ff5722', '#ec4899', '#38bdf8', '#4ade80', '#ffffff'];

    // Wave 1: 中心超级星爆彩带与闪星 (64枚)
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

    // Wave 1B: 获奖美食专属 Emoji 欢乐飞溅 (8枚)
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

    // Wave 2 (延迟 200ms): 左右两侧礼花加农炮交叉喷射！
    setTimeout(() => {
      const fRect = slotFrame.getBoundingClientRect();
      const leftX = fRect.left + 12;
      const rightX = fRect.right - 12;
      const cannonY = fRect.bottom - 18;

      for (let i = 0; i < 28; i++) {
        // 左炮向右上方发射
        const aL = -Math.PI * 0.22 - Math.random() * 0.45;
        const spL = 7 + Math.random() * 6.5;
        particles.push({
          kind: i % 3 === 0 ? 'star' : 'ribbon',
          x: leftX,
          y: cannonY,
          vx: Math.cos(aL) * spL,
          vy: Math.sin(aL) * spL,
          size: 4.5 + Math.random() * 5,
          color: colors[i % colors.length],
          rotation: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 0.3,
          gravity: 0.22,
          drag: 0.982,
          alpha: 1,
          decay: 0.012 + Math.random() * 0.008
        });

        // 右炮向左上方发射
        const aR = -Math.PI * 0.78 + Math.random() * 0.45;
        const spR = 7 + Math.random() * 6.5;
        particles.push({
          kind: i % 3 === 0 ? 'star' : 'ribbon',
          x: rightX,
          y: cannonY,
          vx: Math.cos(aR) * spR,
          vy: Math.sin(aR) * spR,
          size: 4.5 + Math.random() * 5,
          color: colors[(i + 2) % colors.length],
          rotation: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 0.3,
          gravity: 0.22,
          drag: 0.982,
          alpha: 1,
          decay: 0.012 + Math.random() * 0.008
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

    if (particles.length > 0) {
      animFrameId = requestAnimationFrame(renderParticles);
    } else {
      animFrameId = null;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  // =========================================================================
  // 2. Web Audio API 街机抽卡音效（蓄力升调 + 物理棘轮 + 大和弦胜利号角）
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

  // 街机大奖多声部胜利和弦（浑厚低音脉冲 + 明亮大九和弦钟声琶音）
  function playJackpotFanfare() {
    try {
      const ac = getAudioCtx();
      const now = ac.currentTime;

      // 低音冲击脉冲
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

      // 璀璨大九和弦上行琶音 (C5 - E5 - G5 - B5 - C6 - E6)
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
  // 2.5. 离线饮食习惯持久化引擎 (localStorage) + 个性化「猜你喜欢」推荐算法
  // =========================================================================
  const TASTE_STORAGE_KEY = 'food_rec_taste_v1';
  const AI_CFG_STORAGE_KEY = 'food_rec_ai_cfg_v1';

  const FLAVOR_DIMENSIONS = [
    { key: '麻辣鲜香', regex: /(麻|辣|川|湘|剁椒|水煮|麻辣|红油|泡椒|藤椒|酸辣|香锅|火锅|冒菜|担担|口水)/ },
    { key: '鲜美清淡', regex: /(清蒸|白灼|清淡|鲜美|粤|港|菌菇|汤|粥|肠粉|云吞|青菜|豆腐|冬瓜|养胃|蒸蛋|清炖)/ },
    { key: '酸甜开胃', regex: /(酸甜|糖醋|番茄|西红柿|柠檬|酸汤|菠萝|咕噜|鱼香|茄汁|话梅|酸菜)/ },
    { key: '咸香下饭', regex: /(红烧|酱爆|干煸|小炒|盖饭|盖浇|卤|焖|回锅|宫保|木桶|把子肉|黄焖|鱼香|肉末|下饭)/ },
    { key: '日韩异域', regex: /(日|韩|寿司|拉面|丼|咖喱|寿喜|烤肉|石锅|炸鸡|意面|牛排|披萨|汉堡|泰|冬阴功|ラーメン|焼肉)/ },
    { key: '面食碳水', regex: /(面|粉|饺|馄饨|抄手|包|饼|馒头|炒饭|煲仔饭|米线|螺蛳粉|乌冬|拉面|うどん|そば)/ },
    { key: '快手省心', regex: /(电饭煲|空气炸锅|微波炉|懒人|快手|一锅|三明治|吐司|燕麦|凉拌|速冻|10分钟)/ },
    { key: '炙烤解馋', regex: /(烤|炸|串|烧烤|鸡翅|鸡排|排骨|猪蹄|羊排|锅包肉|铁板|とんかつ|焼肉)/ }
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
      recentHistory: [],
      aiAnalysisText: '',
      aiAnalysisTime: ''
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
    return matched.length > 0 ? matched : ['咸香下饭'];
  }

  function bumpScoreMap(map, key, delta) {
    if (!key || key === 'all' || key === 'AI精选') return;
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
      const { item } = payload;
      bumpScoreMap(tasteProfile.cuisineScores, item.cuisine, 2.5);
      extractItemFlavors(item).forEach(f => bumpScoreMap(tasteProfile.flavorScores, f, 2));
    } else if (signalType === 'copy' && payload?.item) {
      const { item } = payload;
      bumpScoreMap(tasteProfile.cuisineScores, item.cuisine, 3.5);
      extractItemFlavors(item).forEach(f => bumpScoreMap(tasteProfile.flavorScores, f, 2.5));
    } else if (signalType === 'like' && payload?.item) {
      const { item } = payload;
      const already = isItemLiked(item.name);
      tasteProfile.dislikedItems = tasteProfile.dislikedItems.filter(x => x.name !== item.name);
      if (already) {
        tasteProfile.likedItems = tasteProfile.likedItems.filter(x => x.name !== item.name);
        bumpScoreMap(tasteProfile.cuisineScores, item.cuisine, -4);
      } else {
        tasteProfile.likedItems = [
          { name: item.name, cuisine: item.cuisine, tag: item.tag || '', emoji: item.emoji || '🥘', ts: now },
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
    if (isItemDisliked(item.name)) {
      return { rawScore: -999, pct: 30, reason: '已标记不太想吃' };
    }

    const now = Date.now();
    const topCuisines = getTopEntries(tasteProfile.cuisineScores, 10);
    const maxCuisineScore = topCuisines[0]?.[1] || 1;
    const topFlavors = getTopEntries(tasteProfile.flavorScores, 8);
    const maxFlavorScore = topFlavors[0]?.[1] || 1;
    const hasHistory = tasteProfile.totalInteractions >= 3;

    let raw = 50;
    let bestReason = '';

    // 1. 菜系偏好分 (0 ~ 28)
    const cScore = tasteProfile.cuisineScores[item.cuisine] || 0;
    if (hasHistory && cScore > 0) {
      const cBoost = Math.min(28, (cScore / maxCuisineScore) * 28);
      raw += cBoost;
      if (cBoost >= 14) bestReason = `你常吃${item.cuisine}`;
    } else if (cScore < 0) {
      raw += Math.max(-18, cScore * 1.5);
    }

    // 2. 风味维度分 (0 ~ 20)
    const flavors = extractItemFlavors(item);
    let flavorBoost = 0;
    let topMatchedFlavor = '';
    for (const f of flavors) {
      const fs = tasteProfile.flavorScores[f] || 0;
      if (hasHistory && fs > 0) {
        const contribution = (fs / maxFlavorScore) * 14;
        if (contribution > flavorBoost) {
          flavorBoost = contribution;
          topMatchedFlavor = f;
        }
      }
    }
    raw += Math.min(20, flavorBoost);
    if (!bestReason && topMatchedFlavor) bestReason = `契合「${topMatchedFlavor}」口味`;

    // 3. 显式收藏加权 & 同菜系相似加权
    if (isItemLiked(item.name)) {
      raw += 16;
      bestReason = '你的心头好收藏';
    }

    // 4. 模式习惯加权（例如用户偏好懒人或外卖）
    const totalModes = Object.values(tasteProfile.modeCounts).reduce((a, b) => a + b, 0);
    if (totalModes >= 4) {
      const lazyRatio = (tasteProfile.modeCounts.lazy || 0) / totalModes;
      const takeoutRatio = (tasteProfile.modeCounts.takeout || 0) / totalModes;
      if (lazyRatio >= 0.35 && item.modes?.includes('lazy')) raw += 8;
      if (takeoutRatio >= 0.35 && item.isRealShop) raw += 8;
    }

    // 5. 高品质加分（AI精选 / 高评分真实店铺）
    if (item.aiPick) {
      raw += 9;
      if (!bestReason) bestReason = 'AI口碑精选';
    }
    if (item.isRealShop && item.rating && parseFloat(item.rating) >= 4.2) {
      raw += 10;
      if (!bestReason) bestReason = `高分周边好店 ★${item.rating}`;
    }

    // 6. 近期吃过防腻冷却（24小时内抽过的适当降权，避免天天重复）
    const recentEntry = tasteProfile.recentHistory.find(h => h.name === item.name && now - h.ts < 24 * 3600 * 1000);
    if (recentEntry) {
      raw -= 22;
    }

    // 7. 餐段精准匹配
    if (item.meals?.includes(state.meal)) raw += 6;

    const pct = Math.max(68, Math.min(99, Math.round(raw)));
    return {
      rawScore: raw,
      pct,
      reason: bestReason || (hasHistory ? '综合口味智能匹配' : '冷启动高口碑精选')
    };
  }

  function updateGuessStatusSummary() {
    if (!guessStatusText) return;
    const topC = getTopEntries(tasteProfile.cuisineScores, 2).map(x => x[0]);
    const topF = getTopEntries(tasteProfile.flavorScores, 2).map(x => x[0]);
    if (tasteProfile.totalInteractions < 3) {
      guessStatusText.textContent = '猜你喜欢 · 离线学习中（多点几次抽卡或 👍/👎 会越来越懂你）';
    } else {
      const prefText = [...topC, ...topF].slice(0, 3).join(' · ') || '多元风味';
      guessStatusText.textContent = `本地画像已就绪（${tasteProfile.totalDraws}次记录）· 偏爱：${prefText}`;
    }
  }

  // =========================================================================
  // 3. 周边真实店铺智能自动菜系分类器 & 多引擎全球/日本/中国周边扫描
  // =========================================================================
  const shopCuisineClassifier = [
    {
      cuisine: '欧美西餐',
      emoji: '🍔',
      tag: '西式简餐',
      combos: ['经典汉堡薯条可乐套餐', '意式肉酱面+烤翅套餐', '牛排轻食能量碗单人餐'],
      regex: /(麦当劳|肯德基|KFC|McDonald|マクドナルド|モスバーガー|ケンタッキー|ハンバーガー|汉堡王|Burger|赛百味|Subway|必胜客|Pizza|ピザ|ピッツァ|达美乐|尊宝|乐凯撒|萨莉亚|Saizeriya|サイゼリヤ|ガスト|ジョナサン|デニーズ|ロイヤルホスト|蓝蛙|Blue Frog|Wagas|沃歌斯|塔斯汀|德克士|Dicos|华莱士|棒约翰|Papa John|西餐|洋食|イタリアン|フレンチ|パスタ|ステーキ|牛排|Steak|意面|Pasta|披萨|比萨|汉堡|三明治|Sandwich|轻食|沙拉|Salad|波奇|墨西哥|Taco|西班牙|法餐|法式|意式|俄式|德式|Paulaner|Hooters|米氏|Brunch|贝果|可颂|西点|烘焙|面包|ベーカリー)/i
    },
    {
      cuisine: '日韩亚太',
      emoji: '🍣',
      tag: '日韩亚太',
      combos: ['温泉蛋肥牛丼+味增汤套餐', '石锅拌饭/韩式炸鸡双拼', '豚骨拉面/冬阴功单人餐'],
      regex: /(吉野家|食其家|すき家|松屋|なか卯|味千|一风堂|一兰|一蘭|天下一品|幸楽苑|丸亀製麺|はなまる|スシロー|くら寿司|はま寿司|かっぱ寿司|CoCo壱|ココイチ|大戸屋|やよい軒|かつや|和幸|てんや|鳥貴族|磯丸水産|寿司|すし|鮨|Sushi|刺身|日料|日本料理|和食|居酒屋|焼鳥|焼き鳥|烧鸟|寿喜|しゃぶ|すき焼き|乌冬|うどん|そば|蕎麦|拉面|ラーメン|らーめん|つけ麺|油そば|とんかつ|トンカツ|牛丼|親子丼|海鮮丼|定食|天ぷら|お好み焼き|たこ焼き|もんじゃ|鳗鱼|うなぎ|天妇罗|和牛|焼肉|ホルモン|丼|beef_bowl|japanese|韩|韩国|韩式|韓国|サムギョプサル|スンドゥブ|烤肉|石锅|拌饭|部队锅|炸鸡|紫菜包饭|冷面|朝鲜|延边|korean|泰|泰国|タイ|冬阴功|越南|ベトナム|フォー|河粉|新加坡|海南鸡|肉骨茶|东南亚|印度|インド|ネパール|カレー|咖喱|thai|vietnamese|indian|asian)/i
    },
    {
      cuisine: '川渝菜',
      emoji: '🌶️',
      tag: '麻辣川渝',
      combos: ['招牌川味双拼工作餐', '酸菜鱼/冒菜单人豪华套餐', '重庆小面/红油抄手套餐'],
      regex: /(川|蜀|渝|重庆|成都|四川|麻婆|担々麺|麻辣|sichuan|海底捞|太二|鱼你在一起|乡村基|大米先生|冒菜|三顾冒菜|串串|钵钵鸡|麻辣烫|杨国福|张亮|麻辣香锅|酸菜鱼|水煮鱼|烤鱼|万州|毛血旺|担担面|小面|豌杂|抄手|酸辣粉|锅盔|锅魁|兔|跷脚牛肉|蹄花|自贡|乐山|宜宾|绵阳|干锅|牛蛙|蛙来哒|辣子鸡|回锅肉|火锅|hotpot)/i
    },
    {
      cuisine: '粤港澳',
      emoji: '🦐',
      tag: '粤港风味',
      combos: ['烧腊双拼饭+老火例汤', '广式肠粉/云吞面套餐', '隆江猪脚饭/腊味煲仔饭'],
      regex: /(粤|广|港|広東|香港|飲茶|点心|茶餐厅|烧腊|烧鹅|烧鸭|叉烧|白切鸡|猪脚饭|隆江|煲仔饭|肠粉|早茶|点都德|陶陶居|翠华|太兴|避风塘|云吞|竹升面|潮汕|潮州|牛肉火锅|砂锅粥|顺德|客家|啫啫|猪肚鸡|海鲜|cantonese|hongkong|dim_sum|seafood)/i
    },
    {
      cuisine: '湘鄂赣',
      emoji: '🔥',
      tag: '香辣下饭',
      combos: ['现炒辣椒炒肉木桶饭', '热干面/长沙米粉套餐', '南昌拌粉+瓦罐汤套餐'],
      regex: /(湘|湖南|长沙|费大厨|炊烟|兰湘子|蛙来哒|剁椒|擂辣椒|小炒黄牛肉|盖码饭|木桶饭|湘西|土家|滴水洞|武汉|湖北|热干面|蔡林记|豆皮|荆州|潜江|小龙虾|藕汤|赣|江西|南昌|拌粉|瓦罐汤|徽|臭鳜鱼|hunan)/i
    },
    {
      cuisine: '江浙沪',
      emoji: '🦀',
      tag: '江南本帮',
      combos: ['生煎/小笼包+牛肉粉丝汤', '本帮红烧肉/菜饭骨头汤', '苏式汤面/鸭血粉丝套餐'],
      regex: /(沪|上海|本帮|苏|苏州|杭州|杭帮|浙|宁波|无锡|扬州|淮扬|南京|金陵|镇江|大壶春|小杨生煎|德兴馆|小南国|南翔|绿波廊|新白鹿|外婆家|绿茶|老盛昌|生煎|小笼|小籠包|锅贴|馄饨|吉祥馄饨|如意馄饨|菜饭|葱油拌面|片儿川|奥灶面|锅盖面|鸭血粉丝|盐水鸭|狮子头|东坡肉|黄鱼面|粢饭团|shanghai)/i
    },
    {
      cuisine: '东北鲁菜',
      emoji: '🥟',
      tag: '北方硬菜',
      combos: ['东北水饺/锅包肉双拼盒饭', '黄焖鸡/把子肉米饭套餐', '老北京炸酱面/煎饼套餐'],
      regex: /(东北|哈尔滨|沈阳|长春|大连|鲁|山东|青岛|济南|京|北京|老北京|燕云楼|全聚德|便宜坊|护国寺|天津|狗不理|喜家德|东方饺子王|饺子|餃子|王将|日高屋|水饺|dumpling|黄焖鸡|杨铭宇|把子肉|超意兴|锅包肉|铁锅炖|酱大骨|烧烤|烤串|淄博|烤冷面|煎饼|炸酱面|卤煮|铜锅涮肉|烤鸭|peking|beijing|shandong)/i
    },
    {
      cuisine: '西北晋豫',
      emoji: '🍜',
      tag: '西北面食',
      combos: ['兰州拉面/刀削面+卤蛋套餐', '肉夹馍+凉皮三秦套餐', '新疆大盘鸡/羊肉串套餐'],
      regex: /(西北|陕西|西安|三秦|西贝|兰州|蘭州|牛肉面|马记永|陈香贵|张拉拉|肉夹馍|凉皮|擀面皮|油泼面|biang|臊子面|泡馍|山西|刀削面|刀削麺|过油肉|莜面|河南|郑州|洛阳|开封|胡辣汤|方中山|烩面|水煎包|新疆|大盘鸡|手抓饭|羊肉串|烤馕|清真|羊肉汤|羊汤|宁夏|青海|甘肃)/i
    },
    {
      cuisine: '云贵桂闽',
      emoji: '🍲',
      tag: '云贵桂闽',
      combos: ['过桥/小锅米线单人套餐', '柳州螺蛳粉/桂林米粉套餐', '沙县拌面扁肉/酸汤鱼套餐'],
      regex: /(云|云南|昆明|大理|丽江|过桥米线|小锅米线|米线|汽锅鸡|菌菇|贵|贵州|贵阳|遵义|凯里|酸汤鱼|牛肉粉|花溪|桂|广西|桂林|米粉|柳州|螺蛳粉|南宁|老友粉|闽|福建|厦门|泉州|福州|沙县|扁肉|沙茶面|面线糊|姜母鸭|海蛎煎|海南|椰子鸡|文昌鸡|台湾|魯肉飯|yunnan)/i
    }
  ];

  function classifyNearbyShop(rawShop) {
    const combined = `${rawShop.name} ${rawShop.rawCuisine || ''} ${rawShop.rawType || ''} ${rawShop.brand || ''}`;
    let matchedCuisine = '家常中菜';
    let emoji = '🥘';
    let tag = '周边实店';
    let combos = ['招牌双拼工作餐', '单人热销盖浇饭/面食套餐', '门店精选必点一人食'];

    for (const rule of shopCuisineClassifier) {
      if (rule.regex.test(combined)) {
        matchedCuisine = rule.cuisine;
        emoji = rule.emoji;
        tag = rule.tag;
        combos = rule.combos;
        break;
      }
    }

    if (matchedCuisine === '家常中菜') {
      if (/(中華|バーミヤン|中国料理|中華料理|chinese)/i.test(combined)) {
        emoji = '🥟';
        tag = '中华料理';
        combos = ['回锅肉/青椒肉丝定食', '煎饺+炒饭中华套餐'];
      } else if (/(粥|豆浆|油条|包子|早餐|早点|馒头|饼)/.test(rawShop.name)) {
        emoji = '🥣';
        tag = '早点粥铺';
        combos = ['招牌暖胃粥+小笼/肉包套餐', '现磨豆浆+手工煎饼/油条'];
      } else if (/(面|粉|饺|馄饨)/.test(rawShop.name)) {
        emoji = '🍜';
        tag = '面食小吃';
        combos = ['招牌浇头面+虎皮卤蛋套餐', '手工现包饺子/馄饨套餐'];
      } else if (/(老乡鸡|真功夫|永和大王|东方既白|快餐|便当|弁当|盖饭|米饭)/.test(rawShop.name)) {
        emoji = '🍱';
        tag = '中式快餐';
        combos = ['两荤一素招牌工作便当', '炖鸡/红烧肉双拼盖饭+例汤'];
      } else if (/(烧烤|烤肉|串|龙虾)/.test(rawShop.name)) {
        emoji = '🍢';
        tag = '烧烤夜宵';
        combos = ['炭火烤肉串+烤鸡翅夜宵餐', '招牌炒饭+凉菜烤串组合'];
      } else if (/(鸡|鸭|鹅|排骨)/.test(rawShop.name)) {
        emoji = '🍗';
        tag = '肉食盖饭';
        combos = ['招牌鸡腿/排骨饭+时蔬例汤'];
      }
    }

    const isBreakfastFriendly = /(早|粥|包|豆浆|油条|肠粉|早茶|点心|生煎|小笼|锅贴|煎饼|灌饼|手抓饼|馄饨|云吞|抄手|面|粉|米线|胡辣汤|豆皮|烧麦|麦当劳|肯德基|KFC|McDonald|マクドナルド|モスバーガー|赛百味|Subway|永和大王|东方既白|德克士|吉野家|食其家|すき家|松屋|なか卯|ガスト|デニーズ|沙县|肉夹馍|三明治|贝果|可颂|烘焙|ベーカリー|fast_food|burger|sandwich|noodle)/i.test(combined);
    const isDinnerOnly = /(夜宵|宵夜|大排档|啤酒广场|烧烤|烤串|龙虾|居酒屋|鳥貴族|ホルモン)/i.test(rawShop.name);

    let meals = ['lunch', 'dinner'];
    if (isBreakfastFriendly) meals = ['breakfast', 'lunch', 'dinner'];
    else if (isDinnerOnly) meals = ['dinner'];

    const estDeliveryMin = Math.max(18, Math.min(55, Math.round(16 + (rawShop.distance || 500) / 140)));

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

  function isLikelyJapan(lat, lng, label) {
    if (/(日本|東京|大阪|京都|北海道|神奈川|埼玉|千葉|愛知|福岡|兵庫|県|府|八王子|渋谷|新宿|横浜|名古屋|札幌)/i.test(label || '')) {
      return true;
    }
    return lat >= 24 && lat <= 46 && lng >= 127.5 && lng <= 154;
  }

  // 引擎 A：Google Maps JavaScript API Places Library (全球 & 日本支持，无CORS限制，返回真实星级与评价数)
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
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=zh-CN&loading=async`;
      script.async = true;
      script.defer = true;
      const timer = setTimeout(() => reject(new Error('Google Maps SDK 加载超时')), 9000);
      script.onload = () => {
        clearTimeout(timer);
        loadedGoogleKey = apiKey;
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Google Maps SDK 加载失败，请检查 Key 或网络'));
      };
      document.head.appendChild(script);
    });
  }

  async function fetchDirectGooglePlaces(lat, lng, radius, apiKey) {
    await loadGoogleMapsSDK(apiKey);
    const { Place, SearchNearbyRankPreference } = await window.google.maps.importLibrary('places');
    const request = {
      fields: ['displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount', 'types', 'primaryTypeDisplayName', 'priceLevel', 'photos'],
      locationRestriction: {
        center: { lat, lng },
        radius: Math.min(Math.max(radius, 500), 5000)
      },
      includedPrimaryTypes: [
        'restaurant',
        'fast_food_restaurant',
        'ramen_restaurant',
        'sushi_restaurant',
        'japanese_restaurant',
        'chinese_restaurant',
        'korean_restaurant',
        'italian_restaurant',
        'hamburger_restaurant',
        'pizza_restaurant',
        'barbecue_restaurant',
        'meal_takeaway'
      ],
      maxResultCount: 20,
      rankPreference: SearchNearbyRankPreference ? SearchNearbyRankPreference.POPULARITY : 'POPULARITY'
    };

    const { places } = await Place.searchNearby(request);
    if (!Array.isArray(places) || places.length === 0) return [];

    const priceMap = {
      FREE: '免费',
      INEXPENSIVE: '平价实惠',
      MODERATE: '人均适中',
      EXPENSIVE: '轻奢品质',
      VERY_EXPENSIVE: '高端料理'
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
          address: p.formattedAddress || '周边商圈门店',
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

  // 引擎 B：日本 Hot Pepper Gourmet API（完全免费免绑卡，JSONP 直连无 CORS 限制）
  function fetchDirectHotPepperJSONP(lat, lng, radius, apiKey) {
    return new Promise((resolve, reject) => {
      const range = radius <= 500 ? 2 : radius <= 1000 ? 3 : radius <= 2000 ? 4 : 5;
      const cbName = `__hp_cb_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
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
        reject(new Error('Hot Pepper 请求超时'));
      }, 9000);

      window[cbName] = data => {
        cleanup();
        const rawList = data?.results?.shop;
        if (!Array.isArray(rawList)) {
          reject(new Error(data?.results?.error?.[0]?.message || 'Hot Pepper 返回为空'));
          return;
        }
        const shops = rawList
          .filter(s => s.name)
          .map(s => {
            const sLat = parseFloat(s.lat) || lat;
            const sLng = parseFloat(s.lng) || lng;
            return {
              name: String(s.name).trim(),
              address: s.address || s.station_name || '日本周边门店',
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
        reject(new Error('Hot Pepper JSONP 加载失败'));
      };
      script.src = `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?key=${encodeURIComponent(apiKey)}&lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&range=${range}&count=60&format=jsonp&callback=${cbName}`;
      document.head.appendChild(script);
    });
  }

  // 引擎 C：高德地图 POI 2.0（中国大陆支持CORS，含国内商户评分）
  async function fetchDirectAmap(lat, lng, radius, amapKey) {
    const shops = [];
    for (let page = 1; page <= 3; page++) {
      const url = `https://restapi.amap.com/v5/place/around?key=${encodeURIComponent(amapKey)}&location=${lng.toFixed(6)},${lat.toFixed(6)}&radius=${radius}&types=050000&page_size=25&page_num=${page}&show_fields=business`;
      const res = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
      const data = await res.json();
      if (data.status !== '1') {
        if (page === 1) throw new Error(data.info || '高德Key校验失败');
        break;
      }
      const pois = data.pois || [];
      for (const p of pois) {
        if (!p.name) continue;
        const [pLng, pLat] = (p.location || '').split(',').map(Number);
        const dist = p.distance ? Number(p.distance) : haversineMeters(lat, lng, pLat || lat, pLng || lng);
        shops.push({
          name: p.name.trim(),
          address: p.address || p.adname || '',
          distance: dist,
          rawType: p.type || '',
          rawCuisine: p.business?.tag || p.type || '',
          rating: p.business?.rating || '',
          cost: p.business?.cost || '',
          openTime: p.business?.opentime_today || '',
          lat: pLat || lat,
          lng: pLng || lng,
          source: 'amap'
        });
      }
      if (pois.length < 25) break;
    }
    return shops;
  }

  // 引擎 D：OpenStreetMap Overpass 免费公网多节点兜底（带 7 秒超时，防止东京/全球卡死）
  async function fetchDirectOverpass(lat, lng, radius) {
    const radiusKm = Math.max(0.5, Math.min(5, radius / 1000));
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
    const bbox = `${(lat - dLat).toFixed(4)},${(lng - dLng).toFixed(4)},${(lat + dLat).toFixed(4)},${(lng + dLng).toFixed(4)}`;
    const q = `[out:json][timeout:6];node["amenity"~"restaurant|fast_food"](${bbox});out 140;`;
    const skipDrinkRegex = /(奶茶|茶饮|一点点|1点点|喜茶|奈雪|蜜雪冰城|霸王茶姬|茶百道|古茗|沪上阿姨|瑞幸|星巴克|Starbucks|スターバックス|ドトール|タリーズ|Costa|咖啡|Coffee|Cafe|カフェ|喫茶|甜品|满记|许留山|冰淇淋|雪糕|DQ|哈根达斯|酒吧|酒馆|Bar|Pub|KTV)/i;

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
    if (!data) throw new Error('OSM 公共接口繁忙超时');

    const seen = new Set();
    const shops = [];
    for (const el of data.elements || []) {
      const tags = el.tags || {};
      const name = (tags['name:zh'] || tags.name || tags['name:ja'] || tags['name:en'] || '').trim();
      if (!name || name.length < 2 || skipDrinkRegex.test(name)) continue;
      if (/(bubble_tea|coffee_shop|ice_cream|tea)/i.test(tags.cuisine || '')) continue;
      const dist = haversineMeters(lat, lng, el.lat, el.lon);
      if (dist > radius) continue;
      const key = `${name}_${Math.round(dist / 200)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const addr = [tags['addr:district'] || tags['addr:suburb'], tags['addr:street'] || tags['addr:road'], tags['addr:housenumber']].filter(Boolean).join(' ');
      shops.push({
        name,
        address: addr || '周边商圈门店',
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

  function matchStaticCitySnapshot(lat, lng, radius, cityLabel) {
    const citySnapshots = window.CITY_SHOPS_DATA || {};
    const matchedKey = Object.keys(citySnapshots).find(k => cityLabel.includes(k) || cityLabel.includes(k.replace('市', '')));
    if (!matchedKey || !Array.isArray(citySnapshots[matchedKey])) return [];

    return citySnapshots[matchedKey]
      .map(s => ({
        ...s,
        distance: haversineMeters(lat, lng, s.lat, s.lng)
      }))
      .filter(s => s.distance <= radius)
      .sort((a, b) => a.distance - b.distance);
  }

  async function scanNearbyShops(force = false) {
    if (!state.location.lat || !state.location.lng) return;
    const keySig = `${state.googleKey ? 'g' : ''}${state.hotpepperKey ? 'h' : ''}${state.amapKey ? 'a' : ''}` || 'free';
    const scanKey = `${state.location.lat.toFixed(3)}_${state.location.lng.toFixed(3)}_${state.radius}_${keySig}`;
    if (!force && state.nearbyScannedKey === scanKey && state.nearbyShops.length > 0) {
      return;
    }

    state.nearbyLoading = true;
    locDot.classList.add('loading');
    locText.textContent = `正在扫描 ${state.location.label} ${state.radius / 1000}km 内餐饮店...`;

    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const inJapan = isLikelyJapan(state.location.lat, state.location.lng, state.location.label);

    try {
      let rawShops = [];
      let source = 'osm';

      // 优先级 1：Google Maps Places JS API（全球/日本带真实星级评价）
      if (state.googleKey) {
        try {
          rawShops = await fetchDirectGooglePlaces(state.location.lat, state.location.lng, state.radius, state.googleKey);
          source = 'google';
        } catch (gErr) {
          showToast(`⚠️ Google Places: ${gErr.message || '调用失败，尝试备用源'}`);
        }
      }

      // 优先级 2：日本区域且配置了免费 Hot Pepper Gourmet Key（JSONP 直连）
      if (rawShops.length === 0 && state.hotpepperKey && inJapan) {
        try {
          rawShops = await fetchDirectHotPepperJSONP(state.location.lat, state.location.lng, state.radius, state.hotpepperKey);
          source = 'hotpepper';
        } catch (hErr) {
          showToast(`⚠️ Hot Pepper: ${hErr.message || '调用失败'}`);
        }
      }

      // 优先级 3：高德 POI 2.0（中国大陆带真实商户评分）
      if (rawShops.length === 0 && state.amapKey && !inJapan) {
        try {
          rawShops = await fetchDirectAmap(state.location.lat, state.location.lng, state.radius, state.amapKey);
          source = 'amap';
        } catch (aErr) {
          showToast(`⚠️ 高德 API: ${aErr.message || '调用失败'}`);
        }
      }

      // 优先级 4：本地代理 / 免费国内快照 / 免费 Overpass 公网超时保护扫描
      if (rawShops.length === 0) {
        if (isLocalhost) {
          try {
            const apiUrl = `/api/nearby?lat=${state.location.lat}&lng=${state.location.lng}&radius=${state.radius}`;
            const res = await fetch(apiUrl, { signal: AbortSignal.timeout ? AbortSignal.timeout(7000) : undefined });
            const data = await res.json();
            if (data.ok && Array.isArray(data.shops)) {
              rawShops = data.shops;
              source = data.source || 'osm';
            }
          } catch (_) {}
        }

        if (rawShops.length === 0) {
          const snapshot = matchStaticCitySnapshot(state.location.lat, state.location.lng, state.radius, state.location.label || state.location.city || '');
          if (snapshot.length > 0) {
            rawShops = snapshot;
            source = 'osm';
          } else {
            rawShops = await fetchDirectOverpass(state.location.lat, state.location.lng, state.radius);
            source = 'osm';
          }
        }
      }

      if (rawShops.length > 0) {
        state.nearbyShops = rawShops.map(classifyNearbyShop);
        state.nearbySource = source;
        state.nearbyScannedKey = scanKey;
        locDot.classList.remove('loading');
        const srcNameMap = {
          google: 'Google星级实店',
          hotpepper: 'HotPepper日本实店',
          amap: '高德评分实店',
          osm: 'OSM周边实店'
        };
        locText.textContent = `${state.location.label} · 发现 ${state.nearbyShops.length} 家${srcNameMap[source] || '周边实店'}`;
      } else {
        throw new Error('当前范围暂无扫描到实店');
      }
    } catch (_) {
      const fallbackSnap = matchStaticCitySnapshot(state.location.lat, state.location.lng, state.radius, state.location.label || state.location.city || '');
      locDot.classList.remove('loading');
      if (fallbackSnap.length > 0) {
        state.nearbyShops = fallbackSnap.map(classifyNearbyShop);
        state.nearbySource = 'osm';
        state.nearbyScannedKey = scanKey;
        locText.textContent = `${state.location.label} · 发现 ${state.nearbyShops.length} 家周边实店`;
      } else {
        locText.textContent = `${state.location.label} · 已启用外卖套餐库（点 ⚙️ 可配 Google/HotPepper 看实店星级）`;
        state.nearbyShops = [];
      }
    } finally {
      state.nearbyLoading = false;
      syncUI();
    }
  }

  // =========================================================================
  // 4. 候选池计算 & 菜系角标 & 数字滚动
  // =========================================================================
  // 精选高口碑周边品牌/老字号匹配规则（点外卖+AI精选时优先筛选周边优质实店）
  const aiTopShopRegex = /(大壶春|德兴馆|小南国|鼎泰丰|费大厨|太二|海底捞|点都德|陶陶居|外婆家|新白鹿|小杨生煎|老乡鸡|乡村基|喜家德|西贝|陈香贵|马记永|吉野家|食其家|味千|蓝蛙|Wagas|萨莉亚|必胜客|汉堡王|麦当劳|肯德基|全聚德|燕云楼|蔡林记|方中山|老字号|旗舰店|招牌|烧烤|火锅|川菜|粤菜|茶餐厅|拉面|寿司|生煎|小笼)/i;

  function getGuessPool() {
    const candidates = [];
    const seen = new Set();

    const pushIfValid = item => {
      if (!item || !item.name || seen.has(item.name)) return;
      if (state.cuisine !== 'all' && state.cuisine !== 'AI精选' && item.cuisine !== state.cuisine) return;
      if (state.cuisine === 'AI精选' && !item.aiPick && !(item.isRealShop && item.rating && parseFloat(item.rating) >= 4.2)) return;
      seen.add(item.name);
      candidates.push(item);
    };

    // 优先纳入当前餐段的家常菜/懒人菜
    for (const d of staticDishes) {
      if (d.meals?.includes(state.meal) && (d.modes?.includes('cook') || d.modes?.includes('lazy'))) {
        pushIfValid(d);
      }
    }
    // 如果已经扫到了周边真实店铺，也纳入猜你喜欢混合池
    for (const s of state.nearbyShops) {
      if (s.meals?.includes(state.meal)) {
        pushIfValid(s);
      }
    }

    // 过滤已拉黑菜品并计算契合度
    let scored = candidates
      .filter(item => !isItemDisliked(item.name))
      .map(item => {
        const match = computePersonalizedMatch(item);
        return {
          ...item,
          _matchPct: match.pct,
          _matchReason: match.reason,
          _rawScore: match.rawScore
        };
      })
      .sort((a, b) => b._rawScore - a._rawScore);

    if (scored.length === 0) {
      scored = staticDishes
        .filter(d => d.meals?.includes(state.meal))
        .slice(0, 30)
        .map(d => ({ ...d, _matchPct: 84, _matchReason: '经典人气推荐', _rawScore: 84 }));
    }

    return scored.slice(0, 48);
  }

  function getFilteredPool() {
    if (state.mode === 'guess') {
      return getGuessPool();
    }

    if (state.mode === 'takeout' && state.nearbyShops.length > 0) {
      if (state.cuisine === 'AI精选') {
        const aiShops = state.nearbyShops.filter(s => s.meals.includes(state.meal) && (aiTopShopRegex.test(s.name) || (s.rating && parseFloat(s.rating) >= 4.2)));
        if (aiShops.length > 0) return aiShops;
        return state.nearbyShops.slice(0, 20);
      }

      const realMatches = state.nearbyShops.filter(s => {
        const mealMatch = s.meals.includes(state.meal);
        const cuisineMatch = state.cuisine === 'all' || s.cuisine === state.cuisine;
        return mealMatch && cuisineMatch;
      });
      if (realMatches.length > 0) return realMatches;
      const relaxedReal = state.nearbyShops.filter(s => state.cuisine === 'all' || s.cuisine === state.cuisine);
      if (relaxedReal.length > 0) return relaxedReal;
    }

    // 自己做 / 懒人专区 / 无实店外卖兜底
    if (state.cuisine === 'AI精选') {
      const exactAi = staticDishes.filter(d => d.aiPick && d.meals.includes(state.meal) && d.modes.includes(state.mode));
      if (exactAi.length > 0) return exactAi;
      const relaxedAi = staticDishes.filter(d => d.aiPick && d.modes.includes(state.mode));
      if (relaxedAi.length > 0) return relaxedAi;
    }

    return staticDishes.filter(d => {
      const mealMatch = d.meals.includes(state.meal);
      const modeMatch = d.modes.includes(state.mode);
      const cuisineMatch = state.cuisine === 'all' || state.cuisine === 'AI精选' || d.cuisine === state.cuisine;
      return mealMatch && modeMatch && cuisineMatch;
    });
  }

  function updateCuisineChipCounts() {
    const showRealCounts = state.mode === 'takeout' && state.nearbyShops.length > 0;
    cuisineGroup.querySelectorAll('.cuisine-chip').forEach(btn => {
      const c = btn.dataset.cuisine;
      const baseLabel = cuisineBaseLabels.get(c) || btn.textContent;
      if (showRealCounts) {
        let cnt = 0;
        if (c === 'all') cnt = state.nearbyShops.length;
        else if (c === 'AI精选') cnt = state.nearbyShops.filter(s => aiTopShopRegex.test(s.name) || (s.rating && parseFloat(s.rating) >= 4.2)).length || Math.min(20, state.nearbyShops.length);
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
    const unit = isRealTakeout ? '家实店' : (state.mode === 'guess' ? '道精选' : '道');

    poolCountEl.innerHTML = `候选 <b id="poolCountNum">${startCount}</b> ${unit}`;
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
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startCount + (targetCount - startCount) * eased);
      const liveNumEl = document.getElementById('poolCountNum');
      if (liveNumEl) liveNumEl.textContent = current;
      state.displayedPoolCount = current;
      if (progress < 1) {
        countAnimId = requestAnimationFrame(tick);
      }
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
    // 同步昼夜主题配色与背景太阳/月亮旋转轨道角度（早餐=晨曦东升 / 午餐=晴空正顶 / 晚餐=暮色西落+星月）
    document.body.dataset.theme = state.meal;
    if (mealSkyHint) {
      const skyHintMap = {
        breakfast: '🌅 晨曦破晓',
        lunch: '☀️ 正午晴空',
        dinner: '🌙 暮色星河'
      };
      mealSkyHint.textContent = skyHintMap[state.meal] || '🌅 晨曦破晓';
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

    if (state.mode === 'takeout') {
      if (state.location.ready && !state.nearbyLoading && state.nearbyShops.length === 0 && !state.nearbyScannedKey) {
        scanNearbyShops();
      }
    }

    updateCuisineChipCounts();
    const pool = getFilteredPool();
    animatePoolCount(pool.length);

    if (!state.currentDish && !state.isSpinning) {
      if (state.mode === 'cook') {
        dockIdleText.textContent = '选好条件点击「开始抽卡」，抽中后可弹窗看图文食谱与本土平替';
      } else if (state.mode === 'lazy') {
        dockIdleText.textContent = '⚡ 懒人专区已就绪（电饭煲/空气炸锅/10分钟快手），点击开抽！';
      } else if (state.mode === 'guess') {
        dockIdleText.textContent =
          tasteProfile.totalInteractions >= 3
            ? `❤️ 已基于你的 ${tasteProfile.totalDraws} 次饮食偏好精选高契合美食，点击开抽！`
            : '❤️ 猜你喜欢已就绪：抽中后点 👍/👎，你的离线习惯模型会越来越懂你！';
      } else if (!state.location.ready) {
        dockIdleText.textContent = '📍 请先允许浏览器位置授权，以识别你周边范围内的真实外卖店铺';
      } else {
        dockIdleText.textContent =
          state.nearbyShops.length > 0
            ? `已识别周围 ${state.radius / 1000}km 内 ${state.nearbyShops.length} 家实店，点击直接开抽！`
            : '已定位，点击「开始抽卡」抽取今日外卖';
      }
    }
  }

  // =========================================================================
  // 5. 纯浏览器授权地理位置定位（无任何默认城市预设，严格向浏览器请求定位授权）
  // =========================================================================
  async function reverseGeocode(lat, lng) {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`;
    const res = await fetch(url);
    return res.json();
  }

  function requestBrowserLocation(onAuthorized) {
    if (!('geolocation' in navigator)) {
      locDot.classList.remove('loading');
      locDot.classList.add('error');
      locText.textContent = '当前浏览器不支持地理定位 API';
      showToast('⚠️ 当前浏览器不支持地理定位');
      return;
    }

    locDot.classList.remove('error');
    locDot.classList.add('loading');
    locText.textContent = '正在向浏览器请求位置授权...';

    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude, longitude } = pos.coords;
        state.location.lat = latitude;
        state.location.lng = longitude;
        state.location.ready = true;
        btnRelocate.textContent = '📍 重新定位';
        btnRelocate.classList.remove('loc-auth-btn');

        try {
          const data = await reverseGeocode(latitude, longitude);
          const city = data.city || data.principalSubdivision || '';
          const district = data.locality || '';
          state.location.city = city;
          state.location.district = district;
          state.location.label = [city, district].filter(Boolean).join('·') || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
        } catch (_) {
          state.location.city = '';
          state.location.district = '';
          state.location.label = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
        }

        await scanNearbyShops(true);
        if (typeof onAuthorized === 'function') onAuthorized();
      },
      err => {
        state.location.ready = false;
        state.nearbyShops = [];
        locDot.classList.remove('loading');
        locDot.classList.add('error');
        btnRelocate.textContent = '📍 授权定位';
        btnRelocate.classList.add('loc-auth-btn');

        if (err && err.code === 1) {
          locText.textContent = '未获得定位授权 · 请在浏览器中允许位置权限';
          showToast('⚠️ 浏览器拒绝了定位权限，请点击地址栏左侧锁头图标开启定位后重试');
        } else if (err && err.code === 3) {
          locText.textContent = '浏览器定位超时 · 请点击「授权定位」重试';
          showToast('⚠️ 定位超时，请重试');
        } else {
          locText.textContent = '暂无法获取当前位置 · 请检查设备定位服务';
          showToast('⚠️ 无法获取当前位置，请检查系统定位开关');
        }
        syncUI();
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  }

  // =========================================================================
  // 6. 滚轮卡片渲染 & 零闪烁老虎机引擎
  // =========================================================================
  function formatDistance(meters) {
    if (meters == null) return '周边';
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`;
  }

  function formatRatingBadge(item) {
    if (!item.rating) return '';
    const cnt = item.ratingCount ? ` (${item.ratingCount}评)` : '';
    return `<span class="badge badge-rating">⭐ ${item.rating}${cnt}</span>`;
  }

  function createReelCardHTML(item) {
    const titleClass = item.name.length > 10 ? 'dish-name combo-title' : 'dish-name';
    if (item.isRealShop) {
      const ratingHTML = formatRatingBadge(item);
      const thirdBadge = ratingHTML
        ? ratingHTML
        : item.budgetText
          ? `<span class="badge badge-flavor">💰 ${item.budgetText}</span>`
          : `<span class="badge badge-flavor">约 ${item.estDeliveryMin} 分钟达</span>`;
      const matchBadge = state.mode === 'guess' && item._matchPct
        ? `<span class="badge badge-match">❤️ ${item._matchPct}% 契合</span>`
        : `<span class="badge badge-cuisine">${item.cuisine}</span>`;

      return `
        <div class="reel-card">
          <div class="dish-emoji">${item.emoji || '🏪'}</div>
          <div class="dish-name-wrap">
            <div class="${titleClass}">${item.name}</div>
          </div>
          <div class="dish-badges">
            ${matchBadge}
            ${thirdBadge}
            <span class="badge badge-mode">📍 距你 ${formatDistance(item.distance)}</span>
          </div>
        </div>
      `;
    }

    const isTakeout = item.modes.includes('takeout') && !item.modes.includes('cook');
    let modeLabel = '🍳 自己做';
    let modeBadgeClass = 'badge badge-mode';
    if (state.mode === 'guess' && item._matchPct) {
      modeLabel = `❤️ ${item._matchPct}% 契合`;
      modeBadgeClass = 'badge badge-match';
    } else if (isTakeout) {
      modeLabel = '🛵 外卖套餐';
    } else if (state.mode === 'lazy') {
      modeLabel = item.lazyTool ? item.lazyTool.split(' · ')[0] : '⚡ 懒人快手';
      modeBadgeClass = 'badge badge-lazy-tool';
    } else if (item.aiPick) {
      modeLabel = '✨ AI精选';
      modeBadgeClass = 'badge badge-lazy-tool';
    }
    const rightTag = state.mode === 'guess' && item._matchReason ? item._matchReason : (item.tag || '地道美味');

    return `
      <div class="reel-card">
        <div class="dish-emoji">${item.emoji || '🥘'}</div>
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
    // 猜你喜欢采用软权重抽选：高契合度的前排菜品概率更高，同时保留惊喜感
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
    if (pool.length === 0) {
      pool = staticDishes.filter(d => state.mode === 'guess' ? true : d.modes.includes(state.mode));
    }

    state.isSpinning = true;
    btnDraw.disabled = true;
    btnDraw.classList.add('charging');
    btnDraw.querySelector('.draw-btn-text').textContent = '⚡ 聚能蓄力中...';

    // 清理上一轮中奖状态
    slotFrame.classList.remove('won', 'rush', 'braking', 'spinning');
    slotShockwave.classList.remove('boom');
    slotShockwave2.classList.remove('boom');
    slotFlashSweep.classList.remove('flash');
    slotWinBanner.classList.remove('show');

    // Stage 1: 开启聚光灯舞台 + 物理蓄力回拉 (0ms ~ 270ms)
    ritualSpotlight.classList.add('active');
    slotMachineSection.classList.add('in-ritual');
    slotFrame.classList.add('winding-up');
    playWindupSound();

    dockIdleText.textContent =
      state.mode === 'guess'
        ? '❤️ 正在结合你的本地口味画像筛选专属天命美食...'
        : state.mode === 'takeout' && pool[0]?.isRealShop
          ? `🛵 正在周围 ${state.radius / 1000}km 的 ${pool.length} 家真实店铺中锁定目标...`
          : '⚡ 正在开启天命美食转轮，准备起飞...';
    setDockMode('idle');

    let winner = pickWeightedWinner(pool);
    if (pool.length > 1 && state.currentDish && winner.name === state.currentDish.name) {
      const others = pool.filter(d => d.name !== state.currentDish.name);
      winner = pickWeightedWinner(others);
    }

    const currentFirstCardHTML = slotReel.lastElementChild
      ? slotReel.lastElementChild.outerHTML
      : slotReel.innerHTML;

    const totalNewCards = 40;
    const sequenceHTML = [currentFirstCardHTML];
    for (let i = 0; i < totalNewCards - 1; i++) {
      const randItem = pool[Math.floor(Math.random() * pool.length)];
      sequenceHTML.push(createReelCardHTML(randItem));
    }
    sequenceHTML.push(createReelCardHTML(winner));

    // 先装填卷轴并做 26px 物理反向蓄力回拉
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

    // Stage 2: 极速冲刺 + 动态模糊 + 环绕上升火星 (270ms)
    setTimeout(() => {
      slotFrame.classList.remove('winding-up');
      slotFrame.classList.add('spinning', 'rush');
      btnDraw.querySelector('.draw-btn-text').textContent = '🔥 命运飞速转动中...';
      dockIdleText.textContent = '🔥 极速翻滚中，今天究竟花落谁家？';

      void slotReel.offsetHeight;
      slotReel.style.transition = `transform ${spinDurationMs}ms cubic-bezier(0.11, 0.92, 0.18, 1.018)`;
      slotReel.style.transform = `translate3d(0, ${targetOffset}px, 0)`;

      // 持续喷射环绕机器的上升火星
      sparkInterval = setInterval(emitSpinSparks, 110);

      // 递增后递减的心跳棘轮节奏音效 (24声)
      for (let i = 0; i < 24; i++) {
        const progress = i / 24;
        const delay = Math.pow(progress, 2.05) * (spinDurationMs - 200);
        const isLastThree = i >= 21;
        tickTimers.push(
          setTimeout(() => {
            const freq = isLastThree ? 360 + (i - 21) * 55 : 440 + (i % 7) * 42;
            const vol = isLastThree ? 0.062 : 0.042;
            playTickSound(freq, vol);
          }, delay)
        );
      }

      // Stage 3: 心跳急刹悬念阶段（解除动态模糊，两侧指针高频爆闪）
      setTimeout(() => {
        slotFrame.classList.remove('rush');
        slotFrame.classList.add('braking');
        btnDraw.querySelector('.draw-btn-text').textContent = '🥁 即将揭晓天命美食...';
        dockIdleText.textContent = '🥁 减速定格中，屏住呼吸...';
        if (sparkInterval) {
          clearInterval(sparkInterval);
          sparkInterval = null;
        }
      }, Math.round(spinDurationMs * 0.58));

      // Stage 4: 黄金高光揭晓 + 双波冲击波 + 棱镜扫光 + 三波烟花加农炮 + 大和弦号角
      setTimeout(() => {
        tickTimers.forEach(clearTimeout);
        if (sparkInterval) clearInterval(sparkInterval);

        state.isSpinning = false;
        state.currentDish = winner;

        ritualSpotlight.classList.remove('active');
        slotMachineSection.classList.remove('in-ritual');
        slotFrame.classList.remove('spinning', 'rush', 'braking');
        slotFrame.classList.add('won');

        // 触发双波冲击波、棱镜扫屏高光与顶部天命徽章
        void slotFlashSweep.offsetWidth;
        slotFlashSweep.classList.add('flash');
        slotShockwave.classList.add('boom');
        slotShockwave2.classList.add('boom');
        if (state.mode === 'guess' && winner._matchPct) {
          slotWinBanner.textContent = `❤️ 为你专属匹配 ${winner._matchPct}% · ${winner._matchReason || '口味契合'}`;
        } else if (winner.isRealShop) {
          slotWinBanner.textContent = winner.rating ? `⭐ ${winner.rating}分 周边天命好店 ✨` : '✨ 今日周边天命好店 ✨';
        } else {
          slotWinBanner.textContent = '✨ 今日天命美食已定 ✨';
        }
        slotWinBanner.classList.add('show');

        playJackpotFanfare();
        triggerJackpotFireworks(winner.emoji);

        btnDraw.disabled = false;
        btnDraw.classList.remove('charging');
        btnDraw.querySelector('.draw-btn-text').textContent = '再转一次！换个手气';

        // 自动记录到本地离线习惯画像
        recordTasteSignal('draw', { item: winner, meal: state.meal, mode: state.mode });
        addToHistory(winner);
        renderResultDock(winner);
      }, spinDurationMs + 30);
    }, 270);
  }

  // =========================================================================
  // 7. 抽中后底部极简操作坞（含 👍/👎 习惯反馈，点击按钮弹出食谱或周边实店）
  // =========================================================================
  function buildFeedbackHTML(item) {
    const liked = isItemLiked(item.name);
    const disliked = isItemDisliked(item.name);
    return `
      <span class="feedback-inline-group">
        <button type="button" class="feedback-pill-btn ${liked ? 'active-like' : ''}" id="btnTasteLike" title="喜欢这道，以后「猜你喜欢」会多推荐类似口味">👍 ${liked ? '已爱' : '想吃'}</button>
        <button type="button" class="feedback-pill-btn ${disliked ? 'active-dislike' : ''}" id="btnTasteDislike" title="不太想吃，以后「猜你喜欢」会尽量避开">👎</button>
      </span>
    `;
  }

  function bindFeedbackEvents(item) {
    document.getElementById('btnTasteLike')?.addEventListener('click', () => {
      playSelectSound();
      const willLike = !isItemLiked(item.name);
      recordTasteSignal('like', { item });
      renderResultDock(item);
      showToast(willLike ? `❤️ 已记住你喜欢「${item.name}」，画像权重已更新` : '已取消喜欢标记');
    });
    document.getElementById('btnTasteDislike')?.addEventListener('click', () => {
      playSelectSound();
      const willDislike = !isItemDisliked(item.name);
      recordTasteSignal('dislike', { item });
      renderResultDock(item);
      showToast(willDislike ? `👌 已记住避开「${item.name}」，下次猜你喜欢将减少类似推荐` : '已取消避开标记');
    });
  }

  function renderResultDock(item) {
    const isShopOrTakeout = item.isRealShop || (item.modes?.includes('takeout') && !item.modes?.includes('cook'));

    if (!isShopOrTakeout) {
      const modeIcon = state.mode === 'guess' ? '❤️' : (state.mode === 'lazy' ? '⚡' : '🍳');
      const matchedSubs = getDishSubstitutions(item.ingredients || []);
      const subBadgeText = matchedSubs.length > 0 ? ` · ${matchedSubs.length}项平替` : '';
      resultActionContent.innerHTML = `
        <div class="action-panel-header">
          <span>${modeIcon} 「<strong>${item.name}</strong>」· ${item.time || '约15分'}${subBadgeText}</span>
          <div class="dock-header-right">
            ${buildFeedbackHTML(item)}
          </div>
        </div>
        <div class="action-btn-grid">
          <button type="button" class="action-link-btn primary-action" id="btnOpenRecipeModal">
            📖 查看图文食谱 & 平替
          </button>
          <button type="button" class="action-link-btn" id="btnCopyRecipeQuick">
            📋 复制食材清单
          </button>
        </div>
      `;

      document.getElementById('btnOpenRecipeModal')?.addEventListener('click', () => openRecipeModal(item));
      document.getElementById('btnCopyRecipeQuick')?.addEventListener('click', () => copyRecipeToClipboard(item));
      bindFeedbackEvents(item);
    } else {
      const copyTarget = item.isRealShop ? item.name : (item.searchKeyword || item.name);
      const starText = item.rating ? `⭐${item.rating} · ` : '';
      const distBadge = item.isRealShop
        ? `${starText}${formatDistance(item.distance)}`
        : state.location.label;

      resultActionContent.innerHTML = `
        <div class="action-panel-header">
          <span>🏪 「<strong>${item.name}</strong>」· ${distBadge}</span>
          <div class="dock-header-right">
            ${buildFeedbackHTML(item)}
          </div>
        </div>
        <div class="action-btn-grid cols-3">
          <button type="button" class="action-link-btn primary-action" id="btnOpenShopModal">
            🏪 看店铺与评价
          </button>
          <button type="button" class="action-link-btn" id="btnCopyShopQuick">
            📋 复制店名
          </button>
          <button type="button" class="action-link-btn" id="btnExpandQuick">
            🔭 扩至5km
          </button>
        </div>
      `;

      document.getElementById('btnOpenShopModal')?.addEventListener('click', () => openShopModal(item));
      document.getElementById('btnCopyShopQuick')?.addEventListener('click', () => {
        playSelectSound();
        recordTasteSignal('copy', { item });
        navigator.clipboard
          .writeText(copyTarget)
          .then(() => showToast(`✅ 已复制「${copyTarget}」，可去外卖软件搜索下单`))
          .catch(() => showToast(`✅ 店铺名：${copyTarget}`));
      });
      document.getElementById('btnExpandQuick')?.addEventListener('click', () => {
        playSelectSound();
        state.radius = 5000;
        radiusSelect.value = '5000';
        scanNearbyShops(true);
        showToast('📡 已扩大范围至 5km 重新扫描周边店铺');
      });
      bindFeedbackEvents(item);
    }

    setDockMode('result');
  }

  // =========================================================================
  // 8. 详细图文食谱弹窗构建器（仅在用户点击按钮时弹出，且无任何头部挤压截断Bug）
  // =========================================================================
  function analyzeStepVisual(stepText, idx, total) {
    let stage = '烹饪操作';
    let heat = '';
    let time = '';
    let svgIcon = '';

    const timeMatch = stepText.match(/([0-9一二三四五六七八九十半]+(?:\s*[-~至]\s*[0-9]+)?\s*(?:分钟|秒|小时))/);
    if (timeMatch) time = `⏱️ ${timeMatch[1].replace(/\s+/g, '')}`;

    if (stepText.includes('大火') || stepText.includes('猛火')) heat = '🔥 大火';
    else if (stepText.includes('中小火')) heat = '🔉 中小火';
    else if (stepText.includes('小火') || stepText.includes('文火') || stepText.includes('微沸')) heat = '🕯️ 小火';
    else if (stepText.includes('中火')) heat = '🍳 中火';

    if (/(洗净|改刀|切|去皮|去骨|剁|拍|泡发|淘洗)/.test(stepText) && idx <= 2) {
      stage = '备料改刀';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><rect x="6" y="30" width="36" height="8" rx="3" fill="#d97706" opacity="0.35"/><path d="M12 24L34 10L38 18L18 28Z" fill="#fbbf24" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M9 26L14 23" stroke="#ff7043" stroke-width="3.5" stroke-linecap="round"/><circle cx="28" cy="27" r="3" fill="#4ade80"/><circle cx="35" cy="27" r="2.5" fill="#f87171"/></svg>`;
    } else if (/(腌制|抓匀|上浆|淀粉|蛋清|静置|抹)/.test(stepText)) {
      stage = '腌制码味';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><path d="M10 22C10 31 16 37 24 37C32 37 38 31 38 22H10Z" fill="#fb923c" opacity="0.35" stroke="#fbbf24" stroke-width="2"/><path d="M29 11L21 24" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="19" cy="18" r="2" fill="#fde047"/><circle cx="25" cy="15" r="1.8" fill="#fca5a5"/></svg>`;
    } else if (/(焯水|冷水下锅|浮沫|捞出|沥干|烫)/.test(stepText)) {
      stage = '焯水去腥';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><path d="M11 22H37V32C37 35.5 34 38 30 38H18C14 38 11 35.5 11 32V22Z" fill="#38bdf8" opacity="0.28" stroke="#7dd3fc" stroke-width="2"/><path d="M16 27C19 25 22 29 25 27C28 25 31 29 33 27" stroke="#bae6fd" stroke-width="2" stroke-linecap="round"/><path d="M18 16C18 13 20 13 20 10M24 17C24 14 26 14 26 11M30 16C30 13 32 13 32 10" stroke="#fde047" stroke-width="2" stroke-linecap="round"/></svg>`;
    } else if (/(爆香|热油|底油|红油|葱姜蒜|豆瓣)/.test(stepText)) {
      stage = '热锅爆香';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><path d="M10 26C12 33 17 36 24 36C31 36 36 33 38 26H10Z" fill="#ea580c" opacity="0.45" stroke="#fbbf24" stroke-width="2"/><path d="M38 27L44 24" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/><path d="M24 12C27 16 29 19 26 23C24 25 21 24 21 21C21 18 23 15 24 12Z" fill="#f97316"/><circle cx="17" cy="20" r="2" fill="#fde047"/><circle cx="31" cy="19" r="2" fill="#4ade80"/></svg>`;
    } else if (/(蒸|上汽|蒸锅)/.test(stepText)) {
      stage = '足汽蒸制';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><rect x="10" y="22" width="28" height="14" rx="4" fill="#fbbf24" opacity="0.28" stroke="#fcd34d" stroke-width="2"/><path d="M15 22C17 17 31 17 33 22" stroke="#fcd34d" stroke-width="2"/><path d="M18 14C18 11 20 11 20 8M24 14C24 11 26 11 26 8M30 14C30 11 32 11 32 8" stroke="#7dd3fc" stroke-width="2" stroke-linecap="round"/></svg>`;
    } else if (/(炖|焖|煲|砂锅|慢煮|煮沸)/.test(stepText)) {
      stage = '焖炖入味';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><path d="M11 23H37L35 36C34.5 38 32 39 24 39C16 39 13.5 38 13 36L11 23Z" fill="#f59e0b" opacity="0.35" stroke="#fbbf24" stroke-width="2"/><path d="M13 22C15 17 33 17 35 22" stroke="#fde047" stroke-width="2"/><circle cx="24" cy="16" r="2.2" fill="#fbbf24"/><path d="M18 42L21 39M30 42L27 39M24 43V39" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/></svg>`;
    } else if (idx === total - 1 || /(装盘|出锅|盛出|摆盘|撒上|开吃|完成)/.test(stepText)) {
      stage = '出锅装盘';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><ellipse cx="24" cy="31" rx="16" ry="6" fill="#fbbf24" opacity="0.3" stroke="#fde047" stroke-width="2"/><path d="M16 28C17 22 31 22 32 28" fill="#f97316" opacity="0.6"/><circle cx="22" cy="25" r="2" fill="#4ade80"/><circle cx="27" cy="26" r="2" fill="#fef08a"/><path d="M24 11L25.5 15L29.5 16.5L25.5 18L24 22L22.5 18L18.5 16.5L22.5 15L24 11Z" fill="#fde047"/></svg>`;
    } else if (/(收汁|调味|淋入|勾芡|生抽|食盐)/.test(stepText)) {
      stage = '调味收汁';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><path d="M10 27C12 34 17 37 24 37C31 37 36 34 38 27H10Z" fill="#f97316" opacity="0.35" stroke="#fbbf24" stroke-width="2"/><rect x="25" y="10" width="8" height="12" rx="2" transform="rotate(28 25 10)" fill="#fde047"/><circle cx="20" cy="22" r="1.8" fill="#7dd3fc"/><circle cx="24" cy="24" r="1.8" fill="#fde047"/></svg>`;
    } else {
      stage = '大火烹制';
      svgIcon = `<svg viewBox="0 0 48 48" width="36" height="36" fill="none"><path d="M9 26C11 33 17 36 24 36C31 36 37 33 39 26H9Z" fill="#fb923c" opacity="0.38" stroke="#fbbf24" stroke-width="2"/><path d="M38 26L45 22" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/><path d="M18 21C20 17 24 17 26 21" stroke="#fde047" stroke-width="2" stroke-linecap="round"/><path d="M19 41C20 38 28 38 29 41" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/></svg>`;
    }

    return { stage, heat, time, svgIcon };
  }

  function splitIngredientAndAmount(raw) {
    const str = String(raw || '').trim();
    const calcMatch = str.match(/^(.+?)(?:的用量为|:|：|\s+)([0-9.\/~～\-一二三四五六七八九十半两]+\s*[a-zA-Z克千克斤两勺个只根片瓣块朵棵颗碗杯毫升升滴适量少许]+.*)$/);
    if (calcMatch) {
      return { name: calcMatch[1].trim(), amount: calcMatch[2].trim() };
    }
    const prefixMatch = str.match(/^([0-9.\/~～\-一二三四五六七八九十半两]+\s*(?:g|kg|ml|L|克|千克|斤|两|个|只|根|片|瓣|勺|大勺|小勺|汤匙|茶匙|块|朵|棵|颗|碗|杯|盒|条|袋|包)|适量|少许|半个|半根|一把|一碗)\s*(.+)$/i);
    if (prefixMatch) {
      return { name: prefixMatch[2].trim(), amount: prefixMatch[1].trim() };
    }
    return { name: str, amount: '适量' };
  }

  function highlightStepText(text) {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^【(.+?)】/, '<mark>$1</mark> ');
    return escaped.replace(
      /([0-9.\/~～\-一二三四五六七八九十半]+\s*(?:分钟|秒|小时|g|kg|ml|毫升|克|勺|大勺|小勺|成热|度|℃))/g,
      '<mark>$1</mark>'
    );
  }

  function parseFullHowToCookMarkdown(mdText, mdPath) {
    const lines = mdText.split(/\r?\n/);
    const calcIngs = [];
    const rawIngs = [];
    const steps = [];
    const tips = [];
    const images = [];
    let intro = '';
    let difficulty = '';
    let section = '';

    const dirPath = mdPath.split('/').slice(0, -1).map(encodeURIComponent).join('/');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const imgMatch = line.match(/!\[.*?\]\((.+?)\)/);
      if (imgMatch) {
        let imgRel = imgMatch[1].trim();
        if (!imgRel.startsWith('http')) {
          imgRel = imgRel.replace(/^\.\//, '');
          const encodedImg = imgRel.split('/').map(encodeURIComponent).join('/');
          images.push(`https://cdn.jsdelivr.net/gh/Anduin2017/HowToCook@master/${dirPath}/${encodedImg}`);
        } else {
          images.push(imgRel);
        }
        continue;
      }

      if (line.startsWith('# ')) continue;
      if (line.startsWith('## ')) {
        if (line.includes('计算')) section = 'calc';
        else if (line.includes('原料') || line.includes('材料') || line.includes('食材')) section = 'ing';
        else if (line.includes('操作') || line.includes('步骤') || line.includes('流程') || line.includes('做法')) section = 'steps';
        else if (line.includes('附加') || line.includes('注意') || line.includes('贴士')) section = 'tips';
        else section = 'other';
        continue;
      }
      if (line.startsWith('### ')) continue;

      if (!section) {
        if (line.includes('预估烹饪难度：')) {
          difficulty = line.replace('预估烹饪难度：', '').trim();
        } else if (!line.includes('预估卡路里') && !intro && line.length > 10) {
          intro = line;
        }
        continue;
      }

      if (section === 'calc' && (line.startsWith('- ') || line.startsWith('* '))) {
        const item = line.replace(/^[-*]\s+/, '').replace(/（.*?）/g, '').trim();
        if (item) calcIngs.push(item);
      } else if (section === 'ing' && (line.startsWith('- ') || line.startsWith('* '))) {
        const item = line.replace(/^[-*]\s+/, '').trim();
        if (item) rawIngs.push(item);
      } else if (section === 'steps' && (line.startsWith('- ') || line.startsWith('* ') || /^\d+\./.test(line))) {
        const st = line.replace(/^([-*]|\d+\.)\s+/, '').replace(/\*\*/g, '').trim();
        if (st && st.length > 2) steps.push(st);
      } else if (section === 'tips' && (line.startsWith('- ') || line.startsWith('* '))) {
        const tp = line.replace(/^[-*]\s+/, '').replace(/\[.*?\]\(.*?\)/g, '').trim();
        if (tp && !tp.includes('参考') && !tp.includes('http') && tp.length > 4) tips.push(tp);
      }
    }

    return {
      intro,
      difficulty,
      ingredients: calcIngs.length >= 2 ? calcIngs : rawIngs,
      steps,
      tips,
      images
    };
  }

  // 自动匹配该菜品所有可平替的中国本土食材/调料方案
  function getDishSubstitutions(ings) {
    const matched = [];
    const seenLabels = new Set();
    const fullIngText = (ings || []).join(' ');
    for (const rule of localSubstitutions) {
      if (rule.match.test(fullIngText) && !seenLabels.has(rule.label)) {
        seenLabels.add(rule.label);
        matched.push(rule);
      }
    }
    return matched;
  }

  function hasIngredientSub(rawIng) {
    return localSubstitutions.some(rule => rule.match.test(rawIng));
  }

  function buildIllustratedRecipeHTML(dish) {
    const ings = dish.ingredients || [];
    const steps = dish.steps || [];
    const tips = dish.tips || [];
    const images = dish.images || [];
    const time = dish.time || '约 20 分钟';
    const difficulty = dish.difficulty || '★★★☆☆ 家常易做';
    const matchedSubs = getDishSubstitutions(ings);

    const photoGalleryHTML =
      images.length > 0
        ? `
        <div class="recipe-photo-gallery">
          ${images
            .slice(0, 3)
            .map(
              (url, i) => `
            <div class="recipe-photo-card">
              <img src="${url}" alt="${dish.name} 图${i + 1}" loading="lazy" onerror="this.parentElement.style.display='none'" />
              <div class="recipe-photo-caption">${dish.name} · 实拍参考 ${i + 1}</div>
            </div>
          `
            )
            .join('')}
        </div>
      `
        : '';

    const introHTML = dish.intro ? `<div class="recipe-intro-text">${dish.intro}</div>` : '';

    const ingredientsGridHTML = ings
      .map(rawIng => {
        const { name, amount } = splitIngredientAndAmount(rawIng);
        const subMark = hasIngredientSub(rawIng) ? `<span class="ing-sub-dot" title="下方有本土平替方案">可平替</span>` : '';
        return `
        <div class="ing-check-item" role="button" tabindex="0">
          <div class="ing-check-left">
            <span class="ing-checkbox">✓</span>
            <span class="ing-name">${name}</span>
            ${subMark}
          </div>
          <span class="ing-amount">${amount}</span>
        </div>
      `;
      })
      .join('');

    const subGuideHTML =
      matchedSubs.length > 0
        ? `
        <div class="sub-guide-box">
          <div class="recipe-block-header" style="margin-bottom:8px;">
            <span class="recipe-block-title" style="color:#7dd3fc;">🔄 本土食材平替指南（缺料不用专门买）</span>
            <span class="recipe-block-sub">自动匹配 ${matchedSubs.length} 项家用平替</span>
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
        return `
        <div class="illustrated-step-card" role="button" tabindex="0">
          <div class="step-visual-box">
            <div class="step-visual-svg">${vis.svgIcon}</div>
            <div class="step-stage-name">${vis.stage}</div>
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
            <span class="recipe-block-title">💡 烹饪关键窍门</span>
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
          ${dish.aiPick ? `<span class="meta-pill" style="border-color:rgba(251,191,36,0.5);color:#fde68a;">✨ AI精选零翻车</span>` : ''}
          ${dish.lazyTool ? `<span class="meta-pill" style="border-color:rgba(192,132,252,0.5);color:#e9d5ff;">${dish.lazyTool}</span>` : ''}
          <span class="meta-pill">⏱️ ${time}</span>
          <span class="meta-pill">🔥 难度 ${difficulty}</span>
          <span class="meta-pill">🛒 食材 ${ings.length} 项</span>
          <span class="meta-pill">📑 共 ${steps.length} 步</span>
        </div>
        ${introHTML}
        ${photoGalleryHTML}
      </div>

      <div>
        <div class="recipe-block-header">
          <span class="recipe-block-title">🛒 必备食材与用量</span>
          <span class="recipe-block-sub">点击卡片可勾选备菜进度</span>
        </div>
        <div class="ing-checklist-grid">${ingredientsGridHTML}</div>
      </div>

      ${subGuideHTML}

      <div>
        <div class="recipe-block-header">
          <span class="recipe-block-title">⚡ 分步图文详解</span>
          <span class="recipe-block-sub">点击步骤可标记完成</span>
        </div>
        <div class="illustrated-steps-list">${stepsListHTML}</div>
      </div>

      ${tipsHTML}
    `;
  }

  function bindRecipeInteractions(containerEl) {
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
  }

  function copyRecipeToClipboard(dish) {
    playSelectSound();
    recordTasteSignal('copy', { item: dish });
    const lines = [
      `【${dish.name} · 详细食谱】(${dish.cuisine} · ${dish.tag || '家常美味'})`,
      `预计耗时：${dish.time || '约20分钟'} | 难度：${dish.difficulty || '★★★☆☆'}`,
      '',
      '🛒 必备食材与用量：',
      ...(dish.ingredients || []).map(i => `- ${i}`),
      '',
      '⚡ 详细做法步骤：',
      ...(dish.steps || []).map((s, idx) => `${idx + 1}. ${s}`)
    ];
    navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => showToast(`✅ 已复制「${dish.name}」食材与完整步骤清单`))
      .catch(() => showToast(`✅ 已生成「${dish.name}」清单`));
  }

  // 点击「查看详细图文食谱」弹出本页弹窗（无外部跳转）
  async function openRecipeModal(dish) {
    playSelectSound();
    recordTasteSignal('open_detail', { item: dish });
    modalEmoji.textContent = dish.emoji || '🥘';
    modalDishName.textContent = `${dish.name} · 详细图文食谱`;
    modalTags.innerHTML = `
      <span class="badge badge-cuisine">${dish.cuisine}</span>
      <span class="badge badge-flavor">${dish.tag || '地道美味'}</span>
    `;

    modalBody.scrollTop = 0;
    modalBody.innerHTML = buildIllustratedRecipeHTML(dish);
    bindRecipeInteractions(modalBody);

    modalFooter.innerHTML = `
      <button type="button" class="action-link-btn primary-action" id="btnModalCopy">📋 复制完整食材与步骤</button>
      <button type="button" class="action-link-btn" id="btnModalDone">✅ 关闭食谱弹窗</button>
    `;

    document.getElementById('btnModalCopy')?.addEventListener('click', () => copyRecipeToClipboard(dish));
    document.getElementById('btnModalDone')?.addEventListener('click', closeRecipeModal);

    recipeModal.classList.add('open');
    recipeModal.setAttribute('aria-hidden', 'false');

    // 若关联 HowToCook，后台异步拉取更全图片与原文步骤静默增强
    if (dish.recipePath && !dish._htcLoaded) {
      try {
        const encodedPath = dish.recipePath.split('/').map(encodeURIComponent).join('/');
        const cdnUrl = `https://cdn.jsdelivr.net/gh/Anduin2017/HowToCook@master/${encodedPath}`;
        const res = await fetch(cdnUrl);
        if (res.ok) {
          const mdText = await res.text();
          const parsed = parseFullHowToCookMarkdown(mdText, dish.recipePath);
          if (parsed.ingredients.length >= 2) dish.ingredients = parsed.ingredients;
          if (parsed.steps.length >= 2) dish.steps = parsed.steps;
          if (parsed.tips.length >= 1) dish.tips = parsed.tips;
          if (parsed.intro) dish.intro = parsed.intro;
          if (parsed.difficulty) dish.difficulty = parsed.difficulty;
          if (parsed.images.length) {
            dish.images = Array.from(new Set([...(dish.images || []), ...parsed.images]));
          }
          dish._htcLoaded = true;
          if (recipeModal.classList.contains('open') && state.currentDish?.name === dish.name) {
            modalBody.innerHTML = buildIllustratedRecipeHTML(dish);
            bindRecipeInteractions(modalBody);
          }
        }
      } catch (_) {}
    }
  }

  // 点击「看店铺与评价」弹出本页周边实店详情与同菜系清单弹窗
  function openShopModal(item) {
    playSelectSound();
    recordTasteSignal('open_detail', { item });
    const peerShops = (state.mode === 'takeout' ? getFilteredPool() : state.nearbyShops).filter(s => s.isRealShop);
    const radiusKm = (state.radius / 1000).toFixed(0);
    const cuisineLabel = state.cuisine === 'all' ? '全菜系' : state.cuisine;
    const srcBadgeMap = {
      google: '🌍 Google Places 星级库',
      hotpepper: '🇯🇵 Hot Pepper 日本实店库',
      amap: '🇨🇳 高德官方评分库',
      osm: '🗺️ 免Key开放实店库'
    };
    const srcBadge = srcBadgeMap[item.source || state.nearbySource] || '周边实店库';
    const copyTarget = item.isRealShop ? item.name : (item.searchKeyword || item.name);

    modalEmoji.textContent = item.emoji || '🏪';
    modalDishName.textContent = item.name;
    modalTags.innerHTML = `
      <span class="badge badge-cuisine">${item.cuisine}</span>
      ${item.rating ? formatRatingBadge(item) : ''}
      <span class="badge badge-flavor">${item.isRealShop ? srcBadge : '经典外卖套餐'}</span>
    `;

    const combosHTML = (item.combos || ['门店招牌单人工作套餐', '热门主食+小食/饮品套餐'])
      .map(c => `<span class="combo-suggest-chip">🍽️ ${c}</span>`)
      .join('');

    const shopPhotoHTML = item.photoUrl
      ? `<img src="${item.photoUrl}" alt="${item.name}" class="shop-hero-photo" loading="lazy" onerror="this.style.display='none'" />`
      : '';

    const ratingPill = item.rating
      ? `<span class="meta-pill" style="border-color:rgba(250,204,21,0.55);color:#fef08a;">⭐ ${item.rating} 分${item.ratingCount ? `（${item.ratingCount}条评价）` : ''}</span>`
      : '';

    const budgetPill = item.budgetText
      ? `<span class="meta-pill">💰 ${item.budgetText}</span>`
      : item.cost
        ? `<span class="meta-pill">💰 人均 ¥${item.cost}</span>`
        : '';

    const heroHTML = item.isRealShop
      ? `
        <div class="recipe-hero-banner">
          ${shopPhotoHTML}
          <div class="recipe-meta-pills">
            ${ratingPill}
            <span class="meta-pill">📍 距你 ${formatDistance(item.distance)}</span>
            <span class="meta-pill">🛵 预计 ${item.estDeliveryMin} 分钟送达</span>
            ${budgetPill}
          </div>
          <div class="recipe-intro-text">
            📍 门店位置：<strong>${item.address || `${state.location.label} ${radiusKm}km 商圈内`}</strong>
            ${item.openTime ? `<br/>🕒 营业时间：${item.openTime}` : ''}
          </div>
          <div>
            <div class="recipe-block-header" style="margin-bottom:6px;">
              <span class="recipe-block-title">🍱 进店/外卖必点参考</span>
            </div>
            <div class="combo-suggest-chips">${combosHTML}</div>
          </div>
        </div>
      `
      : `
        <div class="recipe-hero-banner">
          <div class="recipe-meta-pills">
            <span class="meta-pill">📍 ${state.location.label} ${radiusKm}km 内暂未扫到该细分菜系实店</span>
            <span class="meta-pill">💡 点 ⚙️ 可配 Google Places（带星级）或日本 Hot Pepper（免费）</span>
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
            <span class="nearby-shop-addr">📍 ${shop.address || '周边商圈'}</span>
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
            <span class="recipe-block-title">🏪 周围 ${radiusKm}km 内「${cuisineLabel}」真实店铺（共 ${peerShops.length} 家）</span>
            <span class="recipe-block-sub">点击可切换查看</span>
          </div>
          <div class="shop-list-grid">${shopRowsHTML}</div>
        </div>
      `
        : '';

    const recruitCreditHTML =
      item.source === 'hotpepper' || state.nearbySource === 'hotpepper'
        ? `<div class="recruit-credit">Powered by <a href="http://webservice.recruit.co.jp/" target="_blank" rel="noopener noreferrer">ホットペッパーグルメ Webサービス</a></div>`
        : '';

    modalBody.scrollTop = 0;
    modalBody.innerHTML = heroHTML + directoryHTML + recruitCreditHTML;

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

    modalFooter.innerHTML = `
      <button type="button" class="action-link-btn primary-action" id="btnModalCopyShop">📋 复制店名去外卖软件搜索</button>
      <button type="button" class="action-link-btn" id="btnModalDoneShop">✅ 关闭窗口</button>
    `;

    document.getElementById('btnModalCopyShop')?.addEventListener('click', () => {
      playSelectSound();
      recordTasteSignal('copy', { item });
      navigator.clipboard
        .writeText(copyTarget)
        .then(() => showToast(`✅ 已复制「${copyTarget}」，可直接去 Uber Eats / 美团 / 饿了么粘贴下单`))
        .catch(() => showToast(`✅ 店铺名：${copyTarget}`));
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
    if (amapKeyInput) amapKeyInput.value = state.amapKey;

    const activeSources = [];
    if (state.googleKey) activeSources.push('Google星级');
    if (state.hotpepperKey) activeSources.push('日本HotPepper');
    if (state.amapKey) activeSources.push('高德评分');
    sourceStatusBadge.textContent = activeSources.length > 0
      ? `已启用：${activeSources.join(' + ')}`
      : '当前：免Key免费周边扫描（填Key解锁星级评价）';
    sourceModal.classList.add('open');
    sourceModal.setAttribute('aria-hidden', 'false');
  }

  function closeSourceModal() {
    sourceModal.classList.remove('open');
    sourceModal.setAttribute('aria-hidden', 'true');
  }

  // =========================================================================
  // 8.5. 离线饮食习惯画像 & 在线 AI 深度饮食分析弹窗
  // =========================================================================
  function loadAIConfig() {
    try {
      const raw = localStorage.getItem(AI_CFG_STORAGE_KEY);
      return raw ? JSON.parse(raw) : { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' };
    } catch (_) {
      return { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' };
    }
  }

  function saveAIConfig(cfg) {
    try {
      localStorage.setItem(AI_CFG_STORAGE_KEY, JSON.stringify(cfg));
    } catch (_) {}
  }

  function computeOfflinePersona() {
    const topC = getTopEntries(tasteProfile.cuisineScores, 3);
    const topF = getTopEntries(tasteProfile.flavorScores, 3);
    const totalModes = Object.values(tasteProfile.modeCounts).reduce((a, b) => a + b, 0) || 1;
    const lazyPct = Math.round(((tasteProfile.modeCounts.lazy || 0) / totalModes) * 100);
    const takeoutPct = Math.round(((tasteProfile.modeCounts.takeout || 0) / totalModes) * 100);

    if (tasteProfile.totalInteractions < 3) {
      return {
        title: '🌱 美食口味探索新手',
        desc: '你的离线饮食画像刚刚建立！多抽几次卡、点击查看食谱或在结果栏点 👍 / 👎，系统就会在本地自动学习你的口味偏好，绝不上传个人隐私。'
      };
    }

    const favCuisine = topC[0]?.[0] || '多元菜系';
    const favFlavor = topF[0]?.[0] || '咸香下饭';
    let title = '🍽️ 百味通吃的美食鉴赏家';
    if (favCuisine === '川渝菜' || favCuisine === '湘鄂赣' || favFlavor === '麻辣鲜香') title = '🌶️ 无辣不欢的干饭王者';
    else if (favCuisine === '日韩亚太') title = '🍣 日韩亚太风味探索家';
    else if (favCuisine === '粤港澳' || favCuisine === '江浙沪' || favFlavor === '鲜美清淡') title = '🦐 讲究鲜味的清雅食客';
    else if (lazyPct >= 40) title = '⚡ 极速一锅出懒人厨神';
    else if (takeoutPct >= 45) title = '🛵 商圈高分外卖雷达手';
    else if (favCuisine === '欧美西餐') title = '🥩 都市轻食西餐品鉴师';

    const desc = `最偏爱 <strong>${favCuisine}</strong> 与 <strong>${favFlavor}</strong> 风味；懒人快手占比 ${lazyPct}%，点外卖占比 ${takeoutPct}%。已离线记录 ${tasteProfile.totalDraws} 次抽选与 ${tasteProfile.likedItems.length} 道心头好。`;
    return { title, desc };
  }

  function buildTastePromptText() {
    const topC = getTopEntries(tasteProfile.cuisineScores, 5).map(([k, v]) => `${k}(权重${v})`).join('、') || '暂无足够记录';
    const topF = getTopEntries(tasteProfile.flavorScores, 5).map(([k, v]) => `${k}(权重${v})`).join('、') || '暂无足够记录';
    const liked = tasteProfile.likedItems.slice(0, 12).map(x => x.name).join('、') || '暂无';
    const disliked = tasteProfile.dislikedItems.slice(0, 12).map(x => x.name).join('、') || '暂无';
    const recent = tasteProfile.recentHistory.slice(0, 15).map(x => `${x.name}(${x.cuisine})`).join('、') || '暂无';

    return [
      '请作为我的私人注册营养师和美食顾问，基于以下我的匿名离线饮食习惯数据，做一份简明实用的饮食分析报告：',
      `- 累计抽选次数：${tasteProfile.totalDraws} 次（早餐 ${tasteProfile.mealCounts.breakfast} / 午餐 ${tasteProfile.mealCounts.lunch} / 晚餐 ${tasteProfile.mealCounts.dinner}）`,
      `- 就餐方式分布：自己做 ${tasteProfile.modeCounts.cook} 次 / 懒人快手 ${tasteProfile.modeCounts.lazy} 次 / 点外卖 ${tasteProfile.modeCounts.takeout} 次`,
      `- 最偏爱菜系 Top5：${topC}`,
      `- 最偏爱口味维度 Top5：${topF}`,
      `- 标记「喜欢 👍」的菜品：${liked}`,
      `- 标记「不太想吃 👎」的菜品：${disliked}`,
      `- 最近吃过/抽中的记录：${recent}`,
      '',
      '请用中文给出：',
      '1. 【口味画像总结】一句话点出我的饮食性格',
      '2. 【营养均衡提醒】指出可能偏重油盐/碳水或缺乏哪些膳食元素，给出温和可执行的改善建议',
      '3. 【量身推荐3道新菜】兼顾我的口味偏好与健康平衡（注明适合早/午/晚哪一餐及一句话理由）'
    ].join('\n');
  }

  function renderTasteModalContent() {
    const persona = computeOfflinePersona();
    const topC = getTopEntries(tasteProfile.cuisineScores, 5);
    const maxC = topC[0]?.[1] || 1;
    const topF = getTopEntries(tasteProfile.flavorScores, 6);
    const aiCfg = loadAIConfig();

    tasteCountBadge.textContent = `已记录 ${tasteProfile.totalInteractions} 次偏好`;

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
      : `<div style="font-size:12.5px;color:var(--text-muted);">暂无菜系偏好记录，去抽几次卡或点个 👍 试试吧！</div>`;

    const flavorPillsHTML = topF.length > 0
      ? topF.map(([k]) => `<span class="taste-tag-pill">✨ ${k}</span>`).join('')
      : `<span class="taste-tag-pill">待探索更多口味</span>`;

    const likedHTML = tasteProfile.likedItems.length > 0
      ? tasteProfile.likedItems.slice(0, 12).map(x => `<span class="taste-tag-pill liked">👍 ${x.emoji || ''} ${x.name}</span>`).join('')
      : `<span style="font-size:12px;color:var(--text-muted);">抽中后点击结果栏「👍 想吃」即可收藏到这里</span>`;

    const dislikedHTML = tasteProfile.dislikedItems.length > 0
      ? tasteProfile.dislikedItems.slice(0, 10).map(x => `<span class="taste-tag-pill disliked">👎 ${x.name}</span>`).join('')
      : `<span style="font-size:12px;color:var(--text-muted);">暂无避开项</span>`;

    const cachedAIHTML = tasteProfile.aiAnalysisText
      ? `<div class="taste-ai-result" id="tasteAiResult">${tasteProfile.aiAnalysisText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
      : `<div class="taste-ai-result" id="tasteAiResult" style="color:var(--text-muted);">可免费点击「📋 复制画像提示词」发给任意 AI，或填入你自己的 OpenAI 兼容接口（如 DeepSeek / OpenAI / OpenRouter）在本页一键生成深度营养与新菜建议（Key 仅存本地浏览器）。</div>`;

    tasteModalBody.innerHTML = `
      <div class="taste-persona-banner">
        <div style="font-size:15px;font-weight:800;margin-bottom:4px;">${persona.title}</div>
        <div>${persona.desc}</div>
      </div>

      <div class="taste-stat-grid">
        <div class="taste-stat-card">
          <span class="taste-stat-val">${tasteProfile.totalDraws}</span>
          <span class="taste-stat-label">累计抽卡</span>
        </div>
        <div class="taste-stat-card">
          <span class="taste-stat-val">${tasteProfile.likedItems.length}</span>
          <span class="taste-stat-label">👍 心头好</span>
        </div>
        <div class="taste-stat-card">
          <span class="taste-stat-val">${tasteProfile.dislikedItems.length}</span>
          <span class="taste-stat-label">👎 已避开</span>
        </div>
        <div class="taste-stat-card">
          <span class="taste-stat-val">${tasteProfile.recentHistory.length}</span>
          <span class="taste-stat-label">近期防腻库</span>
        </div>
      </div>

      <div class="taste-section-card">
        <div class="recipe-block-header" style="margin-bottom:2px;">
          <span class="recipe-block-title">📈 离线菜系偏好排行（Top 5）</span>
          <span class="recipe-block-sub">纯本地计算 · 断网可用</span>
        </div>
        <div class="taste-bar-list">${cuisineBarsHTML}</div>
        <div class="taste-chip-wrap" style="margin-top:4px;">${flavorPillsHTML}</div>
      </div>

      <div class="taste-section-card">
        <div class="recipe-block-header" style="margin-bottom:2px;">
          <span class="recipe-block-title">👍 喜欢 & 👎 避开清单</span>
        </div>
        <div class="taste-chip-wrap">${likedHTML}</div>
        ${tasteProfile.dislikedItems.length > 0 ? `<div class="taste-chip-wrap" style="margin-top:4px;">${dislikedHTML}</div>` : ''}
      </div>

      <div class="taste-ai-box">
        <div class="recipe-block-header" style="margin-bottom:2px;">
          <span class="recipe-block-title" style="color:#d8b4fe;">🤖 在线 AI 深度饮食分析（可选增强）</span>
          <span class="recipe-block-sub">仅发送匿名统计，不传定位</span>
        </div>
        <div class="taste-ai-config-grid">
          <input type="text" id="aiBaseUrlInput" class="source-input" value="${aiCfg.baseUrl || ''}" placeholder="API 地址（如 https://api.deepseek.com/v1）" />
          <input type="text" id="aiModelInput" class="source-input" value="${aiCfg.model || ''}" placeholder="模型名（如 deepseek-chat / gpt-4o-mini）" />
        </div>
        <input type="password" id="aiKeyInput" class="source-input" value="${aiCfg.apiKey || ''}" placeholder="可选：输入你自己的 API Key（仅存本机 localStorage）" />
        <div class="action-btn-grid">
          <button type="button" class="action-link-btn primary-action" id="btnRunOnlineAI">🤖 运行在线 AI 分析</button>
          <button type="button" class="action-link-btn" id="btnCopyTastePrompt">📋 免Key复制画像提示词</button>
        </div>
        ${cachedAIHTML}
      </div>
    `;

    document.getElementById('btnCopyTastePrompt')?.addEventListener('click', () => {
      playSelectSound();
      const promptText = buildTastePromptText();
      navigator.clipboard
        .writeText(promptText)
        .then(() => showToast('✅ 已复制饮食画像提示词，可直接发给任意 AI 分析'))
        .catch(() => showToast('⚠️ 复制失败，请检查浏览器剪贴板权限'));
    });

    document.getElementById('btnRunOnlineAI')?.addEventListener('click', runOnlineAIAnalysis);
  }

  async function runOnlineAIAnalysis() {
    const baseUrl = (document.getElementById('aiBaseUrlInput')?.value || '').trim().replace(/\/+$/, '');
    const model = (document.getElementById('aiModelInput')?.value || '').trim() || 'deepseek-chat';
    const apiKey = (document.getElementById('aiKeyInput')?.value || '').trim();
    const resultEl = document.getElementById('tasteAiResult');
    const runBtn = document.getElementById('btnRunOnlineAI');

    saveAIConfig({ baseUrl, model, apiKey });

    if (!baseUrl || !apiKey) {
      showToast('💡 请先填入 API 地址与 Key，或点右侧「免Key复制画像提示词」');
      return;
    }

    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = '⏳ AI 正在分析中...';
    }
    if (resultEl) {
      resultEl.style.color = '#e2e8f0';
      resultEl.textContent = '正在连接在线 AI 接口分析你的饮食画像与营养均衡度，请稍候...';
    }

    try {
      const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是一位专业、亲切的中文营养师与美食顾问。回答清晰分点，控制在350字以内。' },
            { role: 'user', content: buildTastePromptText() }
          ],
          temperature: 0.7
        })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${errText.slice(0, 80)}`);
      }
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error('接口未返回有效分析文本');

      tasteProfile.aiAnalysisText = reply;
      tasteProfile.aiAnalysisTime = new Date().toLocaleString();
      saveTasteProfile();

      if (resultEl) {
        resultEl.style.color = '#f1f5f9';
        resultEl.textContent = reply;
      }
      showToast('✨ 在线 AI 深度饮食分析已完成并缓存在本地');
    } catch (err) {
      if (resultEl) {
        resultEl.style.color = '#fda4af';
        resultEl.textContent = `调用失败：${err.message}\n\n提示：部分模型接口可能受浏览器跨域(CORS)限制，你也可以直接点击上方「📋 免Key复制画像提示词」粘贴到任意 AI 对话中获得同样深度分析。`;
      }
    } finally {
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = '🤖 运行在线 AI 分析';
      }
    }
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
  // 9. 历史记录胶囊与事件监听
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
      historyList.innerHTML = `<span class="history-empty">暂无记录 · 抽中的美食会出现在这里</span>`;
      return;
    }

    historyList.innerHTML = state.history
      .map(
        (item, idx) => `
        <span class="history-pill ${state.currentDish?.name === item.dish.name ? 'active-pill' : ''}" data-idx="${idx}" title="点击回看该美食">
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
        cook: { emoji: '🍳', title: '准备抽取今日食谱', mode: '含本土食材平替' },
        lazy: { emoji: '⚡', title: '准备抽取懒人快手菜', mode: '电饭煲/炸锅/10分钟' },
        takeout: { emoji: '🛵', title: '准备抽取周边外卖店铺', mode: '支持星级评价展示' },
        guess: { emoji: '❤️', title: '猜你喜欢 · 专属抽选', mode: '本地饮食画像智能匹配' }
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
            <span class="badge badge-cuisine">${state.cuisine === 'all' ? '全菜系随机' : state.cuisine}</span>
            <span class="badge badge-mode">${hint.mode}</span>
            <span class="badge badge-flavor">点击下方抽卡</span>
          </div>
        </div>
      `;
      syncUI();
      renderHistoryList();

      // 切换到点外卖时，直接由用户点击触发浏览器位置授权弹窗
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
    if (state.location.ready) {
      scanNearbyShops(true);
    } else {
      requestBrowserLocation();
    }
  });

  btnDraw.addEventListener('click', () => {
    if (state.mode === 'takeout' && !state.location.ready) {
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
    const aKey = (amapKeyInput?.value || '').trim();

    state.googleKey = gKey;
    state.hotpepperKey = hKey;
    state.amapKey = aKey;

    if (gKey) localStorage.setItem('food_rec_google_key', gKey);
    else localStorage.removeItem('food_rec_google_key');

    if (hKey) localStorage.setItem('food_rec_hotpepper_key', hKey);
    else localStorage.removeItem('food_rec_hotpepper_key');

    if (aKey) localStorage.setItem('food_rec_amap_key', aKey);
    else localStorage.removeItem('food_rec_amap_key');

    closeSourceModal();
    const enabled = [gKey && 'Google星级', hKey && '日本HotPepper', aKey && '高德评分'].filter(Boolean);
    showToast(enabled.length > 0 ? `✅ 已保存并启用：${enabled.join(' + ')}` : '✅ 已切换至免Key默认周边扫描');
    if (state.location.ready) scanNearbyShops(true);
    else if (state.mode === 'takeout') requestBrowserLocation();
  });

  btnResetSource.addEventListener('click', () => {
    state.googleKey = '';
    state.hotpepperKey = '';
    state.amapKey = '';
    if (googleKeyInput) googleKeyInput.value = '';
    if (hotpepperKeyInput) hotpepperKeyInput.value = '';
    if (amapKeyInput) amapKeyInput.value = '';
    localStorage.removeItem('food_rec_google_key');
    localStorage.removeItem('food_rec_hotpepper_key');
    localStorage.removeItem('food_rec_amap_key');
    closeSourceModal();
    showToast('🔄 已清空本地 API Key，恢复默认周边扫描');
    if (state.location.ready) scanNearbyShops(true);
  });

  // 离线习惯画像 & 在线 AI 分析事件绑定
  document.querySelectorAll('.btn-open-taste').forEach(btn => {
    btn.addEventListener('click', openTasteModal);
  });
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
    a.download = `my-food-taste-profile-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📤 已导出你的本地饮食习惯备份文件（JSON）');
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
        if (typeof parsed !== 'object' || !parsed.cuisineScores) {
          throw new Error('文件格式不正确');
        }
        tasteProfile = { ...createEmptyTasteProfile(), ...parsed };
        saveTasteProfile();
        renderTasteModalContent();
        syncUI();
        showToast('📥 饮食习惯画像已成功导入并恢复！');
      } catch (_) {
        showToast('⚠️ 导入失败：请选择本应用导出的 JSON 备份文件');
      }
      tasteImportFile.value = '';
    };
    reader.readAsText(file);
  });

  btnClearTaste?.addEventListener('click', () => {
    playSelectSound();
    if (!confirm('确定清空本地保存的所有饮食习惯记录吗？清空前建议先导出备份。')) return;
    tasteProfile = createEmptyTasteProfile();
    saveTasteProfile();
    renderTasteModalContent();
    syncUI();
    showToast('🗑️ 本地饮食习惯画像已重置');
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

  // 初始化
  syncUI();
})();
