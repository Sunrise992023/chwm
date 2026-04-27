// ===== State =====
let restaurants = [];
let cart = [];
let currentUser = null;
let authToken = localStorage.getItem('authToken') || null;
let favoriteIds = new Set();
let activeCategory = 0; // 0 = all
let currentSort = '';
let currentCity = localStorage.getItem('currentCity') || '北京';

// ===== Router =====
const ROUTES = {
    '/delivery': 'delivery',
    '/food': 'food',
    '/supermarket': 'supermarket',
    '/paotui': 'paotui',
    '/tuangou': 'tuangou',
    '/yuding': 'yuding',
};

const SEARCH_PLACEHOLDERS = {
    delivery: '搜索商家或商品',
    food: '搜索美食推荐',
    supermarket: '搜索超市商品',
    paotui: '输入取送地址',
    tuangou: '搜索团购优惠',
    yuding: '搜索餐厅名称',
};

function navigate(route) {
    // Show/hide pages
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.dataset.page === route));

    // Highlight nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === route));

    // Update search placeholder
    const input = document.getElementById('globalSearch');
    if (input) input.placeholder = SEARCH_PLACEHOLDERS[route] || '搜索';

    // Load page-specific content
    if (route === 'food') renderFoodPage();
    else if (route === 'supermarket') renderSupermarketDeals();
    else if (route === 'tuangou') renderTuangouDeals();
    else if (route === 'yuding') renderYudingList();
}

function navigateTo(route) {
    const path = '/' + route;
    history.pushState({ route }, '', path);
    navigate(route);
}

function handleNavClick(e) {
    const link = e.currentTarget;
    const route = link.dataset.route;
    if (route) {
        e.preventDefault();
        navigateTo(route);
    }
}

function resolveRoute() {
    const path = window.location.pathname;
    const route = ROUTES[path] || 'delivery';
    // Ensure URL is clean
    if (!ROUTES[path]) {
        history.replaceState({ route: 'delivery' }, '', '/delivery');
    }
    navigate(route);
}

// ===== API Client =====
const API_BASE = '/api';

function apiHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = authToken;
    return headers;
}

