const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Database
const db = getDatabase();

// ===== API Routes =====

// Get all categories
app.get('/api/categories', (req, res) => {
    const categories = db.prepare('SELECT * FROM categories').all();
    res.json({ success: true, data: categories });
});

// Get all restaurants with optional filters
app.get('/api/restaurants', (req, res) => {
    const { category_id, sort, search, city } = req.query;

    let sql = `
        SELECT r.*,
               GROUP_CONCAT(DISTINCT rt.tag) as tags,
               GROUP_CONCAT(DISTINCT p.description) as promos
        FROM restaurants r
        LEFT JOIN restaurant_tags rt ON r.id = rt.restaurant_id
        LEFT JOIN promos p ON r.id = p.restaurant_id
    `;

    const conditions = [];
    const params = [];

    if (category_id) {
        conditions.push('r.category_id = ?');
        params.push(category_id);
    }

    if (search) {
        conditions.push("(r.name LIKE ? OR rt.tag LIKE ?)");
        const like = `%${search}%`;
        params.push(like, like);
    }

    if (city) {
        conditions.push('r.city = ?');
        params.push(city);
    }

    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' GROUP BY r.id';

    switch (sort) {
        case 'rating':
            sql += ' ORDER BY r.rating DESC';
            break;
        case 'sales':
            sql += ' ORDER BY r.monthly_sales DESC';
            break;
        case 'delivery_time':
            sql += " ORDER BY CAST(SUBSTR(r.delivery_time, 1, LENGTH(r.delivery_time)-2) AS INTEGER) ASC";
            break;
        case 'min_order':
            sql += " ORDER BY CAST(SUBSTR(r.min_order, 2, INSTR(r.min_order, '起')-2) AS INTEGER) ASC";
            break;
        default:
            sql += ' ORDER BY r.monthly_sales DESC';
    }

    try {
        const restaurants = db.prepare(sql).all(...params);
        const result = restaurants.map(r => ({
            ...r,
            tags: r.tags ? r.tags.split(',') : [],
            promos: r.promos ? r.promos.split(',') : [],
        }));
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('Query error:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// Get a single restaurant with menu items
app.get('/api/restaurants/:id', (req, res) => {
    const { id } = req.params;

    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id);
    if (!restaurant) {
        return res.status(404).json({ success: false, message: '商家不存在' });
    }

    const tags = db.prepare('SELECT tag FROM restaurant_tags WHERE restaurant_id = ?').all(id).map(t => t.tag);
    const promos = db.prepare('SELECT description FROM promos WHERE restaurant_id = ?').all(id).map(p => p.description);
    const items = db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ?').all(id);

    res.json({
        success: true,
        data: { ...restaurant, tags, promos, items }
    });
});

// ===== Auth Middleware =====
function getCurrentUser(req) {
    const token = req.headers['authorization'];
    if (!token) return null;
    const session = db.prepare(
        "SELECT s.user_id, u.username, u.phone, u.address FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.user_id IS NOT NULL"
    ).get(token);
    return session || null;
}

// ===== Auth Routes =====

// Register
app.post('/api/auth/register', (req, res) => {
    const { username, password, phone } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    if (username.length < 2 || username.length > 20) {
        return res.status(400).json({ success: false, message: '用户名长度需在2-20个字符之间' });
    }
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: '密码长度至少6位' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
        return res.status(409).json({ success: false, message: '用户名已存在' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const token = crypto.randomBytes(32).toString('hex');

    const transaction = db.transaction(() => {
        const result = db.prepare('INSERT INTO users (username, password_hash, phone) VALUES (?, ?, ?)').run(username, passwordHash, phone || '');
        db.prepare('INSERT INTO sessions (user_id, token) VALUES (?, ?)').run(result.lastInsertRowid, token);
        return { userId: result.lastInsertRowid, token };
    });

    try {
        const { userId, token } = transaction();
        res.status(201).json({
            success: true,
            data: { userId, username, token, phone: phone || '' },
            message: '🎉 注册成功！'
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: '注册失败，请稍后重试' });
    }
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
        return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (user_id, token) VALUES (?, ?)').run(user.id, token);

    res.json({
        success: true,
        data: { userId: user.id, username: user.username, token, phone: user.phone, address: user.address },
        message: '👋 登录成功！'
    });
});

// Get current user (check token)
app.get('/api/auth/me', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) {
        return res.status(401).json({ success: false, message: '未登录或登录已过期' });
    }
    res.json({ success: true, data: user });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    const token = req.headers['authorization'];
    if (token) {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    res.json({ success: true, message: '已退出登录' });
});

// Update user profile
app.put('/api/auth/profile', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) {
        return res.status(401).json({ success: false, message: '未登录' });
    }

    const { phone, address } = req.body;
    db.prepare('UPDATE users SET phone = ?, address = ? WHERE id = ?').run(phone || '', address || '', user.user_id);

    res.json({ success: true, data: { ...user, phone: phone || '', address: address || '' }, message: '✅ 信息已更新' });
});

// ===== Favorites Routes =====

// Get user's favorites (restaurant IDs)
app.get('/api/favorites', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ success: false, message: '请先登录' });
    const favs = db.prepare('SELECT restaurant_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC').all(user.user_id);
    res.json({ success: true, data: favs.map(f => f.restaurant_id) });
});

