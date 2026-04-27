# 陈鸿外卖 (ChenHong Delivery)

一个功能完整的外卖平台应用，包含用户端、商家端和管理后台三大模块。

## 项目简介

陈鸿外卖是一个基于 Node.js + Express + SQLite 的全栈外卖平台，提供用户点餐、商家管理和平台管理功能。支持多城市、多分类、收藏、订单管理等完整的外卖业务流程。

## 功能特性

### 用户端
- 多页面路由：外卖、美食、超市、跑腿、团购、预订
- 商家浏览与搜索：支持按分类、城市、评分、销量等筛选
- 商家详情：查看菜单、标签、优惠信息
- 用户注册/登录：基于 JWT Token 的认证系统
- 收藏功能：收藏喜欢的商家
- 订单管理：查看订单历史
- 城市切换：支持北京、上海、广州、深圳、杭州、成都

### 商家端
- 商家登录认证
- 数据概览：今日订单、今日收入、总订单、总收入
- 订单管理：查看订单、更新订单状态
- 菜品管理：添加、编辑、删除菜品
- 店铺设置：修改店铺信息、配送时间、起送价等

### 管理后台
- 管理员登录认证
- 平台概览：商家数、用户数、订单数、总营收
- 商家管理：添加、编辑、删除商家
- 用户管理：查看所有注册用户
- 订单管理：查看平台所有订单
- 分类管理：管理商家分类

## 技术栈

- **后端**: Node.js + Express.js
- **数据库**: SQLite (better-sqlite3)
- **认证**: bcryptjs 密码加密 + Token 认证
- **前端**: 原生 HTML + CSS + JavaScript
- **跨域**: CORS

## 项目结构

```
delivery-app/
├── server.js          # Express 服务器和 API 路由
├── database.js        # 数据库初始化和种子数据
├── index.html         # 用户端首页
├── merchant.html      # 商家端页面
├── admin.html         # 管理后台页面
├── style.css          # 用户端样式
├── script.js          # 用户端 JavaScript
├── package.json       # 项目依赖
└── delivery.db        # SQLite 数据库文件（运行后生成）
```

## 快速开始

### 环境要求

- Node.js >= 14.0.0
- npm >= 6.0.0

### 安装步骤

1. 克隆项目
```bash
git clone <repository-url>
cd delivery-app
```

2. 安装依赖
```bash
npm install
```

3. 启动服务器
```bash
npm start
```

4. 访问应用
- 用户端: http://localhost:3000/delivery
- 商家端: http://localhost:3000/merchant
- 管理后台: http://localhost:3000/admin

## 默认账号

### 商家账号
- 用户名: `merchant1`
- 密码: `merchant123`

### 管理员账号
- 用户名: `admin`
- 密码: `admin123`

## API 接口

### 公开接口
- `GET /api/categories` - 获取所有分类
- `GET /api/restaurants` - 获取商家列表（支持筛选）
- `GET /api/restaurants/:id` - 获取商家详情和菜单

### 用户认证
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户信息
- `POST /api/auth/logout` - 退出登录
- `PUT /api/auth/profile` - 更新用户资料

### 收藏
- `GET /api/favorites` - 获取收藏列表
- `GET /api/favorites/details` - 获取收藏商家详情
- `POST /api/favorites` - 添加收藏
- `DELETE /api/favorites/:restaurantId` - 取消收藏

### 商家接口
- `POST /api/merchant/auth/login` - 商家登录
- `GET /api/merchant/restaurant` - 获取我的店铺
- `PUT /api/merchant/restaurant` - 更新店铺信息
- `POST /api/merchant/menu-items` - 添加菜品
- `PUT /api/merchant/menu-items/:id` - 更新菜品
- `DELETE /api/merchant/menu-items/:id` - 删除菜品
- `GET /api/merchant/orders` - 获取订单列表
- `PATCH /api/merchant/orders/:id/status` - 更新订单状态
- `GET /api/merchant/stats` - 获取统计数据

### 管理员接口
- `POST /api/admin/auth/login` - 管理员登录
- `GET /api/admin/stats` - 获取平台统计
- `GET /api/admin/restaurants` - 获取所有商家
- `POST /api/admin/restaurants` - 添加商家
- `PUT /api/admin/restaurants/:id` - 更新商家
- `DELETE /api/admin/restaurants/:id` - 删除商家
- `GET /api/admin/users` - 获取所有用户
- `GET /api/admin/orders` - 获取所有订单
- `GET /api/admin/categories` - 获取所有分类
- `POST /api/admin/categories` - 添加分类
- `PUT /api/admin/categories/:id` - 更新分类
- `DELETE /api/admin/categories/:id` - 删除分类

## 数据库设计

主要数据表：
- `categories` - 商家分类
- `restaurants` - 商家信息
- `restaurant_tags` - 商家标签
- `promos` - 优惠信息
- `menu_items` - 菜品
- `users` - 用户
- `merchants` - 商家账号
- `admins` - 管理员账号
- `orders` - 订单
- `order_items` - 订单详情
- `favorites` - 收藏
- `sessions` - 会话/认证

## 开发说明

### 数据库自动初始化

首次运行时，系统会自动创建数据库表并填充种子数据，包括：
- 10 个商家分类
- 12 个示例商家（覆盖北京、上海）
- 每个商家的菜单、标签、优惠信息
- 默认商家和管理员账号

### 端口配置

默认端口为 3000，可通过环境变量修改：
```bash
PORT=8080 npm start
```

## 许可证

ISC