async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`, { headers: apiHeaders() });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || '请求失败');
    return json.data;
}

async function apiPost(path, body) {
    const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || '请求失败');
    return json.data;
}

async function apiDelete(path) {
    const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: apiHeaders() });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || '请求失败');
    return json.data;
}

// ===== Cart Persistence =====
function saveCart() { localStorage.setItem('cart', JSON.stringify(cart)); }
function loadCart() { try { const s = localStorage.getItem('cart'); cart = s ? JSON.parse(s) : []; } catch { cart = []; } }

// ===== Auth =====
async function checkAuth() {
    if (!authToken) return;
    try {
        currentUser = await apiGet('/auth/me');
        updateAuthUI();
        await loadFavorites();
    } catch {
        authToken = null; localStorage.removeItem('authToken');
        currentUser = null; updateAuthUI();
    }
}

function updateAuthUI() {
    const authLink = document.getElementById('authLink');
    const logoutLink = document.getElementById('logoutLink');
    if (!authLink) return;
    if (currentUser) {
        authLink.textContent = `👤 ${currentUser.username}`;
        authLink.style.pointerEvents = 'none';
        logoutLink.style.display = '';
    } else {
        authLink.textContent = '登录/注册';
        authLink.style.pointerEvents = '';
        logoutLink.style.display = 'none';
    }
}

function openAuthModal(tab) {
    document.getElementById('authModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    switchTab(tab || 'login');
    document.getElementById('loginError').textContent = '';
    document.getElementById('registerError').textContent = '';
}

function closeAuthModal() {
    document.getElementById('authModal').classList.remove('active');
    document.body.style.overflow = '';
}

function switchTab(tab) {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.toggle('active', f.id === tab + 'Form'));
}

async function handleLogin(e) {
    e.preventDefault();
    const inputs = e.target.querySelectorAll('input');
    const username = inputs[0].value.trim();
    const password = inputs[1].value;
    try {
        const result = await apiPost('/auth/login', { username, password });
        authToken = result.token; localStorage.setItem('authToken', authToken);
        currentUser = { user_id: result.userId, username: result.username, phone: result.phone, address: result.address };
        updateAuthUI(); closeAuthModal(); await loadFavorites();
        showToast(`👋 欢迎回来，${result.username}！`);
    } catch (err) { document.getElementById('loginError').textContent = err.message; }
}

async function handleRegister(e) {
    e.preventDefault();
    const inputs = e.target.querySelectorAll('input');
    const username = inputs[0].value.trim();
    const phone = inputs[1].value.trim();
    const password = inputs[2].value;
    const confirm = inputs[3].value;
    if (password !== confirm) { document.getElementById('registerError').textContent = '两次密码输入不一致'; return; }
    try {
        const result = await apiPost('/auth/register', { username, password, phone });
        authToken = result.token; localStorage.setItem('authToken', authToken);
        currentUser = { user_id: result.userId, username: result.username, phone: result.phone };
        updateAuthUI(); closeAuthModal();
        showToast(`🎉 注册成功，欢迎 ${result.username}！`);
    } catch (err) { document.getElementById('registerError').textContent = err.message; }
}

async function handleLogout() {
    try { await apiPost('/auth/logout', {}); } catch {}
    authToken = null; localStorage.removeItem('authToken'); currentUser = null;
    favoriteIds.clear(); updateAuthUI(); renderAllCards();
    showToast('已退出登录');
}

// ===== Favorites =====
async function loadFavorites() {
    if (!currentUser) { favoriteIds.clear(); return; }
    try { favoriteIds = new Set(await apiGet('/favorites')); renderAllCards(); } catch { favoriteIds = new Set(); }
}

async function toggleFavorite(restaurantId) {
    if (!currentUser) { showToast('请先登录后再收藏'); openAuthModal('login'); return; }
    try {
        if (favoriteIds.has(restaurantId)) {
            await apiDelete(`/favorites/${restaurantId}`); favoriteIds.delete(restaurantId);
            showToast('已取消收藏');
        } else {
            await apiPost('/favorites', { restaurant_id: restaurantId }); favoriteIds.add(restaurantId);
            showToast('❤️ 已收藏');
        }
        renderAllCards();
    } catch { showToast('操作失败'); }
}

// ===== Load Delivery Data =====
async function loadRestaurants(sort, categoryId) {
    const container = document.getElementById('restaurantList');

    // Show loading shimmer
    container.innerHTML = '<div class="loading-shimmer">' + Array(6).fill('<div class="shimmer-card"></div>').join('') + '</div>';

    const params = new URLSearchParams();
    if (sort) params.set('sort', sort);
    if (categoryId && categoryId !== 0) params.set('category_id', categoryId);
    if (currentCity) params.set('city', currentCity);

    const qs = params.toString();
    try {
        restaurants = await apiGet(`/restaurants${qs ? '?' + qs : ''}`);
        renderAllCards();
        updateResultCount(restaurants.length);
        if (restaurants.length === 0) showEmptyState();
    } catch (err) {
        container.innerHTML = '<div style="text-align:center;padding:60px 0;color:#999;"><p>😵 加载失败，请刷新重试</p></div>';
    }
}

function showEmptyState() {
    const container = document.getElementById('restaurantList');
    container.innerHTML = `
        <div class="empty-state">
            <span class="empty-state-icon">🔍</span>
            <p>暂无相关商家</p>
            <p class="empty-state-hint">换个分类试试吧</p>
        </div>
    `;
}

function updateResultCount(count) {
    const el = document.querySelector('.result-count');
    if (el) el.innerHTML = `共 <strong>${count}</strong> 家商家`;
}

function updateLocationUI() {
    const textEl = document.querySelector('.location-text');
    if (textEl) textEl.textContent = currentCity;
    // mark active city in picker
    document.querySelectorAll('.city-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.city === currentCity);
    });
}

// ===== Render Delivery =====
function renderAllCards() { renderRestaurants(restaurants); }

function renderRestaurants(data) {
    const container = document.getElementById('restaurantList');
    container.innerHTML = data.map(r => {
        const tagColors = ['orange', 'red', 'green', 'blue'];
        const tagsHtml = (r.tags || []).map((t, i) => `<span class="restaurant-tag ${tagColors[i % 4]}">${t}</span>`).join('');
        const promosHtml = (r.promos || []).map(p => `<span class="promo-icon">减</span>${p}`).join('');
        const isFav = favoriteIds.has(r.id);
        const itemsHtml = (r.items || []).map((item, idx) =>
            `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:13px;color:#666;">
                <span>${item.name}</span>
                <span><span style="color:#FF8C00;font-weight:600;">¥${item.price}</span>
                <button class="add-cart-btn" onclick="event.stopPropagation(); addToCart(${r.id}, ${idx})" style="margin-left:8px;">+ 添加</button></span>
            </div>`
        ).join('');
        return `<div class="restaurant-card" onclick="openRestaurantDetail(${r.id})">
            <div style="position:relative;">
                <div class="restaurant-card-img" style="background:linear-gradient(135deg,#f5f5f5,#e8e8e8);display:flex;align-items:center;justify-content:center;">
                    <span style="font-size:48px;opacity:0.5;">🍽️</span>
                </div>
                <span class="restaurant-card-badge">${r.badge || '优质商家'}</span>
                <button class="fav-btn ${isFav ? 'active' : ''}" onclick="event.stopPropagation(); toggleFavorite(${r.id})">${isFav ? '❤️' : '🤍'}</button>
            </div>
            <div class="restaurant-card-body">
                <div class="restaurant-card-top"><span class="restaurant-name">${r.name}</span><span class="restaurant-rating"><span class="star">★</span>${r.rating}</span></div>
                <div class="restaurant-meta">
                    <span>月售${r.monthly_sales}</span><span class="dot"></span><span>${r.delivery_time}</span><span class="dot"></span>
                    <span>${r.distance}</span><span class="dot"></span><span>${r.min_order}</span><span class="dot"></span><span>${r.delivery_fee}</span>
                </div>
                <div class="restaurant-tags">${tagsHtml}</div>
                <div style="margin:8px 0;padding:8px 0;border-top:1px solid #f5f5f5;">${itemsHtml || '<div style="color:#999;font-size:12px;">暂无商品信息</div>'}</div>
                <div class="restaurant-promo">${promosHtml || '<span style="color:#999;">暂无优惠</span>'}</div>
            </div>
        </div>`;
    }).join('');
}

// ===== Restaurant Detail =====
let _detailRestaurantId = null;
let _detailData = null;

const FOOD_ICONS = ['🍔', '🌶️', '🍟', '🥟', '🍜', '🥩', '🍣', '🥗', '🍕', '🍱', '🍰', '🥤', '🍗', '🥘', '🧋'];

function getItemQty(restaurantId, itemIdx) {
    const item = cart.find(c => c.key === `${restaurantId}-${itemIdx}`);
    return item ? item.qty : 0;
}

function renderDetailModal() {
    const r = _detailData;
    if (!r) return;
    const body = document.getElementById('restaurantDetailBody');
    const isFav = favoriteIds.has(r.id);
    const cartCount = cart.reduce((s, c) => s + c.qty, 0);
    const cartTotal = cart.reduce((s, c) => s + c.price * c.qty, 0);

    const itemsHtml = (r.items || []).map((item, idx) => {
        const qty = getItemQty(r.id, idx);
        const icon = FOOD_ICONS[idx % FOOD_ICONS.length];
        const isHot = idx < 2;
        return `
            <div class="detail-item">
                <div class="detail-item-img">${icon}</div>
                <div class="detail-item-body">
                    <div class="detail-item-name">${item.name} ${isHot ? '<span class="detail-item-hot">🔥 热销</span>' : ''}</div>
                    <div class="detail-item-sales">月售${Math.floor(r.monthly_sales * (1 - idx * 0.1))}</div>
                    <div class="detail-item-bottom">
                        <span class="detail-item-price">¥<strong>${item.price}</strong></span>
                        <div class="detail-item-actions">
                            ${qty > 0 ? `
                                <button class="food-minus" onclick="event.stopPropagation(); removeFromCart('${r.id}-${idx}'); renderDetailModal(); updateCartUI();">−</button>
                                <span class="food-qty">${qty}</span>
                            ` : ''}
                            <button class="food-add" onclick="event.stopPropagation(); addToCart(${r.id}, ${idx}); renderDetailModal(); updateCartUI();">${qty > 0 ? '+' : '加入购物车'}</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const promosHtml = (r.promos || []).map(p => `
        <div class="detail-promo">
            <span class="detail-promo-tag">减</span>
            <span>${p}</span>
        </div>
    `).join('');

    body.innerHTML = `
        <div class="detail-shop-top">
            <div class="detail-shop-info">
                <div class="detail-shop-avatar">🍽️</div>
                <div>
                    <h2 class="detail-shop-name">${r.name}</h2>
                    <div class="detail-shop-meta">
                        <span class="detail-star">★ ${r.rating}</span>
                        <span class="detail-divider"></span>
                        <span>月售${r.monthly_sales}</span>
                        <span class="detail-divider"></span>
                        <span>${r.delivery_time}</span>
                        <span class="detail-divider"></span>
                        <span>${r.distance}</span>
                    </div>
                    <div class="detail-shop-sub">${r.min_order} | ${r.delivery_fee}</div>
                </div>
                <button class="fav-btn ${isFav ? 'active' : ''}" onclick="event.stopPropagation(); toggleFavorite(${r.id}); renderDetailModal();" style="position:absolute;top:0;right:0;">${isFav ? '❤️' : '🤍'}</button>
            </div>
            <div class="detail-shop-tags">${(r.tags || []).map(t => `<span class="detail-tag">${t}</span>`).join('')}</div>
            ${promosHtml ? `<div class="detail-shop-promos"><span class="detail-promo-label">优惠</span>${promosHtml}</div>` : ''}
        </div>

        <div class="detail-menu">
            <div class="detail-menu-title">推荐 · ${r.items ? r.items.length : 0}款</div>
            <div class="detail-menu-items">${itemsHtml}</div>
        </div>

        ${cartCount > 0 ? `
            <div class="detail-cart-bar">
                <div class="detail-cart-left" onclick="closeDetailModal(); openCart();">
                    <div class="detail-cart-icon-wrap"><span>🛒</span><span class="detail-cart-badge">${cartCount}</span></div>
                    <span class="detail-cart-total">¥${cartTotal.toFixed(2)}</span>
                </div>
                <button class="detail-cart-btn" onclick="closeDetailModal(); openCart();">去结算</button>
            </div>
        ` : ''}
    `;
}