// Get favorite restaurants with full details
app.get('/api/favorites/details', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ success: false, message: '请先登录' });
    const restaurants = db.prepare(`
        SELECT r.*, f.created_at as fav_time,
               GROUP_CONCAT(DISTINCT rt.tag) as tags,
               GROUP_CONCAT(DISTINCT p.description) as promos
        FROM favorites f JOIN restaurants r ON r.id = f.restaurant_id
        LEFT JOIN restaurant_tags rt ON r.id = rt.restaurant_id
        LEFT JOIN promos p ON r.id = p.restaurant_id
        WHERE f.user_id = ? GROUP BY r.id ORDER BY f.created_at DESC
    `).all(user.user_id);
    const result = restaurants.map(r => ({ ...r, tags: r.tags ? r.tags.split(',') : [], promos: r.promos ? r.promos.split(',') : [] }));
    res.json({ success: true, data: result });
});

// Add a favorite
app.post('/api/favorites', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ success: false, message: '请先登录' });
    const { restaurant_id } = req.body;
    if (!restaurant_id) return res.status(400).json({ success: false, message: '缺少商家ID' });
    try {
        db.prepare('INSERT OR IGNORE INTO favorites (user_id, restaurant_id) VALUES (?, ?)').run(user.user_id, restaurant_id);
        res.json({ success: true, message: '已收藏' });
    } catch (err) { res.status(500).json({ success: false, message: '操作失败' }); }
});

// Remove a favorite
app.delete('/api/favorites/:restaurantId', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ success: false, message: '请先登录' });
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND restaurant_id = ?').run(user.user_id, req.params.restaurantId);
    res.json({ success: true, message: '已取消收藏' });
});

// ===== Merchant Auth =====
function getCurrentMerchant(req) {
    const token = req.headers['authorization'];
    if (!token) return null;
    return db.prepare(
        'SELECT s.merchant_id, m.username, m.restaurant_id, m.phone FROM sessions s JOIN merchants m ON s.merchant_id = m.id WHERE s.token = ? AND s.merchant_id IS NOT NULL'
    ).get(token) || null;
}

