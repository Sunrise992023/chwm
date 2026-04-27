const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'delivery.db');

function initDatabase() {
    const db = new Database(DB_PATH);

    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');

    db.exec(`
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            icon TEXT NOT NULL,
            color TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS restaurants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            rating REAL NOT NULL DEFAULT 4.5,
            monthly_sales INTEGER NOT NULL DEFAULT 0,
            delivery_time TEXT NOT NULL DEFAULT '30分钟',
            distance TEXT NOT NULL DEFAULT '1.0km',
            min_order TEXT NOT NULL DEFAULT '¥20起送',
            delivery_fee TEXT NOT NULL DEFAULT '配送¥3',
            image TEXT,
            badge TEXT,
            city TEXT NOT NULL DEFAULT '北京',
            category_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (category_id) REFERENCES categories(id)
        );

        CREATE TABLE IF NOT EXISTS restaurant_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            restaurant_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
        );

        CREATE TABLE IF NOT EXISTS promos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            restaurant_id INTEGER NOT NULL,
            description TEXT NOT NULL,
            FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
        );

        CREATE TABLE IF NOT EXISTS menu_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            restaurant_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
        );

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            phone TEXT DEFAULT '',
            address TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            merchant_id INTEGER,
            admin_id INTEGER,
            token TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (merchant_id) REFERENCES merchants(id),
            FOREIGN KEY (admin_id) REFERENCES admins(id)
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            customer_name TEXT NOT NULL DEFAULT '顾客',
            phone TEXT,
            address TEXT,
            total_price REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            restaurant_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (restaurant_id) REFERENCES restaurants(id),
            UNIQUE(user_id, restaurant_id)
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            item_name TEXT NOT NULL,
            price REAL NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (order_id) REFERENCES orders(id)
        );

        CREATE TABLE IF NOT EXISTS merchants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            restaurant_id INTEGER UNIQUE NOT NULL,
            phone TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
        );

        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Migration: add city column to restaurants if missing
    try {
        db.exec("ALTER TABLE restaurants ADD COLUMN city TEXT NOT NULL DEFAULT '北京'");
    } catch (e) {
        // column already exists
    }

    // Migration: assign cities to existing restaurants that have default city
    const uncategorized = db.prepare("SELECT id FROM restaurants WHERE city = '北京' AND id > 0").all();
    if (uncategorized.length > 0) {
        const cityMap = { 1: '北京', 2: '北京', 3: '北京', 4: '上海', 5: '上海', 6: '北京', 7: '上海', 8: '北京', 9: '上海', 10: '北京', 11: '上海', 12: '上海' };
        const update = db.prepare('UPDATE restaurants SET city = ? WHERE id = ?');
        for (const r of uncategorized) {
            const city = cityMap[r.id] || '北京';
            update.run(city, r.id);
        }
    }

    return db;
}

function seedDatabase(db) {
    const count = db.prepare('SELECT COUNT(*) as count FROM restaurants').get();
    if (count.count > 0) return;

    console.log('🌱 Seeding database...');

    const insertCategory = db.prepare('INSERT INTO categories (name, icon, color) VALUES (?, ?, ?)');
    const insertRestaurant = db.prepare(
        'INSERT INTO restaurants (id, name, rating, monthly_sales, delivery_time, distance, min_order, delivery_fee, image, badge, city, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertTag = db.prepare('INSERT INTO restaurant_tags (restaurant_id, tag) VALUES (?, ?)');
    const insertPromo = db.prepare('INSERT INTO promos (restaurant_id, description) VALUES (?, ?)');
    const insertItem = db.prepare('INSERT INTO menu_items (restaurant_id, name, price) VALUES (?, ?, ?)');

    const transaction = db.transaction(() => {
        // Categories
        const categories = [
            ['美食', '🍔', '#FFF5E6'],
            ['甜品', '🍰', '#FFE8E8'],
            ['饮品', '🥤', '#E8F5FF'],
            ['粉面', '🍜', '#FFF0E6'],
            ['轻食', '🥗', '#E8FFE8'],
            ['日料', '🍣', '#FFF5E6'],
            ['火锅', '🌶️', '#FFE8E8'],
            ['披萨', '🍕', '#E8F5FF'],
            ['烤肉', '🥩', '#FFF0E6'],
            ['便当', '🍱', '#E8FFE8'],
        ];
        categories.forEach(c => insertCategory.run(...c));

        // Restaurants with their data
        const restaurantData = [
            {
                id: 1, name: '麦当劳（朝阳店）', city: '北京', rating: 4.8, sales: 9999, time: '25分钟',
                dist: '1.2km', minOrder: '¥20起送', fee: '配送¥3',
                image: '/images/mcdonalds.jpg', badge: '月售9999+', catId: 1,
                tags: ['汉堡', '薯条', '饮品'],
                promos: ['新用户立减15元', '满30减10'],
                items: [
                    ['巨无霸套餐', 36],
                    ['麦辣鸡腿堡套餐', 32],
                    ['薯条（大份）', 14],
                    ['可乐（大杯）', 10]
                ]
            },
            {
                id: 2, name: '杨国福麻辣烫', city: '北京', rating: 4.6, sales: 8765, time: '30分钟',
                dist: '0.8km', minOrder: '¥15起送', fee: '配送¥2',
                image: '/images/yangguofu.jpg', badge: '月售8765', catId: 1,
                tags: ['麻辣烫', '麻辣拌', '自选'],
                promos: ['满25减5', '新用户立减10元'],
                items: [
                    ['经典麻辣烫', 22],
                    ['麻辣拌（小份）', 16],
                    ['加牛肉', 8],
                    ['加方便面', 3]
                ]
            },
            {
                id: 3, name: '肯德基（望京店）', city: '北京', rating: 4.7, sales: 6543, time: '28分钟',
                dist: '1.5km', minOrder: '¥25起送', fee: '配送¥4',
                image: '/images/kfc.jpg', badge: '品牌店', catId: 1,
                tags: ['炸鸡', '汉堡', '蛋挞'],
                promos: ['新用户立减15元', '满39减8'],
                items: [
                    ['香辣鸡腿堡套餐', 35],
                    ['奥尔良烤鸡翅（4块）', 12],
                    ['葡式蛋挞（2只）', 10],
                    ['土豆泥', 8]
                ]
            },
            {
                id: 4, name: '张亮麻辣烫', city: '上海', rating: 4.5, sales: 5432, time: '32分钟',
                dist: '1.0km', minOrder: '¥15起送', fee: '配送¥2',
                image: '/images/zhangliang.jpg', badge: '月售5432', catId: 1,
                tags: ['麻辣烫', '麻辣香锅'],
                promos: ['满20减4', '新用户专享'],
                items: [
                    ['麻辣烫（自选）', 20],
                    ['麻辣香锅', 28],
                    ['酸梅汤', 5]
                ]
            },
            {
                id: 5, name: '必胜客（国贸店）', city: '上海', rating: 4.9, sales: 4321, time: '35分钟',
                dist: '2.1km', minOrder: '¥30起送', fee: '配送¥5',
                image: '/images/pizzahut.jpg', badge: '月售4321', catId: 8,
                tags: ['披萨', '意面', '焗饭'],
                promos: ['满59减12', '新用户立减20元'],
                items: [
                    ['超级至尊披萨（9寸）', 69],
                    ['意大利肉酱面', 32],
                    ['芝士焗薯蓉', 18],
                    ['鸡翅（6只）', 28]
                ]
            },
            {
                id: 6, name: '海底捞（外卖专送）', city: '北京', rating: 4.9, sales: 3210, time: '40分钟',
                dist: '2.5km', minOrder: '¥80起送', fee: '免配送费',
                image: '/images/haidilao.jpg', badge: '品牌店', catId: 7,
                tags: ['火锅', '麻辣', '上门'],
                promos: ['满100减20', '赠小料'],
                items: [
                    ['经典麻辣锅底', 68],
                    ['精品肥牛（份）', 48],
                    ['虾滑（份）', 32],
                    ['蔬菜拼盘', 22]
                ]
            },
            {
                id: 7, name: '瑞幸咖啡', city: '上海', rating: 4.6, sales: 8888, time: '18分钟',
                dist: '0.5km', minOrder: '¥12起送', fee: '配送¥3',
                image: '/images/luckin.jpg', badge: '月售8888', catId: 3,
                tags: ['咖啡', '奶茶', '甜品'],
                promos: ['新用户立减10元', '买一送一'],
                items: [
                    ['生椰拿铁', 18],
                    ['厚乳拿铁', 20],
                    ['抹茶瑞纳冰', 22],
                    ['提拉米苏', 16]
                ]
            },
            {
                id: 8, name: '沙县小吃', city: '北京', rating: 4.3, sales: 7654, time: '22分钟',
                dist: '0.6km', minOrder: '¥10起送', fee: '配送¥1',
                image: '/images/shaxian.jpg', badge: '月售7654', catId: 4,
                tags: ['蒸饺', '炖汤', '卤味'],
                promos: ['满15减3', '新用户立减5元'],
                items: [
                    ['蒸饺（笼）', 8],
                    ['扁肉（碗）', 7],
                    ['炖罐（排骨）', 15],
                    ['拌面', 6]
                ]
            },
            {
                id: 9, name: '鲜芋仙', city: '上海', rating: 4.7, sales: 5567, time: '20分钟',
                dist: '0.9km', minOrder: '¥15起送', fee: '配送¥2',
                image: '/images/xianyuxian.jpg', badge: '月售5567', catId: 2,
                tags: ['甜品', '芋圆', '冰品'],
                promos: ['满30减5', '新用户专享'],
                items: [
                    ['招牌芋圆1号', 22],
                    ['仙草冰', 18],
                    ['红豆汤', 14],
                    ['冬瓜茶', 8]
                ]
            },
            {
                id: 10, name: '吉野家', city: '北京', rating: 4.5, sales: 4456, time: '22分钟',
                dist: '1.1km', minOrder: '¥20起送', fee: '配送¥3',
                image: '/images/yoshinoya.jpg', badge: '月售4456', catId: 10,
                tags: ['牛肉饭', '日式', '套餐'],
                promos: ['满35减7', '新用户立减12元'],
                items: [
                    ['招牌牛肉饭（大）', 32],
                    ['照烧鸡腿饭', 28],
                    ['味噌汤', 6],
                    ['泡菜', 4]
                ]
            },
            {
                id: 11, name: '周黑鸭', city: '上海', rating: 4.4, sales: 6678, time: '20分钟',
                dist: '0.7km', minOrder: '¥18起送', fee: '配送¥2',
                image: '/images/zhouheiya.jpg', badge: '月售6678', catId: 1,
                tags: ['卤味', '鸭脖', '零食'],
                promos: ['满40减8', '新用户立减10元'],
                items: [
                    ['鸭脖（盒）', 25],
                    ['鸭翅（盒）', 18],
                    ['藕片', 10],
                    ['豆干', 8]
                ]
            },
            {
                id: 12, name: 'CoCo都可', city: '上海', rating: 4.5, sales: 9123, time: '15分钟',
                dist: '0.4km', minOrder: '¥10起送', fee: '配送¥2',
                image: '/images/coco.jpg', badge: '月售9123', catId: 3,
                tags: ['奶茶', '果茶', '咖啡'],
                promos: ['第二杯半价', '新用户立减5元'],
                items: [
                    ['珍珠奶茶', 12],
                    ['百香双响炮', 15],
                    ['鲜芋青稞牛奶', 16],
                    ['柠檬霸', 13]
                ]
            }
        ];

        const insertMany = db.prepare('INSERT INTO restaurants (id, name, rating, monthly_sales, delivery_time, distance, min_order, delivery_fee, image, badge, city, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

        for (const r of restaurantData) {
            insertMany.run(r.id, r.name, r.rating, r.sales, r.time, r.dist, r.minOrder, r.fee, r.image, r.badge, r.city, r.catId);
            r.tags.forEach(t => insertTag.run(r.id, t));
            r.promos.forEach(p => insertPromo.run(r.id, p));
            r.items.forEach(i => insertItem.run(r.id, i[0], i[1]));
        }
    });

    transaction();
    console.log('✅ Database seeded successfully');

    // Seed merchants (link each restaurant to a merchant)
    const merchantCount = db.prepare('SELECT COUNT(*) as count FROM merchants').get();
    if (merchantCount.count === 0) {
        console.log('🌱 Seeding merchants...');
        const insertMerchant = db.prepare('INSERT INTO merchants (username, password_hash, restaurant_id, phone) VALUES (?, ?, ?, ?)');
        const mh = bcrypt.hashSync('merchant123', 10);
        insertMerchant.run('merchant1', mh, 1, '13800138001');
        insertMerchant.run('merchant2', mh, 5, '13800138002');
        console.log('✅ Merchants seeded');
    }

    // Seed admin
    const adminCount = db.prepare('SELECT COUNT(*) as count FROM admins').get();
    if (adminCount.count === 0) {
        console.log('🌱 Seeding admin...');
        const insertAdmin = db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)');
        const ah = bcrypt.hashSync('admin123', 10);
        insertAdmin.run('admin', ah);
        console.log('✅ Admin seeded');
    }

}

function getDatabase() {
    const db = initDatabase();
    seedDatabase(db);
    return db;
}

module.exports = { getDatabase };