function closeDetailModal() {
    document.getElementById('restaurantDetailModal').classList.remove('active');
    document.body.style.overflow = '';
    _detailRestaurantId = null;
    _detailData = null;
}

async function openRestaurantDetail(restaurantId) {
    _detailRestaurantId = restaurantId;
    const modal = document.getElementById('restaurantDetailModal');
    const body = document.getElementById('restaurantDetailBody');
    body.innerHTML = '<div style="text-align:center;padding:40px;color:#999;"><p>⏳ 加载中...</p></div>';
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    try {
        const r = await apiGet(`/restaurants/${restaurantId}`);
        // merge into local restaurants array so cart can find items later
        const local = restaurants.find(rr => rr.id === restaurantId);
        if (local) local.items = r.items;
        _detailData = r;
        renderDetailModal();
    } catch {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:#999;"><p>😵 加载失败</p></div>';
    }
}

function updateCartUI() {
    updateCart();
    if (_detailRestaurantId !== null && document.getElementById('restaurantDetailModal').classList.contains('active')) {
        renderDetailModal();
    }
}

// ===== Cart =====
function addToCart(restaurantId, itemIdx) {
    const r = restaurants.find(r => r.id === restaurantId);
    if (!r || !r.items || !r.items[itemIdx]) return;
    const item = r.items[itemIdx];
    const key = `${restaurantId}-${itemIdx}`;
    const ex = cart.find(c => c.key === key);
    if (ex) ex.qty += 1; else cart.push({ key, restaurantName: r.name, itemName: item.name, price: item.price, qty: 1 });
    saveCart(); updateCartUI();
    showToast(`已添加 ${item.name} 到购物车`);
}

