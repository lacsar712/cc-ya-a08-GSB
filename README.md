# 风机偏航对中台

现场技师登记机组编号与**弦线位移（mm）或偏航误差（度）**：弦线位移读数先按顶栏「弦线位移换算」专页维护的基距当量换算为偏航角（`atan2(位移, 基距)`），再由后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

## 换算与录入规则

- 顶栏「弦线位移换算」专页：
  - 维护弦线基距当量（mm，必须为正，默认 1000 mm）；仅 technician 可改，observer 只读。
  - 换算试算：填位移即换算、可直填误差、两路同填核对一致性；试算不进单、不入流水。
  - 展示换算流水（位移、基距、换算角、判定、演算说明、操作人、时间），observer 可看不可改。
- 提交记录两路任选其一，也可同送：
  - 只送位移：后台按当前基距换算后入队；
  - 只直填误差：直接入队；
  - 两路同送：换算角与直填误差相差超过 ±0.01° 即以「两路答案不一致」退回。
- 非法（非数字、未填）或越界（基距 ≤ 0、位移/角度超范围）返回清楚话术，整体回滚，不进单、不留流水。
- 入队（`yaw_logs`）与换算流水（`conversion_entries`）在**同一数据库事务**落齐，流水以 `log_id` 外键关联记录。

## 接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/params` | 登录 | 查看基距当量 |
| PUT | `/api/params` | technician | 维护基距当量 |
| POST | `/api/conversions/preview` | 登录 | 换算试算（不落库） |
| GET | `/api/conversions` | 登录 | 换算流水（observer 只读） |
| POST | `/api/logs` | technician | 位移/误差双路提交，同事务写入记录与流水 |

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交 |
| observer | obs123456 | 只读 |

## 启动

```bash
cd projects/20-yaw-align-log
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表与换算流水，无提交表单、无参数维护入口（接口层 PUT/POST 返回 403）。
4. 基距 2000 mm 时，送位移 17.5 mm（换算 0.5013°）应判定「合格」；故意送位移 60 mm（换算 1.7184°）应「偏航超差」。
5. 同一读数位移路与直填误差路答案一致才入单，不一致以清楚话术退回；非数字、越界同样退回且不留流水。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
