# cf-rss-aggregator

一个通用的 Cloudflare Workers 项目，用于实时聚合 RSS/Atom 源，并通过 API 暴露：`/api/:group`（例如 `/api/friends`）。支持 KV 缓存、ETag、CORS、限并发抓取、超时、Cron 定时预热、以及简易管理端点。

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 创建 KV 命名空间（首次）并写入 `wrangler.toml`

```bash
npx wrangler kv namespace create FEEDS_KV
# 将返回的 id/preview_id 写入 wrangler.toml 的 [[kv_namespaces]]
```

3. 本地开发

```bash
npm run dev
```

4. 部署

```bash
npm run deploy
```

## 配置方式（至少任选其一）

- 环境变量：在 `wrangler.toml` 的 `[vars]` 中配置 `GROUPS_JSON`（字符串化 JSON）。
- 远程配置：设置 `CONFIG_URL`，从远程拉取 JSON 配置并写入 KV。
- 管理端：`PUT /admin/config?token=...` 直接提交 JSON 写入 KV。

配置 JSON 结构示例：

```json
{
  "friends": [
    "https://example.com/feed.xml",
    "https://example.org/rss"
  ],
  "tech": [
    "https://example.net/atom.xml"
  ]
}
```

## API 说明

- GET `/api/:group?limit=50&format=json&fresh=0`
  - `group`: 组名，如 `friends`
  - `limit`: 返回的聚合条目数量，默认 50
  - `format`: 目前支持 `json`
  - `fresh`: `1` 表示绕过缓存强制刷新
  - 响应头包含 `ETag` 与 `Cache-Control`，支持条件请求返回 `304 Not Modified`

- GET `/api/_groups`：返回可用组名列表
- GET `/health`：健康检查

### 管理端点

- PUT `/admin/config?token=YOUR_ADMIN_TOKEN`
  - Body: JSON（同上配置结构），写入 KV
- POST `/admin/reload-config?token=YOUR_ADMIN_TOKEN`
  - 如果配置了 `CONFIG_URL`，则从远程拉取并写入 KV

> 管理端需要在 `wrangler.toml` 设置 `ADMIN_TOKEN`。

## 环境变量

- `FEEDS_KV`: KV 命名空间
- `ADMIN_TOKEN`: 管理端口令
- `CORS_ALLOW_ORIGIN`: 允许跨域来源，默认 `*`
- `CACHE_TTL_SECONDS`: 缓存过期时间（秒），默认 `900`
- `FETCH_TIMEOUT_MS`: 抓取超时（毫秒），默认 `8000`
- `CONCURRENCY`: 并发抓取数，默认 `6`
- `USER_AGENT`: 抓取 User-Agent
- `GROUPS_JSON`: 组配置 JSON 字符串
- `CONFIG_URL`: 远程配置地址（可选）

## 版权与许可

MIT