function removeFromCart(cartKey) {
    const idx = cart.findIndex(c => c.key === cartKey);
    if (idx === -1) return;
    if (cart[idx].qty > 1) cart[idx].qty -= 1; else cart.splice(idx, 1);
    saveCart(); updateCartUI();
}

function addToCartByKey(cartKey) { const [rid, iidx] = cartKey.split('-').map(Number); addToCart(rid, iidx); }

function updateCart() {
    const count = cart.reduce((s, c) => s + c.qty, 0);
    const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
    const el = document.getElementById('cartItems');
    const totalEl = document.getElementById('cartTotal');
    const btn = document.getElementById('checkoutBtn');
    const badge = document.getElementById('cartBadge');
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? '' : 'none'; }
    if (cart.length === 0) {
        el.innerHTML = '<div class="cart-empty"><span class="cart-empty-icon">🛒</span><p>购物车是空的</p><p class="cart-empty-hint">去选几样好吃的吧</p></div>';
        btn.classList.add('disabled'); btn.textContent = '去结算';
    } else {
        el.innerHTML = cart.map(c =>
            `<div class="cart-item">
                <div class="cart-item-info"><div class="cart-item-name">${c.itemName}</div><div class="cart-item-price">¥${c.price}</div></div>
                <div class="cart-item-qty">
                    <button class="qty-btn minus" onclick="removeFromCart('${c.key}')">−</button>
                    <span class="qty-num">${c.qty}</span>
                    <button class="qty-btn" onclick="addToCartByKey('${c.key}')">+</button>
                </div>
            </div>`
        ).join('');
        btn.classList.remove('disabled'); btn.textContent = `去结算 · ${count}件`;
    }
    totalEl.textContent = `¥${total.toFixed(2)}`;
}

