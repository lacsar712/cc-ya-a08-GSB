# 风机偏航对中台

现场技师登记机组编号与弦线位移（毫米）或直填偏航误差（度）；弦线位移先按顶栏「弦线位移换算偏航角」专页维护的**当量臂长**经反正切换算为偏航角（`atan(位移 ÷ 臂长) × 180 ÷ π`），再由后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。提交时可同时给位移与直填误差两路，两路答案须一致。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交、可维护当量参数 |
| observer | obs123456 | 只读（记录、当量参数、换算流水均可看，不可改参、不可提交） |

## 启动

```bash
cd projects/20-yaw-align-log
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 弦线位移换算专页

顶栏「弦线位移换算偏航角」页签：

- **当量参数**：维护弦线基准臂长 `arm_mm`（种子值 2000 mm，合法范围 1~100000 mm）；仅 technician 可保存，observer 只读。
- **换算试算**：填位移看换算偏航角，或同时直填误差核对两路一致性；试算不入队、不写流水。
- **换算流水**：展示技师提交入队时落库的位移换算（位移、当时臂长、换算偏航角、入队编号），全员只读。

## 接口

| 方法/路径 | 权限 | 说明 |
|---|---|---|
| `GET /api/equiv-param` | 登录 | 查看当前当量臂长 |
| `PUT /api/equiv-param` | technician | 保存当量臂长（非法范围返回 400 话术） |
| `POST /api/convert/preview` | 登录 | 位移/误差试算，不落库 |
| `GET /api/conv-ledger` | 登录 | 换算流水（只读） |
| `POST /api/logs` | technician | 入队；body 可含 `displacement_mm` 和/或 `yaw_err_deg` |

位移合法量程为 ±1000 mm、直填误差合法范围为 ±90°；非数字或越界返回清楚的中文话术且不写队列、不写流水。位移入队时 `yaw_logs` 与 `conv_ledger` 在**同一数据库事务**内落齐。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表与换算流水、当量参数，无提交表单、专页参数不可编辑。
4. technician 以弦线位移提交（如臂长 2000 mm、位移 20 mm → 0.5729°）应判定「合格」，且换算流水多一行；位移 100 mm（→ 2.8624°）应判定「偏航超差」。
5. 同时给位移与直填误差：两路一致才入队；不一致（如位移 52.36 mm 却直填 0.4°）退回并提示换算值与直填值各是多少。
6. 非数字或位移/误差越界提交，返回明确话术且列表、流水均无新增。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn；换算见 `conversion.py`
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
