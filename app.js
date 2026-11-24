(function () {
  const aiCuratedDishes = window.AI_CURATED_DATA || [];
  const localSubstitutions = window.LOCAL_SUBSTITUTIONS || [];

  // 解析中文/阿拉伯数字并从所有步骤中真实累计烹饪耗时（避免“预计15分钟”却要“小火炖50分钟”的矛盾！）
  function parseChineseOrArabicNum(raw) {
    const s = String(raw || '').trim();
    if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
    if (s === '半') return 0.5;
    const map = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (s === '十') return 10;
    if (s.includes('十')) {
      const [l, r] = s.split('十');
      const tens = l ? (map[l] || 1) * 10 : 10;
      const ones = r ? (map[r] || 0) : 0;
      return tens + ones;
    }
    return map[s] || 0;
  }

  function computeActualDishMinutes(dish) {
    const steps = dish.steps || [];
    let stepSumMin = 0;
    let hasOvernight = false;

    for (const rawStep of steps) {
      const text = String(rawStep || '');
      if (/(过夜|隔夜|一夜|冷藏.*小时|发酵.*小时|泡发.*小时)/.test(text)) {
        hasOvernight = true;
        continue;
      }
      // 同一句里若重复提到相同时间（如“小火50分钟（上图是熬完50分钟的效果）”），只取该步最大一次主耗时
      let stepMaxMin = 0;
      const timeRe = /([0-9.一二两三四五六七八九十半]+)(?:\s*[-~～至到]\s*([0-9.一二两三四五六七八九十]+))?\s*(小时|个半小时|分钟|分|秒)/g;
      let m;
      while ((m = timeRe.exec(text)) !== null) {
        let v1 = parseChineseOrArabicNum(m[1]);
        let v2 = m[2] ? parseChineseOrArabicNum(m[2]) : v1;
        const unit = m[3];
        if (!v1 && unit !== '个半小时') continue;
        let mins = (v1 + v2) / 2;
        if (unit === '个半小时') mins = (v1 + 0.5) * 60;
        else if (unit === '小时') mins = mins * 60;
        else if (unit === '秒') mins = mins / 60;
        if (mins > 240) continue; // 排除极端腌制/发酵时长
        if (mins > stepMaxMin) stepMaxMin = mins;
      }
      stepSumMin += stepMaxMin;
    }

    // 备菜与基础操作时间
    const prepMin = Math.min(12, Math.max(4, Math.round(steps.length * 1.2)));
    const totalMin = stepSumMin > 0 ? Math.round(stepSumMin + prepMin) : 0;
    return { totalMin, stepSumMin: Math.round(stepSumMin), hasOvernight };
  }

  function formatEstimatedTime(totalMin, fallbackTime, hasOvernight) {
    if (!totalMin || totalMin <= 0) return fallbackTime || '约 15~20 分钟';
    let label = '';
    if (totalMin <= 12) {
      label = '约 10~15 分钟';
    } else if (totalMin < 60) {
      const rounded = Math.round(totalMin / 5) * 5;
      label = `约 ${rounded} 分钟`;
    } else {
      const hrs = Math.floor(totalMin / 60);
      const rem = Math.round((totalMin % 60) / 5) * 5;
      if (rem >= 60) label = `约 ${hrs + 1} 小时`;
      else if (rem > 0) label = `约 ${hrs}小时${rem}分钟`;
      else label = `约 ${hrs} 小时`;
    }
    return hasOvernight ? `${label}（需提前泡发/腌制）` : label;
  }

  // 严格的「⚡ 懒人专区」三维度筛选标准：食材简单易获得（≤7项且无冷门难处理料）+ 做法简单（≤4步且无揉面/油炸/复杂工序）+ 时间短（≤18分钟）
  const hardIngredientRe = /(鲍鱼|海参|花胶|燕窝|人参|鹿茸|党参|当归|沙参|玉竹|茯苓|芡实|石斛|罗氏虾|龙虾|螃蟹|大闸蟹|田螺|牛蛙|甲鱼|鹅肝|松露|鱼子酱|羊排|牛尾|牛腱|牛腩|猪蹄|猪肚|肥肠|腰花|猪肝|猪心|整鸡|整鸭|鳝鱼|泥鳅|黄鳝|兔肉|鸽子|排骨|蹄髈|肘子|老鸭|柴鸡)/;
  const hardTechniqueRe = /(揉面|醒面|发面|发酵|擀皮|擀面|和面|扯面|宽油|复炸|油炸|小酥肉|起酥|炒糖色|熬糖|去骨|剔骨|片鱼|剁馅|打发|裱花|过筛|熬高汤|卤制|烟熏|腌制.*小时|泡发|醒发|水浴|蒸卤面|蒸面条)/;
  const quickLazyNameRe = /(微波炉|空气炸锅|懒人|快手|泡面|方便面|拌面|蛋炒饭|炒饭|盖饭|丼|饭团|三明治|吐司|贝果|燕麦|蒸蛋|鸡蛋羹|荷包蛋|太阳蛋|煎蛋|炒蛋|手抓饼|煎饼|速冻|水饺|馄饨|抄手|凉拌|葱油拌面|番茄炒蛋|西红柿炒鸡蛋|煮面|酸辣粉|螺蛳粉)/;

  function detectLazyTool(d, actualMin) {
    if (d.lazyTool && actualMin > 0 && actualMin <= 18) return d.lazyTool;
    if (d.name.includes('微波炉')) return '📻 微波炉5分钟';
    if (d.name.includes('空气炸锅')) return '🍟 空气炸锅免看火';
    if (d.name.includes('电饭煲') || d.name.includes('焖饭')) return '🍚 电饭煲一键出';
    if (/(凉拌|沙拉|三明治|吐司|燕麦|饭团|拍黄瓜|皮蛋)/.test(d.name)) return '🥗 免开火快手';
    return actualMin > 0 && actualMin <= 12 ? '⚡ 10分钟快手' : '⚡ 15分钟快手';
  }

  function isTrueLazyDish(d, totalMin, hasOvernight) {
    if (hasOvernight) return false;
    const ings = (d.ingredients || []).filter(x => x && !/^#/.test(String(x).trim()));
    const steps = d.steps || [];
    const combinedText = `${d.name} ${ings.join(' ')} ${steps.join(' ')}`;

    // 1. 食材必须简单易得：≤ 7 项，且不含冷门/难处理大硬菜
    if (ings.length === 0 || ings.length > 7) return false;
    if (hardIngredientRe.test(combinedText)) return false;

    // 2. 做法必须简单：≤ 4 步，且无油炸/揉面/复杂工序
    if (steps.length === 0 || steps.length > 4) return false;
    if (hardTechniqueRe.test(combinedText)) return false;

    // 3. 时间必须短：真实耗时 ≤ 18 分钟（微波炉/空气炸锅免看火放宽至 22 分钟）
    const isAppliance = /(微波炉|空气炸锅)/.test(d.name);
    const maxMin = isAppliance ? 22 : 18;
    if (totalMin > maxMin) return false;

    // 满足快手菜名，或超精简（≤6食材 且 ≤4步 且 ≤15分钟）
    return quickLazyNameRe.test(d.name) || (ings.length <= 6 && steps.length <= 4 && (totalMin === 0 || totalMin <= 15));
  }

  const aiNames = new Set(aiCuratedDishes.map(d => d.name));
  const processedAi = aiCuratedDishes.map(d => {
    const { totalMin, stepSumMin, hasOvernight } = computeActualDishMinutes(d);
    const modes = (d.modes || []).filter(m => m !== 'lazy');
    const keepLazy = d.modes?.includes('lazy') && !hasOvernight && (d.ingredients || []).length <= 8 && (totalMin === 0 || totalMin <= 20);
    if (keepLazy) modes.push('lazy');
    return {
      ...d,
      modes,
      lazyTool: keepLazy ? (d.lazyTool || detectLazyTool(d, totalMin)) : '',
      time: stepSumMin >= 5 && !d.time ? formatEstimatedTime(totalMin, d.time, hasOvernight) : d.time
    };
  });

  const mergedBase = (window.DISHES_DATA || [])
    .filter(d => !aiNames.has(d.name))
    .map(d => {
      if (d.modes && d.modes.includes('cook')) {
        const { totalMin, stepSumMin, hasOvernight } = computeActualDishMinutes(d);
        const accurateTime = stepSumMin >= 5 ? formatEstimatedTime(totalMin, d.time, hasOvernight) : (d.time || '约 15 分钟');
        const isLazy = isTrueLazyDish(d, totalMin, hasOvernight);

        const updated = { ...d, time: accurateTime };
        if (isLazy) {
          updated.modes = Array.from(new Set([...d.modes, 'lazy']));
          updated.lazyTool = detectLazyTool(d, totalMin);
        }
        return updated;
      }
      return d;
    });

  const staticDishes = [...processedAi, ...mergedBase];
  const CARD_HEIGHT = 196;

  // 当前三步状态
  const state = {
    meal: 'breakfast',   // 'breakfast' | 'lunch' | 'dinner'
    mode: 'cook',        // 'cook' | 'lazy' | 'takeout' | 'guess'
    cuisine: 'all',      // 'all' | 'AI精选' | specific cuisine name
    isSpinning: false,
    currentDish: null,
    displayedPoolCount: 0,
    history: []
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

  // 离线习惯画像弹窗 DOM
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
  // 4. 候选池计算 & 菜系角标 & 数字滚动
  // =========================================================================
  function getGuessPool() {
    const candidates = [];
    const seen = new Set();

    const pushIfValid = item => {
      if (!item || !item.name || seen.has(item.name)) return;
      if (state.cuisine !== 'all' && state.cuisine !== 'AI精选' && item.cuisine !== state.cuisine) return;
      if (state.cuisine === 'AI精选' && !item.aiPick) return;
      seen.add(item.name);
      candidates.push(item);
    };

    // 纳入当前餐段的菜品（家常菜 / 懒人菜 / 外卖）
    for (const d of staticDishes) {
      if (d.meals?.includes(state.meal)) {
        pushIfValid(d);
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
    const unit = state.mode === 'guess' ? '道精选' : '道';

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
      } else {
        dockIdleText.textContent = '🛵 点外卖已就绪：抽中后一键带关键词跳转高德 / 百度 / 美团 / 饿了么搜周边';
      }
    }
  }

  // =========================================================================
  // 6. 滚轮卡片渲染 & 零闪烁老虎机引擎
  // =========================================================================
  function createReelCardHTML(item) {
    const titleClass = item.name.length > 10 ? 'dish-name combo-title' : 'dish-name';
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

  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|HarmonyOS|Mobile/i.test(navigator.userAgent || '');
  }

  function isIOSDevice() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }

  // 手机端优先尝试直达原生 App（URL Scheme），1.2 秒未拉起则自动回退网页搜索；电脑端直接开网页版
  function openAppWithFallback(e, appSchemeUrl, webFallbackUrl, copyTarget, appName) {
    playSelectSound();
    if (copyTarget) {
      silentCopyText(copyTarget, `✅ 已复制「${copyTarget}」，正在打开${appName}`);
    }
    if (!isMobileDevice() || !appSchemeUrl) {
      return; // 电脑端或 Universal Link 走原生 <a target="_blank">
    }

    e.preventDefault();
    let appOpened = false;
    const onHide = () => {
      if (document.hidden) appOpened = true;
    };
    document.addEventListener('visibilitychange', onHide, { once: true });

    window.location.href = appSchemeUrl;

    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      if (!appOpened && !document.hidden) {
        window.open(webFallbackUrl, '_blank', 'noopener,noreferrer') || (window.location.href = webFallbackUrl);
      }
    }, 1200);
  }

  // 提纯搜索关键词：去掉多个竞品品牌空格叠加（如“三米粥铺 曼玲粥”只取“三米粥铺”）与加号套餐名，避免地图/外卖搜出0结果
  function extractPrimaryKeyword(item) {
    const rawKw = String(item.searchKeyword || item.name || '').trim();
    const firstToken = rawKw.split(/[\s+/、，,]+/).filter(Boolean)[0] || rawKw;
    return firstToken.replace(/(套餐|双拼|单人餐)$/, '').trim() || rawKw;
  }

  function buildTakeoutLinks(item) {
    const primaryKw = extractPrimaryKeyword(item);
    const encodedKw = encodeURIComponent(primaryKw);
    const mobile = isMobileDevice();

    // 纯关键词直达：定位完全交给用户自己的地图 / 外卖 App，不请求浏览器位置权限，不走任何代理接口
    const mapUrl = `https://ditu.amap.com/search?query=${encodedKw}`;
    const mapScheme = isIOSDevice()
      ? `iosamap://poi?sourceApplication=whattoeat&name=${encodedKw}`
      : `androidamap://poi?sourceApplication=whattoeat&keywords=${encodedKw}&dev=0`;
    const baiduMapUrl = `https://map.baidu.com/search/${encodedKw}/`;

    return {
      cleanKeyword: primaryKw,
      mapLabel: '🗺️ 高德地图',
      mapUrl,
      mapScheme,
      // 手机端：点美团/饿了么直达原生 App（未装 App 回退百度地图搜关键词）；电脑端走百度地图 & 百度外卖搜索
      primaryDeliveryLabel: mobile ? '🛵 美团App' : '🗺️ 百度地图',
      primaryDeliveryUrl: baiduMapUrl,
      primaryDeliveryScheme: mobile ? `imeituan://www.meituan.com/search?q=${encodedKw}` : '',
      secondaryDeliveryLabel: mobile ? '🔵 饿了么App' : '🔍 搜周边外卖',
      secondaryDeliveryUrl: `https://www.baidu.com/s?wd=${encodeURIComponent(`${primaryKw} 外卖`)}`,
      secondaryDeliveryScheme: mobile ? `eleme://search?keyword=${encodedKw}` : ''
    };
  }

  function silentCopyText(text, toastMsg) {
    if (navigator.clipboard && text) {
      navigator.clipboard.writeText(text).then(() => {
        if (toastMsg) showToast(toastMsg);
      }).catch(() => {});
    }
  }

  function getOriginalRecipeUrl(dish) {
    if (dish && dish.recipePath) {
      const encodedPath = dish.recipePath.split('/').map(encodeURIComponent).join('/');
      return {
        url: `https://github.com/Anduin2017/HowToCook/blob/master/${encodedPath}`,
        isOriginal: true,
        label: '📖 原版开源图文'
      };
    }
    return {
      url: `https://www.xiachufang.com/search/?keyword=${encodeURIComponent(dish?.name || '')}`,
      isOriginal: false,
      label: '🔍 搜下厨房图文'
    };
  }

  function getBiliVideoUrl(dish) {
    if (dish && dish.bv) {
      return {
        url: `https://www.bilibili.com/video/${encodeURIComponent(dish.bv)}`,
        isOriginal: true,
        label: '📺 B站原版视频'
      };
    }
    return {
      url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(`${dish?.name || ''} 做法`)}`,
      isOriginal: false,
      label: '🔍 搜B站视频'
    };
  }

  function renderResultDock(item) {
    const isShopOrTakeout = item.isRealShop || (item.modes?.includes('takeout') && !item.modes?.includes('cook'));

    if (!isShopOrTakeout) {
      const modeIcon = state.mode === 'guess' ? '❤️' : (state.mode === 'lazy' ? '⚡' : '🍳');
      const matchedSubs = getDishSubstitutions(item.ingredients || []);
      const subBadgeText = matchedSubs.length > 0 ? ` · ${matchedSubs.length}项平替` : '';
      const videoInfo = getBiliVideoUrl(item);

      resultActionContent.innerHTML = `
        <div class="action-panel-header">
          <span>${modeIcon} 「<strong>${item.name}</strong>」· ${item.time || '约15分'}${subBadgeText}</span>
          <div class="dock-header-right">
            ${buildFeedbackHTML(item)}
          </div>
        </div>
        <div class="action-btn-grid cols-3">
          <button type="button" class="action-link-btn primary-action" id="btnOpenRecipeModal">
            📖 查看食谱
          </button>
          <a href="${videoInfo.url}" target="_blank" rel="noopener noreferrer" class="action-link-btn video-action" id="btnOpenVideoQuick">
            ${videoInfo.label}
          </a>
          <button type="button" class="action-link-btn" id="btnCopyRecipeQuick">
            📋 复制清单
          </button>
        </div>
      `;

      document.getElementById('btnOpenRecipeModal')?.addEventListener('click', () => openRecipeModal(item));
      document.getElementById('btnOpenVideoQuick')?.addEventListener('click', () => {
        playSelectSound();
        recordTasteSignal('open_detail', { item });
      });
      document.getElementById('btnCopyRecipeQuick')?.addEventListener('click', () => copyRecipeToClipboard(item));
      bindFeedbackEvents(item);
    } else {
      const links = buildTakeoutLinks(item);
      const copyTarget = links.cleanKeyword || item.searchKeyword || item.name;

      resultActionContent.innerHTML = `
        <div class="action-panel-header">
          <span>🛵 「<strong>${item.name}</strong>」· 搜索词：${copyTarget}</span>
          <div class="dock-header-right">
            ${buildFeedbackHTML(item)}
          </div>
        </div>
        <div class="action-btn-grid cols-3">
          <button type="button" class="action-link-btn primary-action" id="btnOpenShopModal">
            🛵 下单与搜周边
          </button>
          <a href="${links.mapUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn map-action" id="btnJumpMapQuick">
            ${links.mapLabel}
          </a>
          <a href="${links.primaryDeliveryUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn meituan-action" id="btnJumpDeliveryQuick">
            ${links.primaryDeliveryLabel}
          </a>
        </div>
      `;

      document.getElementById('btnOpenShopModal')?.addEventListener('click', () => openShopModal(item));
      document.getElementById('btnJumpMapQuick')?.addEventListener('click', e => {
        recordTasteSignal('open_detail', { item });
        openAppWithFallback(e, links.mapScheme, links.mapUrl, '', links.mapLabel);
      });
      document.getElementById('btnJumpDeliveryQuick')?.addEventListener('click', e => {
        recordTasteSignal('copy', { item });
        openAppWithFallback(e, links.primaryDeliveryScheme, links.primaryDeliveryUrl, copyTarget, links.primaryDeliveryLabel);
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

    const timeMatch = stepText.match(/([0-9一二两三四五六七八九十半]+(?:\s*[-~～至到]\s*[0-9一二两三四五六七八九十]+)?\s*(?:分钟|秒|小时))/);
    if (timeMatch) time = `🕒 ${timeMatch[1].replace(/\s+/g, '')}`;

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

  // =========================================================================
  // 8.0. 智能食材用量精准量化引擎（告别“少许/适量”，支持 1/2/4 人份实时换算）
  // =========================================================================
  const VAGUE_AMOUNT_REGEX = /^(?:适量|少许|少量|若干|一点点|一点|些许|适当|酌量|看着放|随意|个人口味|根据口味|按口味|按个人口味|根据喜好|一块|一小块|一把|一小把|一撮|一小撮|几片|几瓣|几粒|几根|几滴|几颗|半碗|一碗|少许调味|适量即可|少许即可)$/;

  function estimateConcreteDosage(ingName, origAmount, dish) {
    const n = String(ingName || '').trim();
    const dName = `${dish?.name || ''} ${dish?.tag || ''}`;
    const isSoup = /(汤|煲|炖|粥|焖|煮|火锅|冒菜|砂锅|老火)/.test(dName);
    const isSweetSour = /(糖醋|红烧|卤|可乐|拔丝|蜜汁|鱼香|酸甜|甜)/.test(dName);
    const isSourSpicy = /(酸辣|醋溜|凉拌|口水|糖醋|老醋|酸菜)/.test(dName);
    const isFrying = /(炸|酥|煎|锅包|干煸|拔丝|烤)/.test(dName);
    const isLittle = /(少许|少量|一点|些许|几滴|一撮)/.test(origAmount || '');

    // 1. 煲汤滋补药材 & 干货（精准到克 + 直观参考）
    if (/(枸杞)/.test(n)) return '10克 (约25粒)';
    if (/(陈皮)/.test(n)) return '5克 (约1瓣)';
    if (/(当归|黄芪|党参|太子参|人参|西洋参)/.test(n)) return '10克';
    if (/(百合|莲子|茯苓|芡实|玉竹|沙参|麦冬|石斛|薏米|芡实|淮山干|干山药|莲藕干|海底椰|无花果干|南北杏)/.test(n)) {
      return isLittle ? '12克 (约1小把)' : '15克 (约1小把)';
    }
    if (/(红枣|黑枣|蜜枣|桂圆|龙眼)/.test(n)) return '5颗 (约20克)';
    if (/(干香菇|干木耳|木耳|银耳|虫草花|竹荪|茶树菇|花菇|干贝|瑶柱)/.test(n)) return '15克 (干重)';
    if (/(虾皮|紫菜|海带丝|海苔)/.test(n)) return '10克 (约1小把)';

    // 2. 基础调味品（精确到克 / 毫升 + 家用餐勺：1小勺≈5g/5ml，1大勺≈15ml）
    if (/(^盐$|食盐|精盐|海盐|细盐|岩盐|椒盐)/.test(n)) {
      if (n.includes('椒盐')) return '3克 (约1/2小勺)';
      if (isLittle) return '1.5克 (约1/3小勺)';
      return isSoup ? '4克 (约3/4小勺)' : '3克 (约1/2小勺)';
    }
    if (/(鸡精|味精|鸡粉|松鲜鲜|蘑菇精|蔬之鲜)/.test(n)) return '2克 (约1/3小勺)';
    if (/(冰糖)/.test(n)) return isSweetSour ? '20克 (约8颗)' : '10克 (约4颗)';
    if (/(白糖|绵白糖|细砂糖|红糖|砂糖|代糖|^糖$)/.test(n)) {
      if (isSweetSour) return '15克 (1大勺)';
      return isLittle ? '3克 (约1/2小勺)' : '5克 (1小勺)';
    }
    if (/(老抽)/.test(n)) return isLittle ? '3ml (约1/2小勺)' : '5ml (1小勺)';
    if (/(生抽|酱油|味极鲜|蒸鱼豉油|薄盐酱油|一品鲜)/.test(n)) {
      return isLittle ? '8ml (1/2大勺)' : '15ml (1大勺)';
    }
    if (/(蚝油|耗油)/.test(n)) return isLittle ? '8克 (1/2大勺)' : '15克 (1大勺)';
    if (/(料酒|黄酒|花雕|米酒|清酒|味淋|味霖)/.test(n)) {
      return isLittle ? '8ml (1/2大勺)' : '15ml (1大勺)';
    }
    if (/(醋|陈醋|米醋|香醋|白醋|果醋)/.test(n)) {
      if (isSourSpicy) return '25ml (约2大勺)';
      return isLittle ? '5ml (1小勺)' : '10ml (2小勺)';
    }
    if (/(香油|芝麻油|花椒油|红油|辣椒油|藤椒油|葱油|蒜油)/.test(n)) return '5ml (1小勺)';
    if (/(黄油|牛油)/.test(n)) return '15克 (约1小块)';
    if (/(食用油|植物油|花生油|菜籽油|玉米油|橄榄油|色拉油|猪油|调和油|^油$)/.test(n)) {
      if (isLittle) return '10ml (约2小勺)';
      return isFrying ? '30ml (2大勺)' : '15ml (1大勺)';
    }
    if (/(豆瓣酱|郫县豆瓣|黄豆酱|甜面酱|沙茶酱|柱侯酱|叉烧酱|照烧酱|韩式辣酱|番茄酱|沙拉酱|蛋黄酱|芝麻酱|花生酱|黑椒酱|豆豉|老干妈)/.test(n)) {
      return '15克 (1大勺)';
    }
    if (/(淀粉|玉米淀粉|生粉|红薯淀粉|土豆淀粉|太白粉|勾芡)/.test(n)) {
      return isLittle ? '5克 (1小勺)' : '10克 (约1大勺)';
    }
    if (/(黑胡椒|白胡椒|胡椒粉|五香粉|十三香|孜然粉|孜然粒|辣椒粉|辣椒面|花椒粉|花椒面|咖喱粉|姜黄粉|肉桂粉|小苏打|泡打粉|酵母)/.test(n)) {
      return '2克 (约1/3小勺)';
    }
    if (/(蜂蜜|炼乳|枫糖|糖浆)/.test(n)) return '15克 (1大勺)';
    if (/(芝麻|白芝麻|黑芝麻)/.test(n)) return '5克 (1小勺)';
    if (/(柠檬汁)/.test(n)) return '10ml (约半个柠檬)';

    // 3. 葱姜蒜 & 辛香料
    if (/(葱姜蒜|葱、姜、蒜)/.test(n)) return '葱2根+姜4片+蒜3瓣';
    if (/(葱姜)/.test(n)) return '葱2根+姜4片';
    if (/(葱结|小葱挽成结)/.test(n)) return '20克 (3根小葱)';
    if (/(大葱|葱白|京葱)/.test(n)) return '30克 (约半根)';
    if (/(葱花|小葱|香葱|葱末|葱段|^葱$)/.test(n)) return '15克 (约2根)';
    if (/(生姜|老姜|子姜|姜片|姜丝|姜末|姜蓉|^姜$)/.test(n)) return '15克 (约4~5片)';
    if (/(大蒜|蒜头|蒜瓣|蒜末|蒜片|蒜泥|蒜蓉|^蒜$)/.test(n)) return '15克 (约3~4瓣)';
    if (/(香菜|芫荽)/.test(n)) return '15克 (约2棵)';
    if (/(小米辣|小米椒|朝天椒|泰椒|指天椒)/.test(n)) return '3根 (约10克)';
    if (/(干辣椒|辣椒段)/.test(n)) return '5个 (约5克)';
    if (/(花椒|麻椒|青花椒)/.test(n)) return '3克 (约20粒)';
    if (/(八角|大料)/.test(n)) return '2颗 (约3克)';
    if (/(桂皮)/.test(n)) return '1小段 (约4克)';
    if (/(香叶)/.test(n)) return '2~3片';
    if (/(草果|白蔻|肉蔻|丁香|小茴香|山奈|良姜|砂仁|罗勒|迷迭香|百里香|欧芹|薄荷)/.test(n)) return '3克';

    // 4. 液体类（水 / 高汤 / 奶 / 酒）
    if (/(^水$|清水|开水|温水|冷水|热水|凉白开|纯净水|饮用水)/.test(n)) {
      if (isLittle) return '50ml (约3大勺)';
      return isSoup ? '700ml (约3碗)' : '80ml (约1/3碗)';
    }
    if (/(高汤|鸡汤|骨汤|昆布汤|出汁)/.test(n)) return '500ml (约2碗)';
    if (/(牛奶|纯牛奶|淡奶油|椰浆|椰奶|豆浆)/.test(n)) return '150ml';
    if (/(啤酒|可乐|雪碧)/.test(n)) return '330ml (1听)';

    // 5. 蛋肉海鲜 & 豆制品
    if (/(鹌鹑蛋)/.test(n)) return '8个 (约80克)';
    if (/(皮蛋|松花蛋|咸鸭蛋)/.test(n)) return '2个';
    if (/(鸡蛋|土鸡蛋|鸭蛋|^蛋$)/.test(n)) return '2个 (约100克)';
    if (/(蛋黄|蛋清|蛋白)/.test(n)) return '1个';
    if (/(五花肉|猪肉|里脊|梅花肉|瘦肉|肉末|肉馅|肉丝|肉片|排骨|牛肉|牛腩|肥牛|羊肉|鸡肉|鸡胸|鸡腿|鸡翅|鸭肉|猪蹄|猪肝|猪心|猪肚|肥肠|牛蛙)/.test(n)) {
      return '250克';
    }
    if (/(鲈鱼|鲤鱼|草鱼|鲫鱼|鳊鱼|黄花鱼|昂刺鱼|多宝鱼|鲳鱼|带鱼|三文鱼|鳕鱼|巴沙鱼|鱼片|鱼块|鱼肉)/.test(n)) {
      return /(鱼片|鱼块|鱼肉|三文鱼|鳕鱼|巴沙鱼)/.test(n) ? '250克' : '1条 (约500克)';
    }
    if (/(大虾|基围虾|明虾|虾仁|白虾|小龙虾|花蛤|文蛤|鱿鱼|墨鱼|鲍鱼|扇贝|生蚝|蟹|螃蟹)/.test(n)) {
      return '200克';
    }
    if (/(午餐肉|火腿|培根|香肠|腊肠|腊肉|烤肠|肉丸|鱼丸|虾滑|蟹棒)/.test(n)) return '120克';
    if (/(豆腐|嫩豆腐|老豆腐|内酯豆腐|千叶豆腐|豆干|香干|腐竹|千张|百叶|豆泡|油豆腐|面筋)/.test(n)) return '200克';

    // 6. 蔬菜菌菇 & 主食粮谷
    if (/(番茄|西红柿|土豆|马铃薯|洋葱|圆葱|黄瓜|青瓜|茄子|胡萝卜|白萝卜|青萝卜|苦瓜|丝瓜|西葫芦|青椒|红椒|彩椒|尖椒|线椒|杭椒|螺丝椒|玉米)/.test(n)) {
      return /(青椒|红椒|尖椒|线椒|杭椒|螺丝椒)/.test(n) ? '2根 (约80克)' : '1个 (约150克)';
    }
    if (/(白菜|娃娃菜|青菜|油菜|上海青|生菜|菠菜|油麦菜|空心菜|芥蓝|菜心|韭菜|芹菜|豆角|四季豆|豇豆|包菜|卷心菜|圆白菜|西兰花|花菜|菜花|豆芽|绿豆芽|黄豆芽|冬瓜|南瓜|山药|莲藕|笋|芦笋|秋葵|豌豆|毛豆|蒜苔|蒜苗|莴笋)/.test(n)) {
      return '200克';
    }
    if (/(香菇|平菇|金针菇|杏鲍菇|口蘑|白玉菇|蟹味菇|海鲜菇|猴头菇|茶树菇|鸡枞|菌)/.test(n)) return '120克';
    if (/(面粉|中筋面粉|低筋面粉|高筋面粉|糯米粉|玉米面|粘米粉|面包糠|脆炸粉)/.test(n)) {
      return /(饼|馒头|包子|饺子|面条|面包|蛋糕|发糕|窝头)/.test(dName) ? '200克' : '30克 (约2大勺)';
    }
    if (/(米饭|剩米饭)/.test(n)) return '1大碗 (约200克)';
    if (/(大米|糯米|小米|黑米|燕麦|藜麦|红豆|绿豆|黄豆|黑豆|花生米|花生|核桃|腰果|松子)/.test(n)) {
      return /(花生|核桃|腰果|松子)/.test(n) ? '30克 (约1小把)' : '100克';
    }
    if (/(面条|挂面|拉面|手擀面|乌冬|意面|通心粉|粉丝|粉条|宽粉|米粉|米线|河粉|年糕|饺子|馄饨|水饺)/.test(n)) {
      return '150克';
    }
    if (/(芝士|奶酪|马苏里拉|芝士片)/.test(n)) return '40克 (约2片)';

    // 7. 通用兜底（绝不输出抽象“适量/少许”）
    return isLittle ? '5克 (约1小勺)' : '20克 (约1小把)';
  }

  // 专业厨房非线性分量换算系数（菜量翻倍时，盐/酱/香料/底油/炖水绝不能机械等比翻倍！）
  function getCulinaryScaleProfile(ingName, baseFactor) {
    if (!baseFactor || baseFactor === 1) {
      return { factor: 1, label: '' };
    }
    const n = String(ingName || '').trim();

    // 1. 强辛香料、增香提色料（八角/花椒/香叶/干辣椒/胡椒/老抽/鸡精/香油等）：最易过冲，温和缩放
    if (/(八角|大料|桂皮|香叶|草果|豆蔻|丁香|小茴香|山奈|花椒|麻椒|干辣椒|小米辣|小米椒|辣椒面|辣椒粉|黑胡椒|白胡椒|胡椒粉|五香粉|十三香|孜然|咖喱粉|肉桂|老抽|香油|芝麻油|花椒油|藤椒油|鸡精|味精|松鲜鲜|酵母|泡打粉|小苏打)/.test(n)) {
      const f = baseFactor > 1 ? 1.4 : 0.7;
      return { factor: f, label: `强味香料非线性缩放 ×${f}（防过冲抢味）` };
    }

    // 2. 锅底油、爆香葱姜蒜、炖煮汤水（受锅底面积与蒸发率影响，非线性缩放）
    if (/(食用油|植物油|花生油|菜籽油|玉米油|橄榄油|色拉油|猪油|黄油|^油$|葱|姜|蒜|香菜|^水$|清水|开水|温水|冷水|高汤|骨汤)/.test(n)) {
      const f = baseFactor > 1 ? 1.5 : 0.65;
      return { factor: f, label: `底油/爆香料/汤水按锅面蒸发率缩放 ×${f}` };
    }

    // 3. 基础咸鲜酸甜调味（盐/生抽/酱油/蚝油/糖/醋/料酒/豆瓣酱等）：菜多一倍约需 1.65 倍，防过咸
    if (/(盐|生抽|酱油|味极鲜|豉油|蚝油|耗油|料酒|黄酒|花雕|米酒|清酒|味淋|醋|糖|冰糖|蜂蜜|豆瓣酱|黄豆酱|甜面酱|沙茶酱|柱侯酱|辣酱|番茄酱|沙拉酱|芝麻酱|豆豉|老干妈|淀粉|生粉|柠檬汁)/.test(n)) {
      const f = baseFactor > 1 ? 1.65 : 0.6;
      return { factor: f, label: `核心调味非线性缩放 ×${f}（防翻倍过咸）` };
    }

    // 4. 煲汤滋补干货/药材（适量温和放大，不完全死板翻倍）
    if (/(百合|莲子|茯苓|芡实|玉竹|沙参|党参|黄芪|当归|麦冬|石斛|枸杞|陈皮|太子参|红枣|黑枣|桂圆)/.test(n)) {
      const f = baseFactor > 1 ? 1.6 : 0.65;
      return { factor: f, label: `煲汤干货温和缩放 ×${f}（保汤味清润）` };
    }

    // 5. 主食材、蔬菜、蛋肉、主食：严格等比缩放
    return { factor: baseFactor, label: `主食材等比缩放 ×${baseFactor}` };
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

  function splitIngredientAndAmount(raw, dish, scaleFactor = 1) {
    let str = String(raw || '').trim();
    // 清理上游偶发注释与残缺前缀（如 "克盐"、"勺料酒"、"片姜"、"小葱*注：..."）
    str = str.replace(/\*注[:：].*$/, '').trim();

    let name = str;
    let amount = '';
    let wasVague = false;

    // 处理 "少许盐" / "适量生抽" / "少量鸡精调味" / "几滴柠檬汁" 等前缀模糊量词
    const vaguePrefix = str.match(/^(适量|少许|少量|若干|一点点|一点|些许|适当|酌量|几滴|几片|几瓣|几粒|几根|几颗|一小把|一把|一小块|一块|一小撮|一撮)\s*(.+)$/);
    if (vaguePrefix) {
      amount = vaguePrefix[1].trim();
      name = vaguePrefix[2].replace(/(调味|即可|左右)$/, '').trim();
      wasVague = true;
    } else {
      // 处理残缺前缀单位（如 "克盐" -> 盐、"勺生抽" -> 生抽、"瓣蒜" -> 蒜）
      const brokenUnitPrefix = str.match(/^[克勺片瓣个根粒滴段条棵]\s*([\u4e00-\u9fa5]{1,8})$/);
      if (brokenUnitPrefix) {
        name = brokenUnitPrefix[1].trim();
        amount = '适量';
        wasVague = true;
      } else {
        const calcMatch = str.match(/^(.+?)(?:的用量为|:|：|\s+)([0-9.\/~～\-一二三四五六七八九十半两]+\s*[a-zA-Z克千克斤两勺大勺小勺汤匙茶匙个只根片瓣块朵棵颗碗杯毫升升滴适量少许少量若干]+.*)$/);
        const tailVagueMatch = str.match(/^(.+?)(?:[:：]|\s+|按照|根据)(适量|少许|少量|若干|一点点|一点|些许|适当|酌量|个人口味|口味加?|喜好.*|一块|一小块|一把|一小把|一撮|一小撮|几片|几瓣|几粒|几根|几滴|几颗)$/);
        const prefixNumMatch = str.match(/^([0-9.\/~～\-一二三四五六七八九十半两]+\s*(?:g|kg|ml|L|克|千克|斤|两|个|只|根|片|瓣|勺|大勺|小勺|汤匙|茶匙|块|朵|棵|颗|碗|杯|盒|条|袋|包))\s*(.+)$/i);

        if (tailVagueMatch) {
          name = tailVagueMatch[1].trim();
          amount = tailVagueMatch[2].trim();
          wasVague = true;
        } else if (calcMatch) {
          name = calcMatch[1].trim();
          amount = calcMatch[2].trim();
          if (VAGUE_AMOUNT_REGEX.test(amount)) wasVague = true;
        } else if (prefixNumMatch) {
          amount = prefixNumMatch[1].trim();
          name = prefixNumMatch[2].trim();
          if (VAGUE_AMOUNT_REGEX.test(amount)) wasVague = true;
        } else {
          name = str;
          amount = '适量';
          wasVague = true;
        }
      }
    }

    const scaleProfile = getCulinaryScaleProfile(name || str, scaleFactor);

    // 如果仍是模糊词（少许/适量/一块/一把等），精准换算为具体克数/毫升/餐勺
    if (wasVague || !amount || VAGUE_AMOUNT_REGEX.test(amount)) {
      const concrete = estimateConcreteDosage(name, amount, dish);
      return {
        name: name || str,
        amount: scaleAmountString(concrete, scaleProfile.factor),
        quantified: true,
        origHint: amount && amount !== '适量' ? amount : '适量',
        scaleNote: scaleProfile.label
      };
    }

    return {
      name: name || str,
      amount: scaleAmountString(amount, scaleProfile.factor),
      quantified: false,
      origHint: '',
      scaleNote: scaleProfile.label
    };
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

  function buildIllustratedRecipeHTML(dish, scaleFactor = 1) {
    const ings = (dish.ingredients || []).filter(raw => {
      const t = String(raw || '').trim();
      return t && !/^#(主料|辅料|调料|食材)/.test(t);
    });
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
        const { name, amount, quantified, origHint, scaleNote } = splitIngredientAndAmount(rawIng, dish, scaleFactor);
        const subMark = hasIngredientSub(rawIng) ? `<span class="ing-sub-dot" title="下方有本土平替方案">可平替</span>` : '';
        const tipsArr = [];
        if (quantified) tipsArr.push(`原菜谱为「${origHint}」，已换算为具体家常用量`);
        if (scaleNote) tipsArr.push(scaleNote);
        const amountTitle = tipsArr.length ? `title="${tipsArr.join(' · ')}"` : '';
        return `
        <div class="ing-check-item" role="button" tabindex="0">
          <div class="ing-check-left">
            <span class="ing-checkbox">✓</span>
            <span class="ing-name">${name}</span>
            ${subMark}
          </div>
          <span class="ing-amount ${quantified ? 'quantified' : ''}" ${amountTitle}>${amount}</span>
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
          ${dish.recipePath ? `<span class="meta-pill" style="border-color:rgba(56,189,248,0.5);color:#7dd3fc;">📖 含原版开源图文</span>` : ''}
          ${dish.bv ? `<span class="meta-pill" style="border-color:rgba(251,114,153,0.5);color:#fbcfe8;">📺 含B站原版视频</span>` : ''}
          <span class="meta-pill">🕒 ${time}</span>
          <span class="meta-pill">🔥 难度 ${difficulty}</span>
          <span class="meta-pill">🛒 食材 ${ings.length} 项</span>
          <span class="meta-pill">📑 共 ${steps.length} 步</span>
        </div>
        ${introHTML}
        ${photoGalleryHTML}
      </div>

      <div>
        <div class="recipe-block-header" style="flex-wrap:wrap;">
          <span class="recipe-block-title">🛒 必备食材与精准用量</span>
          <div class="serving-scale-bar" role="group" aria-label="切换分量人数">
            <button type="button" class="serving-pill ${scaleFactor === 0.5 ? 'active' : ''}" data-scale="0.5">1人份</button>
            <button type="button" class="serving-pill ${scaleFactor === 1 ? 'active' : ''}" data-scale="1">2人份</button>
            <button type="button" class="serving-pill ${scaleFactor === 2 ? 'active' : ''}" data-scale="2">4人份</button>
          </div>
        </div>
        <div class="dosage-measure-hint">${
          scaleFactor === 1
            ? '📏 已将抽象“少许/适量”细化为具体克数与勺量（1小勺≈5g / 1大勺≈15ml）· 点击食材可勾选'
            : '👨‍🍳 已按烹饪非线性法则换算：主料等比缩放，盐/酱/香料/底油/炖水按厨房经验折减（防过咸、防呛味）'
        }</div>
        <div class="ing-checklist-grid">${ingredientsGridHTML}</div>
      </div>

      ${subGuideHTML}

      <div>
        <div class="recipe-block-header">
          <span class="recipe-block-title">⚡ 做法步骤详解</span>
          <span class="recipe-block-sub">点击步骤可标记完成</span>
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
        if (!dish) return;
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
    const scaleLabel = scale === 0.5 ? '1人份' : scale === 2 ? '4人份' : '2人份';
    const cleanIngs = (dish.ingredients || [])
      .filter(raw => {
        const t = String(raw || '').trim();
        return t && !/^#(主料|辅料|调料|食材)/.test(t);
      })
      .map(raw => {
        const { name, amount } = splitIngredientAndAmount(raw, dish, scale);
        return `- ${name}：${amount}`;
      });

    const lines = [
      `【${dish.name} · 详细食谱】(${dish.cuisine} · ${scaleLabel})`,
      `预计耗时：${dish.time || '约20分钟'} | 难度：${dish.difficulty || '★★★☆☆'}`,
      '',
      '🛒 必备食材与精准用量（1小勺≈5g，1大勺≈15ml）：',
      ...cleanIngs,
      '',
      '⚡ 详细做法步骤：',
      ...(dish.steps || []).map((s, idx) => `${idx + 1}. ${s}`)
    ];
    navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => showToast(`✅ 已复制「${dish.name}」(${scaleLabel}) 精准食材与步骤清单`))
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

    const currentScale = dish._servingScale || 1;
    modalBody.scrollTop = 0;
    modalBody.innerHTML = buildIllustratedRecipeHTML(dish, currentScale);
    bindRecipeInteractions(modalBody, dish);

    const origRecipeInfo = getOriginalRecipeUrl(dish);
    const videoInfo = getBiliVideoUrl(dish);
    modalFooter.style.gridTemplateColumns = 'repeat(3, 1fr)';
    modalFooter.innerHTML = `
      <a href="${origRecipeInfo.url}" target="_blank" rel="noopener noreferrer" class="action-link-btn primary-action" id="btnModalOrigRecipe">${origRecipeInfo.label}</a>
      <a href="${videoInfo.url}" target="_blank" rel="noopener noreferrer" class="action-link-btn video-action" id="btnModalVideo">${videoInfo.label}</a>
      <button type="button" class="action-link-btn" id="btnModalCopy">📋 复制清单</button>
    `;

    document.getElementById('btnModalCopy')?.addEventListener('click', () => copyRecipeToClipboard(dish));

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
          if (parsed.steps.length >= 2) {
            dish.steps = parsed.steps;
            const { totalMin, stepSumMin, hasOvernight } = computeActualDishMinutes(dish);
            if (stepSumMin >= 5) dish.time = formatEstimatedTime(totalMin, dish.time, hasOvernight);
          }
          if (parsed.tips.length >= 1) dish.tips = parsed.tips;
          if (parsed.intro) dish.intro = parsed.intro;
          if (parsed.difficulty) dish.difficulty = parsed.difficulty;
          if (parsed.images.length) {
            dish.images = Array.from(new Set([...(dish.images || []), ...parsed.images]));
          }
          dish._htcLoaded = true;
          if (recipeModal.classList.contains('open') && state.currentDish?.name === dish.name) {
            modalBody.innerHTML = buildIllustratedRecipeHTML(dish, dish._servingScale || 1);
            bindRecipeInteractions(modalBody, dish);
          }
        }
      } catch (_) {}
    }
  }

  // 点击「下单与搜周边」弹出本页外卖关键词直达弹窗
  function openShopModal(item) {
    playSelectSound();
    recordTasteSignal('open_detail', { item });
    const links = buildTakeoutLinks(item);
    const copyTarget = links.cleanKeyword || item.searchKeyword || item.name;

    modalEmoji.textContent = item.emoji || '🛵';
    modalDishName.textContent = item.name;
    modalTags.innerHTML = `
      <span class="badge badge-cuisine">${item.cuisine}</span>
      <span class="badge badge-mode">🛵 外卖点餐</span>
      <span class="badge badge-flavor">${item.tag || '人气推荐'}</span>
    `;

    const heroHTML = `
      <div class="recipe-hero-banner">
        <div class="recipe-meta-pills">
          <span class="meta-pill">🔍 搜索关键词：<strong>${copyTarget}</strong></span>
          <span class="meta-pill">📍 定位由你的地图 / 外卖软件自动获取</span>
        </div>
        <div class="recipe-intro-text">
          点击下方按钮将自动填入「<strong>${copyTarget}</strong>」并同步复制到剪贴板，打开高德 / 百度地图或美团 / 饿了么即可直接查看你当前定位周边的门店。
        </div>
      </div>
    `;

    const jumpBarHTML = `
      <div>
        <div class="recipe-block-header" style="margin-bottom:8px;">
          <span class="recipe-block-title">🚀 一键带关键词直达地图 / 外卖软件</span>
          <span class="recipe-block-sub">自动复制关键词，无需手动打字</span>
        </div>
        <div class="shop-jump-bar">
          <a href="${links.mapUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn map-action" id="btnModalJumpMap">${links.mapLabel}</a>
          <a href="${links.primaryDeliveryUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn meituan-action" id="btnModalJumpPrimary">${links.primaryDeliveryLabel}</a>
          <a href="${links.secondaryDeliveryUrl}" target="_blank" rel="noopener noreferrer" class="action-link-btn eleme-action" id="btnModalJumpSecondary">${links.secondaryDeliveryLabel}</a>
          <button type="button" class="action-link-btn" id="btnModalCopyInline">📋 复制关键词</button>
        </div>
      </div>
    `;

    modalBody.scrollTop = 0;
    modalBody.innerHTML = heroHTML + jumpBarHTML;

    document.getElementById('btnModalJumpMap')?.addEventListener('click', e => {
      recordTasteSignal('open_detail', { item });
      openAppWithFallback(e, links.mapScheme, links.mapUrl, copyTarget, links.mapLabel);
    });
    document.getElementById('btnModalJumpPrimary')?.addEventListener('click', e => {
      recordTasteSignal('copy', { item });
      openAppWithFallback(e, links.primaryDeliveryScheme, links.primaryDeliveryUrl, copyTarget, links.primaryDeliveryLabel);
    });
    document.getElementById('btnModalJumpSecondary')?.addEventListener('click', e => {
      recordTasteSignal('copy', { item });
      openAppWithFallback(e, links.secondaryDeliveryScheme, links.secondaryDeliveryUrl, copyTarget, links.secondaryDeliveryLabel);
    });
    document.getElementById('btnModalCopyInline')?.addEventListener('click', () => {
      playSelectSound();
      recordTasteSignal('copy', { item });
      silentCopyText(copyTarget, `✅ 已复制「${copyTarget}」`);
    });

    modalFooter.style.gridTemplateColumns = '1fr 1fr';
    modalFooter.innerHTML = `
      <button type="button" class="action-link-btn primary-action" id="btnModalCopyShop">📋 复制关键词去外卖软件粘贴</button>
      <button type="button" class="action-link-btn" id="btnModalDoneShop">✅ 关闭窗口</button>
    `;

    document.getElementById('btnModalCopyShop')?.addEventListener('click', () => {
      playSelectSound();
      recordTasteSignal('copy', { item });
      navigator.clipboard
        .writeText(copyTarget)
        .then(() => showToast(`✅ 已复制「${copyTarget}」，可直接去美团 / 饿了么 / 地图粘贴搜索`))
        .catch(() => showToast(`✅ 搜索词：${copyTarget}`));
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
  // 8.5. 纯离线本地饮食习惯画像与分析弹窗（零网络上传，断网可用）
  // =========================================================================
  function computeOfflinePersona() {
    const topC = getTopEntries(tasteProfile.cuisineScores, 3);
    const topF = getTopEntries(tasteProfile.flavorScores, 3);
    const totalModes = Object.values(tasteProfile.modeCounts).reduce((a, b) => a + b, 0) || 1;
    const lazyPct = Math.round(((tasteProfile.modeCounts.lazy || 0) / totalModes) * 100);
    const takeoutPct = Math.round(((tasteProfile.modeCounts.takeout || 0) / totalModes) * 100);

    if (tasteProfile.totalInteractions < 3) {
      return {
        title: '🌱 美食口味探索新手',
        desc: '你的离线饮食画像刚刚建立！多抽几次卡、点击查看食谱或在结果栏点 👍 / 👎，系统就会在本地自动学习你的口味偏好，绝不上传任何数据。'
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

  function buildOfflineInsights() {
    const insights = [];
    const totalMeals = (tasteProfile.mealCounts.breakfast || 0) + (tasteProfile.mealCounts.lunch || 0) + (tasteProfile.mealCounts.dinner || 0);
    const totalModes = Object.values(tasteProfile.modeCounts).reduce((a, b) => a + b, 0);
    const topF = getTopEntries(tasteProfile.flavorScores, 3).map(([k]) => k);

    if (tasteProfile.totalDraws < 3) {
      insights.push('💡 抽卡满 3 次后，这里会自动生成你的本地饮食节奏与膳食均衡建议。');
      insights.push('🔒 所有饮食习惯仅保存在当前浏览器本地，支持底部「导出备份」跨设备迁移。');
      return insights;
    }

    if (totalMeals > 0) {
      const bPct = Math.round(((tasteProfile.mealCounts.breakfast || 0) / totalMeals) * 100);
      const lPct = Math.round(((tasteProfile.mealCounts.lunch || 0) / totalMeals) * 100);
      const dPct = Math.max(0, 100 - bPct - lPct);
      insights.push(`🕒 餐段分布：早餐 ${bPct}% · 午餐 ${lPct}% · 晚餐 ${dPct}%${bPct < 15 ? '（早餐抽选较少，记得按时吃早饭哦）' : ''}`);
    }

    if (totalModes > 0) {
      const cookAll = (tasteProfile.modeCounts.cook || 0) + (tasteProfile.modeCounts.lazy || 0);
      const takeoutPct = Math.round(((tasteProfile.modeCounts.takeout || 0) / totalModes) * 100);
      if (takeoutPct >= 55) {
        insights.push('🛵 近期点外卖比例偏高，偶尔切到「⚡ 懒人专区」做个10分钟快手菜会更省钱控油。');
      } else if (cookAll > 0) {
        insights.push(`🍳 自己下厨 / 懒人快手占比达 ${Math.round((cookAll / totalModes) * 100)}%，饮食规律又健康！`);
      }
    }

    if (topF.includes('麻辣鲜香') || topF.includes('炙烤解馋')) {
      insights.push('🥗 偏好重口/香辣/炙烤风味，建议穿插「粤港澳 / 江浙沪」清淡汤蔬换换胃口。');
    } else if (topF.includes('面食碳水')) {
      insights.push('🥩 碳水面食比例较高，搭配鸡蛋、豆制品或瘦肉蛋白会更扛饿。');
    } else if (topF.includes('鲜美清淡')) {
      insights.push('✨ 饮食偏清淡鲜美，结构很清爽，偶尔也可以来道酸甜或微辣菜开开胃。');
    }

    return insights;
  }

  function renderTasteModalContent() {
    const persona = computeOfflinePersona();
    const topC = getTopEntries(tasteProfile.cuisineScores, 5);
    const maxC = topC[0]?.[1] || 1;
    const topF = getTopEntries(tasteProfile.flavorScores, 6);
    const insights = buildOfflineInsights();

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
      : '';

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
          <span class="recipe-block-title">🧭 本地习惯洞察 & 均衡提醒</span>
        </div>
        <ul class="taste-insight-list">
          ${insights.map(line => `<li>${line}</li>`).join('')}
        </ul>
      </div>

      <div class="taste-section-card">
        <div class="recipe-block-header" style="margin-bottom:2px;">
          <span class="recipe-block-title">👍 喜欢 & 👎 避开清单</span>
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

  // 离线习惯画像事件绑定
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
      if (tasteModal?.classList.contains('open')) closeTasteModal();
    }
  });

  // 初始化
  syncUI();
})();