// ===== Orders =====
const STATUS_MAP = { pending: '待确认', confirmed: '已确认', preparing: '准备中', delivering: '配送中', delivered: '已到达', cancelled: '已取消' };

async function openOrders() {
    if (!currentUser) { showToast('请先登录查看订单'); openAuthModal('login'); return; }
    const modal = document.getElementById('ordersModal');
    const list = document.getElementById('ordersList');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    list.innerHTML = '<div style="text-align:center;padding:40px 0;color:#999;"><p>⏳ 加载中...</p></div>';
    try {
        const orders = await apiGet('/orders/mine');
        if (orders.length === 0) {
            list.innerHTML = '<div class="cart-empty"><span class="cart-empty-icon">📋</span><p>暂无订单</p><p class="cart-empty-hint">去下单点好吃的吧</p></div>';
        } else {
            list.innerHTML = orders.map(o =>
                `<div class="order-card">
                    <div class="order-card-header"><span class="order-id">订单 #${o.id}</span><span class="order-status ${o.status}">${STATUS_MAP[o.status] || o.status}</span></div>
                    <div class="order-card-items">${(o.items || []).map(i => `${i.item_name} ×${i.quantity}`).join('、')}</div>
                    <div class="order-card-total">¥${parseFloat(o.total_price).toFixed(2)}</div>
                    <div class="order-card-time">${formatTime(o.created_at)}</div>
                </div>`
            ).join('');
        }
    } catch { list.innerHTML = '<div style="text-align:center;padding:40px 0;color:#999;"><p>😵 加载失败</p></div>'; }
}

