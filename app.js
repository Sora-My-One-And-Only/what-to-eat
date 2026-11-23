(function () {
  const staticDishes = window.DISHES_DATA || [];
  const CARD_HEIGHT = 196;

  // 当前三步状态 + 周边实店扫描状态
  const state = {
    meal: 'breakfast',   // 'breakfast' | 'lunch' | 'dinner'
    mode: 'cook',        // 'cook' | 'takeout'
    cuisine: 'all',      // 'all' or specific cuisine name
    radius: 3000,        // 1000 | 3000 | 5000 (meters)
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
  const modeGroup = document.getElementById('modeGroup');
  const cuisineGroup = document.getElementById('cuisineGroup');
  const poolCountEl = document.getElementById('poolCount');
  const cookStatusLayer = document.getElementById('cookStatusLayer');
  const takeoutStatusLayer = document.getElementById('takeoutStatusLayer');
  const slotFrame = document.getElementById('slotFrame');
  const slotWindow = document.getElementById('slotWindow');
  const slotReel = document.getElementById('slotReel');
  const slotShockwave = document.getElementById('slotShockwave');
  const btnDraw = document.getElementById('btnDraw');
  const locDot = document.getElementById('locDot');
  const locText = document.getElementById('locText');
  const btnRelocate = document.getElementById('btnRelocate');
  const btnSourceConfig = document.getElementById('btnSourceConfig');
  const radiusSelect = document.getElementById('radiusSelect');
  const cityPreset = document.getElementById('cityPreset');
  const historyList = document.getElementById('historyList');
  const fxCanvas = document.getElementById('fxCanvas');

  // 右侧常驻内容展台 DOM
  const rightShowcasePanel = document.getElementById('rightShowcasePanel');
  const showcaseTitle = document.getElementById('showcaseTitle');
  const showcaseActions = document.getElementById('showcaseActions');
  const showcaseBody = document.getElementById('showcaseBody');

  // 弹窗 DOM
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
  const amapKeyInput = document.getElementById('amapKeyInput');
  const btnCloseSourceModal = document.getElementById('btnCloseSourceModal');
  const btnSaveSource = document.getElementById('btnSaveSource');
  const btnResetSource = document.getElementById('btnResetSource');

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
  // 1. 礼花粒子特效系统 (60fps 轻量级 Canvas 粒子)
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

  function triggerWinParticles() {
    const rect = slotWindow.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colors = ['#ffb300', '#ff7043', '#ffd54f', '#22c55e', '#38bdf8', '#fda4af'];

    for (let i = 0; i < 42; i++) {
      const angle = (Math.PI * 2 * i) / 42 + (Math.random() - 0.5) * 0.25;
      const speed = 3.5 + Math.random() * 6.5;
      particles.push({
        x: cx + (Math.random() - 0.5) * 80,
        y: cy + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.2,
        size: 4 + Math.random() * 4.5,
        color: colors[i % colors.length],
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.22,
        alpha: 1,
        decay: 0.016 + Math.random() * 0.012
      });
    }

    if (!animFrameId) {
      renderParticles();
    }
  }

  function renderParticles() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    particles = particles.filter(p => p.alpha > 0.02);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.22;
      p.vx *= 0.985;
      p.rotation += p.vRot;
      p.alpha -= p.decay;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.roundRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65, 2);
      ctx.fill();
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
  // 2. Web Audio API 物理棘轮音效 & 中奖和弦
  // =========================================================================
  let audioCtx = null;
  function playTickSound(freq = 520, volume = 0.045) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(volume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.032);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.032);
    } catch (_) {}
  }

  function playSelectSound() {
    playTickSound(640, 0.025);
  }

  function playWinSound() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((n, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n, audioCtx.currentTime + idx * 0.065);
        gain.gain.setValueAtTime(0.075, audioCtx.currentTime + idx * 0.065);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + idx * 0.065 + 0.24);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + idx * 0.065);
        osc.stop(audioCtx.currentTime + idx * 0.065 + 0.24);
      });
    } catch (_) {}
  }

  // =========================================================================
  // 3. 周边真实店铺智能自动菜系分类器
  // =========================================================================
  const shopCuisineClassifier = [
    {
      cuisine: '欧美西餐',
      emoji: '🍔',
      tag: '西式简餐',
      combos: ['经典汉堡薯条可乐套餐', '意式肉酱面+烤翅套餐', '牛排轻食能量碗单人餐'],
      regex: /(麦当劳|肯德基|KFC|McDonald|汉堡王|Burger|赛百味|Subway|必胜客|Pizza|达美乐|尊宝|乐凯撒|萨莉亚|Saizeriya|蓝蛙|Blue Frog|Wagas|沃歌斯|塔斯汀|德克士|Dicos|华莱士|棒约翰|Papa John|西餐|牛排|Steak|意面|Pasta|披萨|比萨|汉堡|三明治|Sandwich|轻食|沙拉|Salad|波奇|墨西哥|Taco|西班牙|法餐|法式|意式|俄式|德式|Paulaner|Hooters|米氏|Brunch|贝果|可颂|西点|烘焙|面包)/i
    },
    {
      cuisine: '日韩亚太',
      emoji: '🍣',
      tag: '日韩亚太',
      combos: ['温泉蛋肥牛丼+味增汤套餐', '石锅拌饭/韩式炸鸡双拼', '豚骨拉面/冬阴功单人餐'],
      regex: /(吉野家|食其家|松屋|味千|一风堂|一兰|寿司|Sushi|刺身|日料|日本料理|居酒屋|烧鸟|寿喜|乌冬|拉面|Ramen|鳗鱼|天妇罗|和牛|丼|beef_bowl|japanese|韩|韩国|韩式|烤肉|石锅|拌饭|部队锅|炸鸡|紫菜包饭|冷面|朝鲜|延边|korean|泰|泰国|冬阴功|越南|河粉|新加坡|海南鸡|肉骨茶|东南亚|印度|咖喱|thai|vietnamese|indian|asian)/i
    },
    {
      cuisine: '川渝菜',
      emoji: '🌶️',
      tag: '麻辣川渝',
      combos: ['招牌川味双拼工作餐', '酸菜鱼/冒菜单人豪华套餐', '重庆小面/红油抄手套餐'],
      regex: /(川|蜀|渝|重庆|成都|四川|sichuan|海底捞|太二|鱼你在一起|乡村基|大米先生|冒菜|三顾冒菜|串串|钵钵鸡|麻辣烫|杨国福|张亮|麻辣香锅|酸菜鱼|水煮鱼|烤鱼|万州|毛血旺|担担面|小面|豌杂|抄手|酸辣粉|锅盔|锅魁|兔|跷脚牛肉|蹄花|自贡|乐山|宜宾|绵阳|干锅|牛蛙|蛙来哒|辣子鸡|回锅肉|火锅|hotpot)/i
    },
    {
      cuisine: '粤港澳',
      emoji: '🦐',
      tag: '粤港风味',
      combos: ['烧腊双拼饭+老火例汤', '广式肠粉/云吞面套餐', '隆江猪脚饭/腊味煲仔饭'],
      regex: /(粤|广|港|茶餐厅|烧腊|烧鹅|烧鸭|叉烧|白切鸡|猪脚饭|隆江|煲仔饭|肠粉|早茶|点都德|陶陶居|翠华|太兴|避风塘|云吞|竹升面|潮汕|潮州|牛肉火锅|砂锅粥|顺德|客家|啫啫|猪肚鸡|海鲜|cantonese|hongkong|dim_sum|seafood)/i
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
      regex: /(沪|上海|本帮|苏|苏州|杭州|杭帮|浙|宁波|无锡|扬州|淮扬|南京|金陵|镇江|大壶春|小杨生煎|德兴馆|小南国|南翔|绿波廊|新白鹿|外婆家|绿茶|老盛昌|生煎|小笼|锅贴|馄饨|吉祥馄饨|如意馄饨|菜饭|葱油拌面|片儿川|奥灶面|锅盖面|鸭血粉丝|盐水鸭|狮子头|东坡肉|黄鱼面|粢饭团|shanghai)/i
    },
    {
      cuisine: '东北鲁菜',
      emoji: '🥟',
      tag: '北方硬菜',
      combos: ['东北水饺/锅包肉双拼盒饭', '黄焖鸡/把子肉米饭套餐', '老北京炸酱面/煎饼套餐'],
      regex: /(东北|哈尔滨|沈阳|长春|大连|鲁|山东|青岛|济南|京|北京|老北京|燕云楼|全聚德|便宜坊|护国寺|天津|狗不理|喜家德|东方饺子王|饺子|水饺|dumpling|黄焖鸡|杨铭宇|把子肉|超意兴|锅包肉|铁锅炖|酱大骨|烧烤|烤串|淄博|烤冷面|煎饼|炸酱面|卤煮|铜锅涮肉|烤鸭|peking|beijing|shandong)/i
    },
    {
      cuisine: '西北晋豫',
      emoji: '🍜',
      tag: '西北面食',
      combos: ['兰州拉面/刀削面+卤蛋套餐', '肉夹馍+凉皮三秦套餐', '新疆大盘鸡/羊肉串套餐'],
      regex: /(西北|陕西|西安|三秦|西贝|兰州|拉面|牛肉面|马记永|陈香贵|张拉拉|肉夹馍|凉皮|擀面皮|油泼面|biang|臊子面|泡馍|山西|刀削面|过油肉|莜面|河南|郑州|洛阳|开封|胡辣汤|方中山|烩面|水煎包|新疆|大盘鸡|手抓饭|羊肉串|烤馕|清真|羊肉汤|羊汤|宁夏|青海|甘肃)/i
    },
    {
      cuisine: '云贵桂闽',
      emoji: '🍲',
      tag: '云贵桂闽',
      combos: ['过桥/小锅米线单人套餐', '柳州螺蛳粉/桂林米粉套餐', '沙县拌面扁肉/酸汤鱼套餐'],
      regex: /(云|云南|昆明|大理|丽江|过桥米线|小锅米线|米线|汽锅鸡|菌菇|贵|贵州|贵阳|遵义|凯里|酸汤鱼|牛肉粉|花溪|桂|广西|桂林|米粉|柳州|螺蛳粉|南宁|老友粉|闽|福建|厦门|泉州|福州|沙县|扁肉|沙茶面|面线糊|姜母鸭|海蛎煎|海南|椰子鸡|文昌鸡|yunnan)/i
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
      if (/(粥|豆浆|油条|包子|早餐|早点|馒头|饼)/.test(rawShop.name)) {
        emoji = '🥣';
        tag = '早点粥铺';
        combos = ['招牌暖胃粥+小笼/肉包套餐', '现磨豆浆+手工煎饼/油条'];
      } else if (/(面|粉|饺|馄饨)/.test(rawShop.name)) {
        emoji = '🍜';
        tag = '面食小吃';
        combos = ['招牌浇头面+虎皮卤蛋套餐', '手工现包饺子/馄饨套餐'];
      } else if (/(老乡鸡|真功夫|永和大王|东方既白|快餐|便当|盖饭|米饭)/.test(rawShop.name)) {
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

    const isBreakfastFriendly = /(早|粥|包|豆浆|油条|肠粉|早茶|点心|生煎|小笼|锅贴|煎饼|灌饼|手抓饼|馄饨|云吞|抄手|面|粉|米线|胡辣汤|豆皮|烧麦|麦当劳|肯德基|KFC|McDonald|赛百味|Subway|永和大王|东方既白|德克士|吉野家|食其家|沙县|肉夹馍|三明治|贝果|可颂|烘焙|fast_food|burger|sandwich|noodle)/i.test(combined);
    const isDinnerOnly = /(夜宵|宵夜|大排档|啤酒广场|烧烤|烤串|龙虾)/i.test(rawShop.name);

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

  // 直接从浏览器调用高德官方 POI 2.0（支持 CORS，适配 GitHub Pages 纯静态部署）
  async function fetchDirectAmap(lat, lng, radius, amapKey) {
    const shops = [];
    for (let page = 1; page <= 3; page++) {
      const url = `https://restapi.amap.com/v5/place/around?key=${encodeURIComponent(amapKey)}&location=${lng.toFixed(6)},${lat.toFixed(6)}&radius=${radius}&types=050000&page_size=25&page_num=${page}&show_fields=business`;
      const res = await fetch(url);
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

  // 直接从浏览器调用开放 Overpass 节点（纯静态部署备用实时扫描）
  async function fetchDirectOverpass(lat, lng, radius) {
    const radiusKm = Math.max(0.5, Math.min(6, radius / 1000));
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
    const bbox = `${(lat - dLat).toFixed(4)},${(lng - dLng).toFixed(4)},${(lat + dLat).toFixed(4)},${(lng + dLng).toFixed(4)}`;
    const q = `[out:json][timeout:8];node["amenity"~"restaurant|fast_food"](${bbox});out 180;`;
    const skipDrinkRegex = /(奶茶|茶饮|一点点|1点点|喜茶|奈雪|蜜雪冰城|霸王茶姬|茶百道|古茗|沪上阿姨|瑞幸|星巴克|Costa|咖啡|Coffee|Cafe|甜品|满记|许留山|冰淇淋|雪糕|DQ|哈根达斯|酒吧|酒馆|Bar|Pub|KTV)/i;

    const res = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
    if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
    const data = await res.json();
    const seen = new Set();
    const shops = [];
    for (const el of data.elements || []) {
      const tags = el.tags || {};
      const name = (tags['name:zh'] || tags.name || '').trim();
      if (!name || name.length < 2 || skipDrinkRegex.test(name)) continue;
      if (/(bubble_tea|coffee_shop|ice_cream|tea)/i.test(tags.cuisine || '')) continue;
      const dist = haversineMeters(lat, lng, el.lat, el.lon);
      if (dist > radius) continue;
      const key = `${name}_${Math.round(dist / 200)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const addr = [tags['addr:district'], tags['addr:street'] || tags['addr:road'], tags['addr:housenumber']].filter(Boolean).join(' ');
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

  // 从内置全国十大热门城市实景商户库中按当前坐标与半径过滤（GitHub Pages 0延迟秒出实店）
  function matchStaticCitySnapshot(lat, lng, radius, cityLabel) {
    const citySnapshots = window.CITY_SHOPS_DATA || {};
    const matchedKey = Object.keys(citySnapshots).find(k => cityLabel.includes(k) || cityLabel.includes(k.replace('市', '')));
    if (!matchedKey || !Array.isArray(citySnapshots[matchedKey])) return [];

    const filtered = citySnapshots[matchedKey]
      .map(s => ({
        ...s,
        distance: haversineMeters(lat, lng, s.lat, s.lng)
      }))
      .filter(s => s.distance <= radius)
      .sort((a, b) => a.distance - b.distance);

    return filtered;
  }

  async function scanNearbyShops(force = false) {
    if (!state.location.lat || !state.location.lng) return;
    const scanKey = `${state.location.lat.toFixed(3)}_${state.location.lng.toFixed(3)}_${state.radius}_${state.amapKey ? 'amap' : 'osm'}`;
    if (!force && state.nearbyScannedKey === scanKey && state.nearbyShops.length > 0) {
      return;
    }

    state.nearbyLoading = true;
    locDot.classList.add('loading');
    locText.textContent = `正在扫描 ${state.location.label} ${state.radius / 1000}km 内餐饮店...`;

    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

    try {
      let rawShops = [];
      let source = 'osm';

      if (state.amapKey) {
        // 优先：用户填写的高德官方 Key，直连高德 API（纯前端跨域可用）
        rawShops = await fetchDirectAmap(state.location.lat, state.location.lng, state.radius, state.amapKey);
        source = 'amap';
      } else if (isLocalhost) {
        // 本地开发：走本地 Node 代理接口
        const apiUrl = `/api/nearby?lat=${state.location.lat}&lng=${state.location.lng}&radius=${state.radius}`;
        const res = await fetch(apiUrl);
        const data = await res.json();
        if (data.ok && Array.isArray(data.shops)) {
          rawShops = data.shops;
          source = data.source || 'osm';
        }
      } else {
        // GitHub Pages 纯静态托管：优先匹配内置十大城市实时商圈快照（秒开稳定），其余位置直连 Overpass
        const snapshot = matchStaticCitySnapshot(state.location.lat, state.location.lng, state.radius, state.location.label || state.location.city || '');
        if (snapshot.length > 0) {
          rawShops = snapshot;
          source = 'osm';
        } else {
          rawShops = await fetchDirectOverpass(state.location.lat, state.location.lng, state.radius);
          source = 'osm';
        }
      }

      if (rawShops.length > 0) {
        state.nearbyShops = rawShops.map(classifyNearbyShop);
        state.nearbySource = source;
        state.nearbyScannedKey = scanKey;
        locDot.classList.remove('loading');
        const srcLabel = source === 'amap' ? '高德实店' : '周边实店';
        locText.textContent = `${state.location.label} · 发现 ${state.nearbyShops.length} 家${srcLabel}`;
      } else {
        throw new Error('当前范围暂无扫描到实店');
      }
    } catch (err) {
      // 兜底尝试内置快照（防止外网波动）
      const fallbackSnap = matchStaticCitySnapshot(state.location.lat, state.location.lng, state.radius, state.location.label || state.location.city || '');
      locDot.classList.remove('loading');
      if (fallbackSnap.length > 0) {
        state.nearbyShops = fallbackSnap.map(classifyNearbyShop);
        state.nearbySource = 'osm';
        state.nearbyScannedKey = scanKey;
        locText.textContent = `${state.location.label} · 发现 ${state.nearbyShops.length} 家周边实店`;
      } else {
        locText.textContent = `${state.location.label} · 已启用本地外卖套餐库`;
        state.nearbyShops = [];
      }
    } finally {
      state.nearbyLoading = false;
      syncUI();
      if (state.mode === 'takeout') {
        if (state.currentDish && state.currentDish.isRealShop) {
          renderRightShowcase(state.currentDish);
        } else {
          renderIdleShowcase();
        }
      }
    }
  }

  // =========================================================================
  // 4. 候选池计算 & 菜系角标 & 数字滚动
  // =========================================================================
  function getFilteredPool() {
    if (state.mode === 'takeout' && state.nearbyShops.length > 0) {
      const realMatches = state.nearbyShops.filter(s => {
        const mealMatch = s.meals.includes(state.meal);
        const cuisineMatch = state.cuisine === 'all' || s.cuisine === state.cuisine;
        return mealMatch && cuisineMatch;
      });
      if (realMatches.length > 0) return realMatches;
      const relaxedReal = state.nearbyShops.filter(s => state.cuisine === 'all' || s.cuisine === state.cuisine);
      if (relaxedReal.length > 0) return relaxedReal;
    }

    return staticDishes.filter(d => {
      const mealMatch = d.meals.includes(state.meal);
      const modeMatch = d.modes.includes(state.mode);
      const cuisineMatch = state.cuisine === 'all' || d.cuisine === state.cuisine;
      return mealMatch && modeMatch && cuisineMatch;
    });
  }

  function updateCuisineChipCounts() {
    const showRealCounts = state.mode === 'takeout' && state.nearbyShops.length > 0;
    cuisineGroup.querySelectorAll('.cuisine-chip').forEach(btn => {
      const c = btn.dataset.cuisine;
      const baseLabel = cuisineBaseLabels.get(c) || btn.textContent;
      if (showRealCounts) {
        const cnt = c === 'all'
          ? state.nearbyShops.length
          : state.nearbyShops.filter(s => s.cuisine === c).length;
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
    const unit = isRealTakeout ? '家实店' : '道';

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

  function syncUI() {
    const mealIdxMap = { breakfast: 0, lunch: 1, dinner: 2 };
    mealGroup.style.setProperty('--active-idx', mealIdxMap[state.meal] ?? 0);
    mealGroup.querySelectorAll('.segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.meal === state.meal);
    });

    const modeIdxMap = { cook: 0, takeout: 1 };
    modeGroup.style.setProperty('--active-idx', modeIdxMap[state.mode] ?? 0);
    modeGroup.querySelectorAll('.segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === state.mode);
    });

    cuisineGroup.querySelectorAll('.cuisine-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cuisine === state.cuisine);
    });

    if (state.mode === 'takeout') {
      cookStatusLayer.classList.remove('active');
      takeoutStatusLayer.classList.add('active');
      if (!state.location.ready) {
        detectUserLocation();
      } else if (!state.nearbyLoading && state.nearbyShops.length === 0) {
        scanNearbyShops();
      }
    } else {
      takeoutStatusLayer.classList.remove('active');
      cookStatusLayer.classList.add('active');
    }

    updateCuisineChipCounts();
    const pool = getFilteredPool();
    animatePoolCount(pool.length);

    if (!state.currentDish && !state.isSpinning) {
      renderIdleShowcase();
    }
  }

  // =========================================================================
  // 5. 地理位置定位
  // =========================================================================
  async function reverseGeocode(lat, lng) {
    const url =
      lat && lng
        ? `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`
        : `https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=zh`;
    const res = await fetch(url);
    return res.json();
  }

  async function detectUserLocation() {
    locDot.classList.add('loading');
    locText.textContent = '正在定位并扫描周边店铺...';

    const applyGeoData = (data, fallbackLat, fallbackLng) => {
      const city = data.city || data.principalSubdivision || '上海市';
      const district = data.locality || '';
      state.location.lat = fallbackLat || data.latitude || 31.2304;
      state.location.lng = fallbackLng || data.longitude || 121.4737;
      state.location.city = city;
      state.location.district = district;
      state.location.label = [city, district].filter(Boolean).join('·') || '当前位置';
      state.location.ready = true;
      scanNearbyShops(true);
    };

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async pos => {
          try {
            const { latitude, longitude } = pos.coords;
            const data = await reverseGeocode(latitude, longitude);
            applyGeoData(data, latitude, longitude);
          } catch (_) {
            applyGeoData({ city: '当前位置', locality: '周边' }, pos.coords.latitude, pos.coords.longitude);
          }
        },
        async () => {
          try {
            const data = await reverseGeocode(null, null);
            applyGeoData(data, data.latitude, data.longitude);
          } catch (_) {
            applyGeoData({ city: '上海市', locality: '人民广场' }, 31.2304, 121.4737);
          }
        },
        { timeout: 4000 }
      );
    } else {
      try {
        const data = await reverseGeocode(null, null);
        applyGeoData(data, data.latitude, data.longitude);
      } catch (_) {
        applyGeoData({ city: '上海市', locality: '人民广场' }, 31.2304, 121.4737);
      }
    }
  }

  // =========================================================================
  // 6. 滚轮卡片渲染 & 零闪烁老虎机引擎
  // =========================================================================
  function formatDistance(meters) {
    if (meters == null) return '周边';
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`;
  }

  function createReelCardHTML(item) {
    const titleClass = item.name.length > 10 ? 'dish-name combo-title' : 'dish-name';
    if (item.isRealShop) {
      return `
        <div class="reel-card">
          <div class="dish-emoji">${item.emoji || '🏪'}</div>
          <div class="dish-name-wrap">
            <div class="${titleClass}">${item.name}</div>
          </div>
          <div class="dish-badges">
            <span class="badge badge-cuisine">${item.cuisine}</span>
            <span class="badge badge-mode">📍 距你 ${formatDistance(item.distance)}</span>
            <span class="badge badge-flavor">约 ${item.estDeliveryMin} 分钟达</span>
          </div>
        </div>
      `;
    }

    const isTakeout = item.modes.includes('takeout') && !item.modes.includes('cook');
    const modeLabel = isTakeout ? '🛵 外卖套餐' : '🍳 自己做';
    return `
      <div class="reel-card">
        <div class="dish-emoji">${item.emoji || '🥘'}</div>
        <div class="dish-name-wrap">
          <div class="${titleClass}">${item.name}</div>
        </div>
        <div class="dish-badges">
          <span class="badge badge-cuisine">${item.cuisine}</span>
          <span class="badge badge-mode">${modeLabel}</span>
          <span class="badge badge-flavor">${item.tag || '地道美味'}</span>
        </div>
      </div>
    `;
  }

  function spinSlotMachine() {
    if (state.isSpinning) return;
    let pool = getFilteredPool();
    if (pool.length === 0) {
      pool = staticDishes.filter(d => d.modes.includes(state.mode));
    }

    state.isSpinning = true;
    btnDraw.disabled = true;
    btnDraw.querySelector('.draw-btn-text').textContent = '好运飞速滚动中...';
    slotFrame.classList.remove('won');
    slotFrame.classList.add('spinning');
    slotShockwave.classList.remove('boom');

    showcaseTitle.textContent =
      state.mode === 'takeout' && pool[0]?.isRealShop
        ? `🛵 正在周围 ${state.radius / 1000}km 的 ${pool.length} 家真实店铺中抽选...`
        : '🎰 正在从美食库中为你锁定今日天命美食...';
    showcaseActions.innerHTML = '';

    let winner = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && state.currentDish && winner.name === state.currentDish.name) {
      const others = pool.filter(d => d.name !== state.currentDish.name);
      winner = others[Math.floor(Math.random() * others.length)];
    }

    const currentFirstCardHTML = slotReel.lastElementChild
      ? slotReel.lastElementChild.outerHTML
      : slotReel.innerHTML;

    const totalNewCards = 30;
    const sequenceHTML = [currentFirstCardHTML];
    for (let i = 0; i < totalNewCards - 1; i++) {
      const randItem = pool[Math.floor(Math.random() * pool.length)];
      sequenceHTML.push(createReelCardHTML(randItem));
    }
    sequenceHTML.push(createReelCardHTML(winner));

    slotReel.style.transition = 'none';
    slotReel.style.transform = 'translate3d(0, 0, 0)';
    slotReel.innerHTML = sequenceHTML.join('');

    void slotReel.offsetHeight;

    const targetOffset = -totalNewCards * CARD_HEIGHT;
    const durationMs = 2400;

    slotReel.style.transition = `transform ${durationMs}ms cubic-bezier(0.14, 0.92, 0.22, 1.016)`;
    slotReel.style.transform = `translate3d(0, ${targetOffset}px, 0)`;

    let tickCount = 0;
    const tickTimers = [];
    for (let i = 0; i < 18; i++) {
      const progress = i / 18;
      const delay = Math.pow(progress, 1.95) * (durationMs - 220);
      tickTimers.push(
        setTimeout(() => {
          playTickSound(420 + (tickCount % 6) * 38, 0.042);
          tickCount++;
        }, delay)
      );
    }

    setTimeout(() => {
      tickTimers.forEach(clearTimeout);
      state.isSpinning = false;
      state.currentDish = winner;

      slotFrame.classList.remove('spinning');
      slotFrame.classList.add('won');
      slotShockwave.classList.add('boom');

      playWinSound();
      triggerWinParticles();

      btnDraw.disabled = false;
      btnDraw.querySelector('.draw-btn-text').textContent = '换一个？再抽一次';

      addToHistory(winner);
      renderRightShowcase(winner);
    }, durationMs + 40);
  }

  // =========================================================================
  // 7. 分步图文详解构建器（自己做模式）
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

  function buildIllustratedRecipeHTML(dish) {
    const ings = dish.ingredients || [];
    const steps = dish.steps || [];
    const tips = dish.tips || [];
    const images = dish.images || [];
    const time = dish.time || '约 20 分钟';
    const difficulty = dish.difficulty || '★★★☆☆ 家常易做';

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
        return `
        <div class="ing-check-item" role="button" tabindex="0">
          <div class="ing-check-left">
            <span class="ing-checkbox">✓</span>
            <span class="ing-name">${name}</span>
          </div>
          <span class="ing-amount">${amount}</span>
        </div>
      `;
      })
      .join('');

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
        <div class="recipe-hero-top">
          <div class="recipe-hero-graphic">
            <span style="font-size:40px;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.4));">${dish.emoji || '🥘'}</span>
          </div>
          <div class="recipe-hero-info">
            <div class="recipe-hero-title-row">
              <h2 class="recipe-hero-title">${dish.name}</h2>
              <div class="dish-badges" style="height:auto;">
                <span class="badge badge-cuisine">${dish.cuisine}</span>
                <span class="badge badge-flavor">${dish.tag || '地道美味'}</span>
              </div>
            </div>
            <div class="recipe-meta-pills">
              <span class="meta-pill">⏱️ ${time}</span>
              <span class="meta-pill">🔥 难度 ${difficulty}</span>
              <span class="meta-pill">🛒 食材 ${ings.length} 项</span>
              <span class="meta-pill">📑 共 ${steps.length} 步</span>
            </div>
          </div>
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

  // =========================================================================
  // 8. 右侧常驻展台渲染引擎（空闲预览 / 自制详细图文食谱 / 外卖周边实店详情+清单）
  // =========================================================================
  function bindShopDirectoryClicks(peerShops) {
    showcaseBody.querySelectorAll('.nearby-shop-row').forEach(row => {
      row.addEventListener('click', () => {
        const shop = peerShops[Number(row.dataset.shopIdx)];
        if (!shop || state.isSpinning) return;
        playSelectSound();
        state.currentDish = shop;
        slotReel.style.transition = 'none';
        slotReel.style.transform = 'translate3d(0, 0, 0)';
        slotReel.innerHTML = createReelCardHTML(shop);
        slotFrame.classList.add('won');
        renderRightShowcase(shop);
        addToHistory(shop);
      });
    });
  }

  function renderIdleShowcase() {
    rightShowcasePanel.classList.remove('has-content');

    if (state.mode === 'takeout') {
      const peerShops = getFilteredPool().filter(s => s.isRealShop);
      const radiusKm = (state.radius / 1000).toFixed(0);
      const cuisineLabel = state.cuisine === 'all' ? '全菜系' : state.cuisine;

      if (peerShops.length > 0) {
        showcaseTitle.textContent = `🏪 ${state.location.label} ${radiusKm}km 内「${cuisineLabel}」实店 (${peerShops.length} 家)`;
        showcaseActions.innerHTML = `
          <button type="button" class="showcase-btn" id="btnIdleExpand">🔭 扩至 5km</button>
        `;
        document.getElementById('btnIdleExpand')?.addEventListener('click', () => {
          playSelectSound();
          state.radius = 5000;
          radiusSelect.value = '5000';
          scanNearbyShops(true);
        });

        const shopRowsHTML = peerShops
          .slice(0, 40)
          .map(
            (shop, idx) => `
            <div class="nearby-shop-row" data-shop-idx="${idx}">
              <div class="nearby-shop-top">
                <span class="nearby-shop-name">${shop.emoji} ${shop.name}</span>
                <span class="nearby-shop-dist">${formatDistance(shop.distance)}</span>
              </div>
              <div class="nearby-shop-bottom">
                <span class="nearby-shop-addr">📍 ${shop.address || '周边商圈'}</span>
                <span class="nearby-shop-tag">${shop.cuisine}</span>
              </div>
            </div>
          `
          )
          .join('');

        showcaseBody.innerHTML = `
          <div class="recipe-block-header" style="margin-bottom:0;">
            <span class="recipe-block-title">📡 已自动扫描并归类以下周边真实店铺</span>
            <span class="recipe-block-sub">点击左侧「开始抽卡」随机决定，或直接点选门店</span>
          </div>
          <div class="shop-list-grid">${shopRowsHTML}</div>
        `;
        bindShopDirectoryClicks(peerShops);
        return;
      }

      showcaseTitle.textContent = '🛵 周边外卖实店展台';
      showcaseActions.innerHTML = '';
      showcaseBody.innerHTML = `
        <div class="showcase-empty-state">
          <div class="showcase-empty-icon">📡</div>
          <div class="showcase-empty-title">${state.nearbyLoading ? '正在扫描周边真实餐饮店铺...' : '选好范围与菜系，立即开抽'}</div>
          <div class="showcase-empty-desc">
            自动识别你周围 1~5km 内的真实餐饮与快餐门店并按菜系归类。<br/>抽中后直接在此展示门店详情与点单推荐，无需跳去外部地图。
          </div>
          <div class="showcase-feature-pills">
            <span class="feature-pill">📍 自动计算直线距离</span>
            <span class="feature-pill">🏷️ 10大菜系智能归类</span>
            <span class="feature-pill">📋 一键复制店名下单</span>
          </div>
        </div>
      `;
      return;
    }

    // 自己做模式的右侧欢迎态
    showcaseTitle.textContent = '📖 详细图文食谱展台';
    showcaseActions.innerHTML = '';
    showcaseBody.innerHTML = `
      <div class="showcase-empty-state">
        <div class="showcase-empty-icon">🍳</div>
        <div class="showcase-empty-title">准备生成今日专属图文食谱</div>
        <div class="showcase-empty-desc">
          在左侧选好「餐段 · 自己做 · 菜系」，点击「开始抽卡」。<br/>
          定格瞬间，此处将直接呈现完整食材精确用量与分步图文做法，全程无需跳转外网。
        </div>
        <div class="showcase-feature-pills">
          <span class="feature-pill">🛒 食材用量可勾选</span>
          <span class="feature-pill">⚡ 分步SVG图文详解</span>
          <span class="feature-pill">💡 火候时长高亮提醒</span>
          <span class="feature-pill">🔍 支持大字厨房模式</span>
        </div>
      </div>
    `;
  }

  async function renderRightShowcase(item) {
    rightShowcasePanel.classList.add('has-content');
    showcaseBody.scrollTop = 0;

    if (state.mode === 'cook') {
      showcaseTitle.textContent = `📖 ${item.name} · 详细图文食谱`;
      showcaseActions.innerHTML = `
        <button type="button" class="showcase-btn primary" id="btnOpenLargeModal">🔍 全屏大字</button>
        <button type="button" class="showcase-btn" id="btnCopyIngredients">📋 复制清单</button>
      `;

      document.getElementById('btnOpenLargeModal')?.addEventListener('click', () => openRecipeModal(item));
      document.getElementById('btnCopyIngredients')?.addEventListener('click', () => copyRecipeToClipboard(item));

      showcaseBody.innerHTML = buildIllustratedRecipeHTML(item);
      bindRecipeInteractions(showcaseBody);

      // 若关联 HowToCook，后台异步拉取更全图片与原文步骤静默增强
      if (item.recipePath && !item._htcLoaded) {
        try {
          const encodedPath = item.recipePath.split('/').map(encodeURIComponent).join('/');
          const cdnUrl = `https://cdn.jsdelivr.net/gh/Anduin2017/HowToCook@master/${encodedPath}`;
          const res = await fetch(cdnUrl);
          if (res.ok) {
            const mdText = await res.text();
            const parsed = parseFullHowToCookMarkdown(mdText, item.recipePath);
            if (parsed.ingredients.length >= 2) item.ingredients = parsed.ingredients;
            if (parsed.steps.length >= 2) item.steps = parsed.steps;
            if (parsed.tips.length >= 1) item.tips = parsed.tips;
            if (parsed.intro) item.intro = parsed.intro;
            if (parsed.difficulty) item.difficulty = parsed.difficulty;
            if (parsed.images.length) {
              item.images = Array.from(new Set([...(item.images || []), ...parsed.images]));
            }
            item._htcLoaded = true;
            if (state.currentDish && state.currentDish.name === item.name && state.mode === 'cook') {
              showcaseBody.innerHTML = buildIllustratedRecipeHTML(item);
              bindRecipeInteractions(showcaseBody);
            }
          }
        } catch (_) {}
      }
      return;
    }

    // 点外卖模式：右侧展示抽中实店详情 + 周边同菜系店铺清单
    const peerShops = getFilteredPool().filter(s => s.isRealShop);
    const radiusKm = (state.radius / 1000).toFixed(0);
    const cuisineLabel = state.cuisine === 'all' ? '全菜系' : state.cuisine;
    const srcBadge = state.nearbySource === 'amap' ? '高德官方周边库' : '免Key周边实店库';
    const copyTarget = item.isRealShop ? item.name : (item.searchKeyword || item.name);

    showcaseTitle.textContent = item.isRealShop
      ? `🏪 ${item.name} · 距你 ${formatDistance(item.distance)}`
      : `🛵 ${item.name}`;

    showcaseActions.innerHTML = `
      <button type="button" class="showcase-btn primary" id="btnCopyShopName">📋 复制店名下单</button>
      <button type="button" class="showcase-btn" id="btnExpandRadius">🔭 扩至 5km</button>
    `;

    document.getElementById('btnCopyShopName')?.addEventListener('click', () => {
      playSelectSound();
      navigator.clipboard
        .writeText(copyTarget)
        .then(() => showToast(`✅ 已复制「${copyTarget}」，可直接去美团/饿了么粘贴下单`))
        .catch(() => showToast(`✅ 店铺名：${copyTarget}`));
    });

    document.getElementById('btnExpandRadius')?.addEventListener('click', () => {
      playSelectSound();
      state.radius = 5000;
      radiusSelect.value = '5000';
      scanNearbyShops(true);
      showToast('📡 已扩大范围至 5km 重新扫描周边餐饮店铺');
    });

    const combosHTML = (item.combos || ['门店招牌单人工作套餐', '热门主食+小食/饮品套餐'])
      .map(c => `<span class="combo-suggest-chip">🍽️ ${c}</span>`)
      .join('');

    const heroHTML = item.isRealShop
      ? `
        <div class="recipe-hero-banner">
          <div class="recipe-hero-top">
            <div class="recipe-hero-graphic">
              <span style="font-size:40px;">${item.emoji || '🏪'}</span>
            </div>
            <div class="recipe-hero-info">
              <div class="recipe-hero-title-row">
                <h2 class="recipe-hero-title">${item.name}</h2>
                <div class="dish-badges" style="height:auto;">
                  <span class="badge badge-cuisine">${item.cuisine}</span>
                  <span class="badge badge-flavor">${srcBadge}</span>
                </div>
              </div>
              <div class="recipe-meta-pills">
                <span class="meta-pill">📍 距你 ${formatDistance(item.distance)}</span>
                <span class="meta-pill">🛵 预计 ${item.estDeliveryMin} 分钟送达</span>
                ${item.rating ? `<span class="meta-pill">⭐ 评分 ${item.rating}</span>` : ''}
                ${item.cost ? `<span class="meta-pill">💰 人均 ¥${item.cost}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="recipe-intro-text">
            📍 门店位置：<strong>${item.address || `${state.location.label} ${radiusKm}km 商圈内`}</strong>
            ${item.openTime ? ` · 🕒 营业时间：${item.openTime}` : ''}
          </div>
          <div>
            <div class="recipe-block-header" style="margin-bottom:6px;">
              <span class="recipe-block-title">🍱 进店外卖必点参考</span>
              <span class="recipe-block-sub">复制店名后在美团/饿了么直接搜店下单</span>
            </div>
            <div class="combo-suggest-chips">${combosHTML}</div>
          </div>
        </div>
      `
      : `
        <div class="recipe-hero-banner">
          <div class="recipe-hero-top">
            <div class="recipe-hero-graphic"><span style="font-size:40px;">${item.emoji || '🛵'}</span></div>
            <div class="recipe-hero-info">
              <div class="recipe-hero-title-row">
                <h2 class="recipe-hero-title">${item.name}</h2>
                <span class="badge badge-cuisine">${item.cuisine}</span>
              </div>
              <div class="recipe-meta-pills">
                <span class="meta-pill">📍 ${state.location.label} ${radiusKm}km 内暂未发现该细分菜系实店</span>
                <span class="meta-pill">💡 点击右上角可扩至 5km</span>
              </div>
            </div>
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
            <span class="nearby-shop-dist">${formatDistance(shop.distance)}</span>
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
            <span class="recipe-block-sub">按距离排序 · 点击任意门店可切换</span>
          </div>
          <div class="shop-list-grid">${shopRowsHTML}</div>
        </div>
      `
        : '';

    showcaseBody.innerHTML = heroHTML + directoryHTML;
    bindShopDirectoryClicks(peerShops);
  }

  // =========================================================================
  // 9. 全屏大字模式弹窗 & 数据源设置弹窗
  // =========================================================================
  function openRecipeModal(dish) {
    playSelectSound();
    modalEmoji.textContent = dish.emoji || '🥘';
    modalDishName.textContent = `${dish.name} · 大字图文食谱`;
    modalTags.innerHTML = `
      <span class="badge badge-cuisine">${dish.cuisine}</span>
      <span class="badge badge-flavor">${dish.tag || '家常美味'}</span>
    `;

    modalBody.innerHTML = buildIllustratedRecipeHTML(dish);
    bindRecipeInteractions(modalBody);

    modalFooter.innerHTML = `
      <button type="button" class="action-link-btn primary-action" id="btnModalCopy">📋 复制完整食材与步骤</button>
      <button type="button" class="action-link-btn" id="btnModalDone">✅ 关闭大字视图</button>
    `;

    document.getElementById('btnModalCopy')?.addEventListener('click', () => copyRecipeToClipboard(dish));
    document.getElementById('btnModalDone')?.addEventListener('click', closeRecipeModal);

    recipeModal.classList.add('open');
    recipeModal.setAttribute('aria-hidden', 'false');
  }

  function closeRecipeModal() {
    recipeModal.classList.remove('open');
    recipeModal.setAttribute('aria-hidden', 'true');
  }

  function openSourceModal() {
    playSelectSound();
    amapKeyInput.value = state.amapKey;
    sourceStatusBadge.textContent = state.amapKey
      ? '当前：高德地图官方 POI 2.0 精准库'
      : '当前：免Key开放周边实时扫描库';
    sourceModal.classList.add('open');
    sourceModal.setAttribute('aria-hidden', 'false');
  }

  function closeSourceModal() {
    sourceModal.classList.remove('open');
    sourceModal.setAttribute('aria-hidden', 'true');
  }

  // =========================================================================
  // 10. 历史记录胶囊与事件监听
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
        renderRightShowcase(item.dish);
        renderHistoryList();
      });
    });
  }

  // 事件绑定
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

      const hintText = state.mode === 'cook' ? '准备抽取今日食谱' : '准备抽取周边外卖店铺';
      slotReel.style.transition = 'none';
      slotReel.style.transform = 'translate3d(0, 0, 0)';
      slotReel.innerHTML = `
        <div class="reel-card">
          <div class="dish-emoji">${state.mode === 'cook' ? '🍳' : '🛵'}</div>
          <div class="dish-name-wrap">
            <div class="dish-name">${hintText}</div>
          </div>
          <div class="dish-badges">
            <span class="badge badge-cuisine">${state.cuisine === 'all' ? '全菜系随机' : state.cuisine}</span>
            <span class="badge badge-mode">${state.mode === 'cook' ? '右侧展示图文食谱' : '自动识别周边实店'}</span>
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
      syncUI();
      if (state.mode === 'takeout') {
        if (state.currentDish) renderRightShowcase(state.currentDish);
        else renderIdleShowcase();
      }
    }
  });

  radiusSelect.addEventListener('change', () => {
    playSelectSound();
    state.radius = parseInt(radiusSelect.value, 10) || 3000;
    scanNearbyShops(true);
  });

  btnDraw.addEventListener('click', spinSlotMachine);

  btnRelocate.addEventListener('click', () => {
    playSelectSound();
    cityPreset.value = '';
    detectUserLocation();
  });

  cityPreset.addEventListener('change', () => {
    if (!cityPreset.value) return;
    playSelectSound();
    const [lat, lng, label] = cityPreset.value.split(',');
    const [city, district] = label.split('·');
    state.location.lat = parseFloat(lat);
    state.location.lng = parseFloat(lng);
    state.location.city = city;
    state.location.district = district || '';
    state.location.label = label;
    state.location.ready = true;
    scanNearbyShops(true);
  });

  btnSourceConfig.addEventListener('click', openSourceModal);
  btnCloseSourceModal.addEventListener('click', closeSourceModal);
  sourceModal.addEventListener('click', e => {
    if (e.target === sourceModal) closeSourceModal();
  });

  btnSaveSource.addEventListener('click', () => {
    const key = amapKeyInput.value.trim();
    state.amapKey = key;
    if (key) localStorage.setItem('food_rec_amap_key', key);
    else localStorage.removeItem('food_rec_amap_key');
    closeSourceModal();
    showToast(key ? '✅ 已切换至高德官方 POI 2.0 实时数据源' : '✅ 已切换至默认免Key周边实时扫描');
    scanNearbyShops(true);
  });

  btnResetSource.addEventListener('click', () => {
    state.amapKey = '';
    amapKeyInput.value = '';
    localStorage.removeItem('food_rec_amap_key');
    closeSourceModal();
    showToast('🔄 已恢复默认免Key周边实时扫描');
    scanNearbyShops(true);
  });

  btnCloseModal.addEventListener('click', closeRecipeModal);
  recipeModal.addEventListener('click', e => {
    if (e.target === recipeModal) closeRecipeModal();
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (recipeModal.classList.contains('open')) closeRecipeModal();
      if (sourceModal.classList.contains('open')) closeSourceModal();
    }
  });

  // 初始化
  syncUI();
})();