// Merchant Login
app.post('/api/merchant/auth/login', (req, res) => {
    const { username, password } = req.body;
    const merchant = db.prepare('SELECT * FROM merchants WHERE username = ?').get(username);
    if (!merchant || !bcrypt.compareSync(password, merchant.password_hash)) {
        return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (merchant_id, token) VALUES (?, ?)').run(merchant.id, token);
    res.json({ success: true, data: { merchantId: merchant.id, username, token, restaurantId: merchant.restaurant_id, phone: merchant.phone } });
});

// Merchant: get my restaurant
app.get('/api/merchant/restaurant', (req, res) => {
    const m = getCurrentMerchant(req);
    if (!m) return res.status(401).json({ success: false, message: '请先登录' });
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(m.restaurant_id);
    if (!restaurant) return res.status(404).json({ success: false, message: '店铺不存在' });
    const items = db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ?').all(m.restaurant_id);
    const tags = db.prepare('SELECT tag FROM restaurant_tags WHERE restaurant_id = ?').all(m.restaurant_id).map(t => t.tag);
    const promos = db.prepare('SELECT description FROM promos WHERE restaurant_id = ?').all(m.restaurant_id).map(p => p.description);
    res.json({ success: true, data: { ...restaurant, items, tags, promos } });
});

// Merchant: update restaurant
app.put('/api/merchant/restaurant', (req, res) => {
    const m = getCurrentMerchant(req);
    if (!m) return res.status(401).json({ success: false, message: '请先登录' });
    const { name, delivery_time, distance, min_order, delivery_fee, badge } = req.body;
    db.prepare('UPDATE restaurants SET name=?, delivery_time=?, distance=?, min_order=?, delivery_fee=?, badge=? WHERE id=?')
        .run(name, delivery_time, distance, min_order, delivery_fee, badge, m.restaurant_id);
    res.json({ success: true, message: '已更新' });
});

// Merchant: add menu item
app.post('/api/merchant/menu-items', (req, res) => {
    const m = getCurrentMerchant(req);
    if (!m) return res.status(401).json({ success: false, message: '请先登录' });
    const { name, price } = req.body;
    if (!name || !price) return res.status(400).json({ success: false, message: '菜品名和价格不能为空' });
    const result = db.prepare('INSERT INTO menu_items (restaurant_id, name, price) VALUES (?, ?, ?)').run(m.restaurant_id, name, price);
    res.status(201).json({ success: true, data: { id: result.lastInsertRowid, name, price } });
});

// Merchant: update menu item
app.put('/api/merchant/menu-items/:id', (req, res) => {
    const m = getCurrentMerchant(req);
    if (!m) return res.status(401).json({ success: false, message: '请先登录' });
    const { name, price } = req.body;
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?').get(req.params.id, m.restaurant_id);
    if (!item) return res.status(404).json({ success: false, message: '菜品不存在' });
    db.prepare('UPDATE menu_items SET name=?, price=? WHERE id=?').run(name, price, req.params.id);
    res.json({ success: true, message: '已更新' });
});

// Merchant: delete menu item
app.delete('/api/merchant/menu-items/:id', (req, res) => {
    const m = getCurrentMerchant(req);
    if (!m) return res.status(401).json({ success: false, message: '请先登录' });
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?').get(req.params.id, m.restaurant_id);
    if (!item) return res.status(404).json({ success: false, message: '菜品不存在' });
    db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '已删除' });
});

// Merchant: get orders
app.get('/api/merchant/orders', (req, res) => {
    const m = getCurrentMerchant(req);
    if (!m) return res.status(401).json({ success: false, message: '请先登录' });
    const orders = db.prepare(`
        SELECT o.* FROM orders o JOIN order_items oi ON o.id = oi.order_id
        WHERE oi.item_name IN (SELECT name FROM menu_items WHERE restaurant_id = ?)
        GROUP BY o.id ORDER BY o.created_at DESC
    `).all(m.restaurant_id);
    const result = orders.map(order => {
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
        return { ...order, items };
    });
    res.json({ success: true, data: result });
});

// Merchant: update order status
app.patch('/api/merchant/orders/:id/status', (req, res) => {
    const m = getCurrentMerchant(req);
    if (!m) return res.status(401).json({ success: false, message: '请先登录' });
    const { status } = req.body;
    const valid = ['confirmed', 'preparing', 'delivering', 'delivered', 'cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ success: false, message: '无效状态' });
    db.prepare("UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, req.params.id);
    res.json({ success: true, message: '状态已更新' });
});

// Merchant: stats
app.get('/api/merchant/stats', (req, res) => {
    const m = getCurrentMerchant(req);
    if (!m) return res.status(401).json({ success: false, message: '请先登录' });
    const today = db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(total_price),0) as revenue FROM orders WHERE DATE(created_at) = DATE('now') AND id IN (SELECT o.id FROM orders o JOIN order_items oi ON o.id=oi.order_id WHERE oi.item_name IN (SELECT name FROM menu_items WHERE restaurant_id=?))`).get(m.restaurant_id);
    const total = db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(total_price),0) as revenue FROM orders WHERE id IN (SELECT o.id FROM orders o JOIN order_items oi ON o.id=oi.order_id WHERE oi.item_name IN (SELECT name FROM menu_items WHERE restaurant_id=?))`).get(m.restaurant_id);
    res.json({ success: true, data: { todayOrders: today.count, todayRevenue: today.revenue, totalOrders: total.count, totalRevenue: total.revenue } });
});

// ===== Admin Auth =====
function getCurrentAdmin(req) {
    const token = req.headers['authorization'];
    if (!token) return null;
    return db.prepare(
        'SELECT s.admin_id, a.username FROM sessions s JOIN admins a ON s.admin_id = a.id WHERE s.token = ? AND s.admin_id IS NOT NULL'
    ).get(token) || null;
}