function formatTime(t) {
    if (!t) return '';
    const d = new Date(t + 'Z');
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ===== Favorites Modal =====
async function openFavoritesModal() {
    if (!currentUser) { showToast('请先登录查看收藏'); openAuthModal('login'); return; }
    const modal = document.getElementById('favoritesModal');
    const list = document.getElementById('favoritesList');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    list.innerHTML = '<div style="text-align:center;padding:40px 0;color:#999;"><p>⏳ 加载中...</p></div>';
    try {
        const favs = await apiGet('/favorites/details');
        if (favs.length === 0) {
            list.innerHTML = '<div class="cart-empty"><span class="cart-empty-icon">❤️</span><p>还没有收藏的商家</p><p class="cart-empty-hint">去发现美食吧</p></div>';
        } else {
            list.innerHTML = favs.map(r =>
                `<div class="fav-card">
                    <div class="fav-card-icon">🍽️</div>
                    <div class="fav-card-info"><div class="fav-card-name">${r.name}</div><div class="fav-card-rating">★ ${r.rating} · 月售${r.monthly_sales}</div></div>
                    <button class="fav-card-remove" onclick="removeFavAndRefresh(${r.id})">取消收藏</button>
                </div>`
            ).join('');
        }
    } catch { list.innerHTML = '<div style="text-align:center;padding:40px 0;color:#999;"><p>😵 加载失败</p></div>'; }
}

async function removeFavAndRefresh(restaurantId) {
    try { await apiDelete(`/favorites/${restaurantId}`); favoriteIds.delete(restaurantId); renderAllCards(); openFavoritesModal(); showToast('已取消收藏'); } catch { showToast('操作失败'); }
}

// ===== Page-Specific Content =====

// Food recommendations
const FOOD_CARDS = [
    { name: '麻辣香锅', desc: '鲜香麻辣，食欲大开', price: '¥28起', color: '#FFE8E8', icon: '🌶️' },
    { name: '日式拉面', desc: '浓郁豚骨汤底', price: '¥32起', color: '#FFF5E6', icon: '🍜' },
    { name: '韩式炸鸡', desc: '外酥里嫩，酱香浓郁', price: '¥22起', color: '#FFF0E6', icon: '🍗' },
    { name: '水果茶饮', desc: '新鲜水果，清爽一夏', price: '¥15起', color: '#E8F5FF', icon: '🧋' },
    { name: '寿司拼盘', desc: '精选刺身，入口即化', price: '¥45起', color: '#FFF5F5', icon: '🍣' },
    { name: '牛肉汉堡', desc: '安格斯牛肉饼', price: '¥26起', color: '#FFF5E6', icon: '🍔' },
    { name: '螺蛳粉', desc: '柳州正宗，酸辣鲜爽', price: '¥16起', color: '#FFE8E8', icon: '🍝' },
    { name: '红豆芋圆', desc: '手工制作，甜而不腻', price: '¥18起', color: '#FCE4EC', icon: '🍧' },
];

function renderFoodPage() {
    const grid = document.getElementById('foodGrid');
    if (!grid || grid.children.length > 0) return;
    grid.innerHTML = FOOD_CARDS.map(c =>
        `<div class="food-card">
            <div class="food-card-img" style="background:${c.color};">${c.icon}</div>
            <div class="food-card-body">
                <div class="food-card-name">${c.name}</div>
                <div class="food-card-desc">${c.desc}</div>
                <div class="food-card-price">${c.price}</div>
            </div>
        </div>`
    ).join('');
}

// Supermarket deals
const SUPERMARKET_DEALS = [
    { name: '有机生菜500g', price: '¥4.99', old: '¥8.90', sold: 2345, color: '#E8FFE8', icon: '🥬' },
    { name: '红富士苹果(5斤)', price: '¥19.90', old: '¥35.00', sold: 5678, color: '#FFF0E6', icon: '🍎' },
    { name: '纯牛奶1L', price: '¥9.90', old: '¥15.80', sold: 8912, color: '#E8F5FF', icon: '🥛' },
    { name: '鲜鸡蛋30枚', price: '¥23.80', old: '¥32.00', sold: 4567, color: '#FFF5E6', icon: '🥚' },
    { name: '速冻水饺(袋)', price: '¥12.90', old: '¥19.90', sold: 3456, color: '#E8E8FF', icon: '🥟' },
    { name: '可乐330ml×12', price: '¥29.90', old: '¥42.00', sold: 6789, color: '#FFE8E8', icon: '🥤' },
];

function renderSupermarketDeals() {
    const grid = document.getElementById('supermarketDeals');
    if (!grid || grid.children.length > 0) return;
    grid.innerHTML = SUPERMARKET_DEALS.map(d =>
        `<div class="deal-card">
            <div class="deal-card-img" style="background:${d.color};">${d.icon}</div>
            <div class="deal-card-body">
                <div class="deal-card-name">${d.name}</div>
                <div><span class="deal-card-price">${d.price}</span><span class="deal-card-old">${d.old}</span></div>
                <div class="deal-card-sold">已售${d.sold}</div>
            </div>
        </div>`
    ).join('');
}

// Tuangou deals
const TUANGOU_DEALS = [
    { name: '双人火锅套餐', price: '¥98', sold: '1.2万人', tag: '超值', color: '#FFE8E8', icon: '🍲' },
    { name: '日料自助(单人)', price: '¥158', sold: '8560人', tag: '热门', color: '#FFF5E6', icon: '🍣' },
    { name: '烤肉2-3人餐', price: '¥128', sold: '2.1万人', tag: '爆款', color: '#FFF0E6', icon: '🥩' },
    { name: '奶茶买一送一', price: '¥12', sold: '3.4万人', tag: '限时', color: '#FCE4EC', icon: '🧋' },
    { name: '电影双人票', price: '¥59.9', sold: '6789人', tag: '特惠', color: '#E8F5FF', icon: '🎬' },
    { name: '美甲套餐', price: '¥68', sold: '4321人', tag: '新品', color: '#F3E5F5', icon: '💅' },
];

function renderTuangouDeals() {
    const grid = document.getElementById('tuangouGrid');
    if (!grid || grid.children.length > 0) return;
    grid.innerHTML = TUANGOU_DEALS.map(d =>
        `<div class="deal-card">
            <div class="deal-card-img" style="background:${d.color};">${d.icon}</div>
            <div class="deal-card-body">
                <div class="deal-card-name">${d.name}</div>
                <div><span class="deal-card-price">${d.price}</span><span class="deal-card-sold" style="margin-left:8px;color:#FF8C00;font-weight:500;">${d.tag}</span></div>
                <div class="deal-card-sold">已团 ${d.sold}</div>
            </div>
        </div>`
    ).join('');
}

// Yuding restaurants
const YUDING_LIST = [
    { name: '大董烤鸭', tag: '黑珍珠一钻', desc: '烤鸭界天花板', color: '#FFF5E6', icon: '🦆' },
    { name: '鼎泰丰', tag: '米其林星级', desc: '经典小笼包', color: '#E8F5FF', icon: '🥟' },
    { name: '海底捞', tag: '人气爆棚', desc: '服务一流', color: '#FFE8E8', icon: '🍲' },
    { name: '西贝莜面村', tag: '西北风情', desc: '地道西北菜', color: '#FFF0E6', icon: '🍜' },
    { name: '新荣记', tag: '高端中餐', desc: '台州海鲜', color: '#E8FFE8', icon: '🦐' },
    { name: '花胶鸡火锅', tag: '养生滋补', desc: '浓郁花胶鸡汤', color: '#FFF5F5', icon: '🍗' },
];

function renderYudingList() {
    const grid = document.getElementById('yudingGrid');
    if (!grid || grid.children.length > 0) return;
    grid.innerHTML = YUDING_LIST.map(d =>
        `<div class="deal-card">
            <div class="deal-card-img" style="background:${d.color};">${d.icon}</div>
            <div class="deal-card-body">
                <div class="deal-card-name">${d.name}</div>
                <div><span style="font-size:12px;color:#FF8C00;font-weight:500;">${d.tag}</span></div>
                <div class="deal-card-sold">${d.desc}</div>
            </div>
        </div>`
    ).join('');
}

// ===== Toast =====
let toastTimer;
function showToast(msg) {
    let toast = document.querySelector('.toast');
    if (!toast) { toast = document.createElement('div'); toast.className = 'toast'; document.body.appendChild(toast); }
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ===== DOM Ready =====
document.addEventListener('DOMContentLoaded', async () => {
    loadCart();

    // Router init
    document.querySelectorAll('.nav-item[data-route]').forEach(el => el.addEventListener('click', handleNavClick));
    window.addEventListener('popstate', resolveRoute);
    resolveRoute();

    await checkAuth();
    updateLocationUI();
    await loadRestaurants(currentSort, activeCategory);
    updateCart();

    // Auth modal
    document.getElementById('authLink').addEventListener('click', (e) => { e.preventDefault(); if (!currentUser) openAuthModal('login'); });
    document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); handleLogout(); });
    document.getElementById('authModalClose').addEventListener('click', closeAuthModal);
    document.getElementById('authModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeAuthModal(); });
    document.querySelectorAll('.modal-tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);

    // Location picker
    const locationEl = document.querySelector('.location');
    const locationPicker = document.getElementById('locationPicker');
    const locationPickerClose = document.getElementById('locationPickerClose');
    if (locationEl) {
        locationEl.addEventListener('click', () => {
            locationPicker.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    }
    if (locationPickerClose) {
        locationPickerClose.addEventListener('click', () => {
            locationPicker.classList.remove('active');
            document.body.style.overflow = '';
        });
    }
    if (locationPicker) {
        locationPicker.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                locationPicker.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
        // City selection
        locationPicker.querySelectorAll('.city-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const city = opt.dataset.city;
                if (city === currentCity) {
                    locationPicker.classList.remove('active');
                    document.body.style.overflow = '';
                    return;
                }
                currentCity = city;
                localStorage.setItem('currentCity', city);
                updateLocationUI();
                loadRestaurants(currentSort, activeCategory);
                locationPicker.classList.remove('active');
                document.body.style.overflow = '';
            });
        });
    }

    // Orders modal
    document.getElementById('myOrdersLink').addEventListener('click', (e) => { e.preventDefault(); openOrders(); });
    document.getElementById('ordersModalClose').addEventListener('click', () => { document.getElementById('ordersModal').classList.remove('active'); document.body.style.overflow = ''; });
    document.getElementById('ordersModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) { document.getElementById('ordersModal').classList.remove('active'); document.body.style.overflow = ''; } });

    // Favorites modal
    document.getElementById('myFavoritesLink').addEventListener('click', (e) => { e.preventDefault(); openFavoritesModal(); });
    document.getElementById('favoritesModalClose').addEventListener('click', () => { document.getElementById('favoritesModal').classList.remove('active'); document.body.style.overflow = ''; });
    document.getElementById('favoritesModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) { document.getElementById('favoritesModal').classList.remove('active'); document.body.style.overflow = ''; } });

    // Restaurant detail modal
    document.getElementById('restaurantDetailClose').addEventListener('click', closeDetailModal);
    document.getElementById('restaurantDetailModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDetailModal(); });

    // Cart sidebar
    const cartBtn = document.querySelector('.cart-btn');
    const cartClose = document.getElementById('cartClose');
    const cartSidebar = document.getElementById('cartSidebar');
    const cartOverlay = document.getElementById('cartOverlay');
    const cartFloatBtn = document.getElementById('cartFloatBtn');
    const checkoutBtn = document.getElementById('checkoutBtn');

    function openCart() { cartSidebar.classList.add('active'); cartOverlay.classList.add('active'); document.body.style.overflow = 'hidden'; }
    function closeCart() { cartSidebar.classList.remove('active'); cartOverlay.classList.remove('active'); document.body.style.overflow = ''; }

    if (cartBtn) cartBtn.addEventListener('click', (e) => { e.preventDefault(); openCart(); });
    if (cartClose) cartClose.addEventListener('click', closeCart);
    if (cartOverlay) cartOverlay.addEventListener('click', closeCart);
    if (cartFloatBtn) cartFloatBtn.addEventListener('click', openCart);

    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', async () => {
            if (cart.length === 0 || checkoutBtn.classList.contains('disabled')) return;
            const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
            try {
                const order = await apiPost('/orders', { items: cart.map(c => ({ name: c.itemName, price: c.price, quantity: c.qty })) });
                cart = []; saveCart(); updateCart(); closeCart();
                showToast(`🎉 订单 #${order.id} 已提交！合计 ¥${total.toFixed(2)}`);
            } catch { showToast('😵 下单失败，请稍后重试'); }
        });
    }

    // Category filtering (金刚区)
    const categoryGrid = document.getElementById('categoryGrid');
    if (categoryGrid) {
        categoryGrid.addEventListener('click', (e) => {
            const item = e.target.closest('.category-item');
            if (!item) return;

            const catId = parseInt(item.dataset.categoryId);
            if (isNaN(catId)) return;

            // Deselect if clicking the same one (except "全部")
            if (catId === activeCategory && catId !== 0) {
                activeCategory = 0;
            } else {
                activeCategory = catId;
            }

            // Update visual
            categoryGrid.querySelectorAll('.category-item').forEach(el => {
                const id = parseInt(el.dataset.categoryId);
                el.classList.toggle('active', id === activeCategory);

                // Highlight the icon for the active category
                const icon = el.querySelector('.category-icon');
                if (id === activeCategory && icon) {
                    icon.style.background = '#FF8C00';
                    icon.style.color = '#fff';
                } else if (icon) {
                    // Restore original color based on data
                    const bgColors = { 0: '#f0f0f0', 1: '#FFF5E6', 2: '#FFE8E8', 3: '#E8F5FF', 4: '#FFF0E6', 5: '#E8FFE8', 6: '#FFF5E6', 7: '#FFE8E8', 8: '#E8F5FF', 9: '#FFF0E6', 10: '#E8FFE8' };
                    icon.style.background = bgColors[id] || '#f5f5f5';
                    icon.style.color = '';
                }
            });

            // Reload with current category + sort
            loadRestaurants(currentSort, activeCategory);
        });
    }

    // Filters (delivery page) — preserve category
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const map = { '好评优先': 'rating', '评分最高': 'rating', '起送价最低': 'min_order', '配送最快': 'delivery_time' };
            currentSort = map[btn.textContent.trim()] || '';
            loadRestaurants(currentSort, activeCategory);
        });
    });

    // Search — preserve category filter
    const searchInput = document.getElementById('globalSearch');
    const searchBtn = document.getElementById('globalSearchBtn');
    async function doSearch() {
        const q = searchInput.value.trim();
        if (!q) { await loadRestaurants(currentSort, activeCategory); return; }
        try {
            const params = new URLSearchParams();
            params.set('search', q);
            if (activeCategory) params.set('category_id', activeCategory);
            if (currentCity) params.set('city', currentCity);
            restaurants = await apiGet(`/restaurants?${params}`);
            renderAllCards(); updateResultCount(restaurants.length);
            if (restaurants.length === 0) showEmptyState();
        } catch { showToast('搜索失败'); }
    }
    if (searchBtn) searchBtn.addEventListener('click', doSearch);
    if (searchInput) searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
});