// Admin Login
app.post('/api/admin/auth/login', (req, res) => {
    const { username, password } = req.body;
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
        return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (admin_id, token) VALUES (?, ?)').run(admin.id, token);
    res.json({ success: true, data: { adminId: admin.id, username, token } });
});

// Admin: platform stats
app.get('/api/admin/stats', (req, res) => {
    const a = getCurrentAdmin(req);
    if (!a) return res.status(401).json({ success: false, message: '请先登录' });
    const restaurants = db.prepare('SELECT COUNT(*) as count FROM restaurants').get().count;
    const users = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const orders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const revenue = db.prepare("SELECT COALESCE(SUM(total_price),0) as total FROM orders WHERE status != 'cancelled'").get().total;
    res.json({ success: true, data: { restaurants, users, orders, revenue } });
});

// Admin: all restaurants
app.get('/api/admin/restaurants', (req, res) => {
    const a = getCurrentAdmin(req);
    if (!a) return res.status(401).json({ success: false, message: '请先登录' });
    const list = db.prepare('SELECT * FROM restaurants ORDER BY created_at DESC').all();
    res.json({ success: true, data: list });
});

// Admin: add restaurant
app.post('/api/admin/restaurants', (req, res) => {
    const a = getCurrentAdmin(req);
    if (!a) return res.status(401).json({ success: false, message: '请先登录' });
    const { name, rating, monthly_sales, delivery_time, distance, min_order, delivery_fee, image, badge, city, category_id } = req.body;
    const result = db.prepare('INSERT INTO restaurants (name,rating,monthly_sales,delivery_time,distance,min_order,delivery_fee,image,badge,city,category_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(name, rating||4.5, monthly_sales||0, delivery_time||'30分钟', distance||'1.0km', min_order||'¥20起送', delivery_fee||'配送¥3', image||'', badge||'', city||'北京', category_id||1);
    res.status(201).json({ success: true, data: { id: result.lastInsertRowid, name } });
});

// Admin: update restaurant
app.put('/api/admin/restaurants/:id', (req, res) => {
    const a = getCurrentAdmin(req);
    if (!a) return res.status(401).json({ success: false, message: '请先登录' });
    const { name, rating, monthly_sales, delivery_time, distance, min_order, delivery_fee, city, category_id } = req.body;
    db.prepare('UPDATE restaurants SET name=?,rating=?,monthly_sales=?,delivery_time=?,distance=?,min_order=?,delivery_fee=?,city=?,category_id=? WHERE id=?')
        .run(name, rating, monthly_sales, delivery_time, distance, min_order, delivery_fee, city, category_id, req.params.id);
    res.json({ success: true, message: '已更新' });
});

// Admin: delete restaurant
app.delete('/api/admin/restaurants/:id', (req, res) => {
    const a = getCurrentAdmin(req);
    if (!a) return res.status(401).json({ success: false, message: '请先登录' });
    db.prepare('DELETE FROM restaurants WHERE id=?').run(req.params.id);
    db.prepare('DELETE FROM restaurant_tags WHERE restaurant_id=?').run(req.params.id);
    db.prepare('DELETE FROM promos WHERE restaurant_id=?').run(req.params.id);
    db.prepare('DELETE FROM menu_items WHERE restaurant_id=?').run(req.params.id);
    res.json({ success: true, message: '已删除' });
});

// Admin: all users
app.get('/api/admin/users', (req, res) => {
    const a = getCurrentAdmin(req);
    if (!a) return res.status(401).json({ success: false, message: '请先登录' });
    const users = db.prepare('SELECT id, username, phone, address, created_at FROM users ORDER BY created_at DESC').all();
    res.json({ success: true, data: users });
});

// Admin: all orders
app.get('/api/admin/orders', (req, res) => {
    const a = getCurrentAdmin(req);
    if (!a) return res.status(401).json({ success: false, message: '请先登录' });
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all();
    const result = orders.map(order => {
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
        return { ...order, items };
    });
    res.json({ success: true, data: result });
});

// Admin: categories
app.get('/api/admin/categories', (req, res) => {
    const a = getCurrentAdmin(req);
    if (!a) return res.status(401).json({ success: false, message: '请先登录' });
    const cats = db.prepare('SELECT * FROM categories ORDER BY id').all();
    res.json({ success: true, data: cats });
});

app.post('/api/admin/categories', (req, res) => {
    const a = getCurrentAdmin(req);
    if (!a) return res.status(401).json({ success: false, message: '请先登录' });
    const { name, icon, color } = req.body;
    const result = db.prepare('INSERT INTO categories (name, icon, color) VALUES (?,?,?)').run(name, icon||'🍽️', color||'#f5f5f5');
    res.status(201).json({ success: true, data: { id: result.lastInsertRowid, name, icon, color } });
});

app.put('/api/admin/categories/:id', (req, res) => {
    const a = getCurrentAdmin(req);
    if (!a) return res.status(401).json({ success: false, message: '请先登录' });
    const { name, icon, color } = req.body;
    db.prepare('UPDATE categories SET name=?,icon=?,color=? WHERE id=?').run(name, icon, color, req.params.id);
    res.json({ success: true, message: '已更新' });
});

app.delete('/api/admin/categories/:id', (req, res) => {
    const a = getCurrentAdmin(req);
    if (!a) return res.status(401).json({ success: false, message: '请先登录' });
    db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
    res.json({ success: true, message: '已删除' });
});

// Get current user's orders
app.get('/api/orders/mine', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ success: false, message: '请先登录' });
    const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(user.user_id);
    const result = orders.map(order => {
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
        return { ...order, items };
    });
    res.json({ success: true, data: result });
});

// Create an order (updated with user_id)
app.post('/api/orders', (req, res) => {
    const { customer_name, phone, address, items } = req.body;
    const currentUser = getCurrentUser(req);

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: '订单至少需要一件商品' });
    }

    const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const cols = currentUser
        ? 'INSERT INTO orders (user_id, customer_name, phone, address, total_price, status) VALUES (?, ?, ?, ?, ?, ?)'
        : 'INSERT INTO orders (customer_name, phone, address, total_price, status) VALUES (?, ?, ?, ?, ?)';

    const insertOrder = db.prepare(cols);
    const insertItem = db.prepare(
        'INSERT INTO order_items (order_id, item_name, price, quantity) VALUES (?, ?, ?, ?)'
    );

    const transaction = db.transaction(() => {
        let result;
        if (currentUser) {
            result = insertOrder.run(
                currentUser.user_id,
                customer_name || currentUser.username || '顾客',
                phone || currentUser.phone || '',
                address || currentUser.address || '',
                totalPrice,
                'pending'
            );
        } else {
            result = insertOrder.run(
                customer_name || '顾客',
                phone || '',
                address || '',
                totalPrice,
                'pending'
            );
        }

        const orderId = result.lastInsertRowid;
        for (const item of items) {
            insertItem.run(orderId, item.name, item.price, item.quantity);
        }
        return orderId;
    });

    try {
        const orderId = transaction();
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        res.status(201).json({ success: true, data: order, message: '🎉 下单成功！' });
    } catch (err) {
        console.error('Order error:', err);
        res.status(500).json({ success: false, message: '下单失败，请稍后重试' });
    }
});

// Get order status
app.get('/api/orders/:id', (req, res) => {
    const { id } = req.params;
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);

    if (!order) {
        return res.status(404).json({ success: false, message: '订单不存在' });
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);

    res.json({ success: true, data: { ...order, items } });
});

// Update order status (simulate delivery progress)
app.patch('/api/orders/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'confirmed', 'preparing', 'delivering', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: '无效的状态值' });
    }

    const result = db.prepare("UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
    if (result.changes === 0) {
        return res.status(404).json({ success: false, message: '订单不存在' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    res.json({ success: true, data: order });
});

// Get all orders (with optional limit)
app.get('/api/orders', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit);

    const result = orders.map(order => {
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
        return { ...order, items };
    });

    res.json({ success: true, data: result });
});

// Serve merchant and admin pages
app.get('/merchant', (req, res) => res.sendFile(path.join(__dirname, 'merchant.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// Fallback — serve HTML for non-API routes
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ success: false, message: '接口不存在' });
    } else {
        res.sendFile(path.join(__dirname, 'index.html'));
    }
});

// ===== Start Server =====
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  🚀 陈鸿外卖服务已启动`);
    console.log(`  📡 地址: http://localhost:${PORT}`);
    console.log(`  🛒 API:  http://localhost:${PORT}/api`);
    console.log(`========================================\n`);
});
