import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

type LogRow = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  displacement_mm: number | null;
  arm_mm: number | null;
  input_source: string;
  status: string;
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  processed_at: string | null;
};

type LedgerRow = {
  id: number;
  displacement_mm: number;
  arm_mm: number;
  yaw_err_deg: number;
  source: string;
  log_id: number | null;
  turbine_code: string | null;
  created_by: string;
  created_at: string;
};

type EquivParam = {
  arm_mm: number;
  updated_by: string;
  updated_at: string;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type Tab = "logs" | "convert";

function fmt(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return String(Number(value.toFixed(digits)));
}

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
      max-width: 1040px;
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }
    h1 {
      margin: 0;
      font-size: 1.6rem;
      color: #38bdf8;
    }
    nav {
      display: flex;
      gap: 0.5rem;
    }
    nav button.tab {
      background: #334155;
    }
    nav button.tab.active {
      background: #0284c7;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1.25rem;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    h2 {
      margin-top: 0;
      font-size: 1.1rem;
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-bottom: 0.25rem;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
    }
    input[disabled] {
      opacity: 0.55;
    }
    button {
      cursor: pointer;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
    }
    button.secondary {
      background: #475569;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid #334155;
      white-space: nowrap;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .ok {
      background: #14532d;
      color: #86efac;
    }
    .bad {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .pending {
      background: #713f12;
      color: #fde68a;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .ok-text {
      color: #86efac;
      margin-top: 0.5rem;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .meta {
      color: #94a3b8;
      font-size: 0.82rem;
    }
    .grid2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 1rem;
    }
    @media (max-width: 640px) {
      .grid2 {
        grid-template-columns: 1fr;
      }
    }
  `;

  @state() private session: Session | null = null;
  @state() private tab: Tab = "logs";
  @state() private logs: LogRow[] = [];
  @state() private ledger: LedgerRow[] = [];
  @state() private equiv: EquivParam | null = null;

  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";

  // 提交表单
  @state() private turbineCode = "";
  @state() private displacement = "";
  @state() private directErr = "";
  @state() private submitError = "";
  @state() private submitOk = "";

  // 当量参数
  @state() private armDraft = "";
  @state() private paramError = "";
  @state() private paramOk = "";

  // 试算器
  @state() private previewDisp = "";
  @state() private previewErr = "";
  @state() private previewResult: {
    yaw?: number;
    direct?: number;
    consistent?: boolean;
  } | null = null;
  @state() private previewError = "";

  @state() private error = "";
  @state() private loading = false;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.refreshAll();
        this.startPolling();
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopPolling();
  }

  private _pollTimer?: number;

  private startPolling() {
    this.stopPolling();
    this._pollTimer = window.setInterval(() => void this.refreshAll(true), 2000);
  }

  private stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = undefined;
    }
  }

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private async apiGet(path: string) {
    const res = await fetch(path, { headers: this.authHeaders() });
    if (res.status === 401) {
      this.logout();
      throw new Error("未登录");
    }
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  }

  private async refreshAll(silent = false) {
    if (!this.session) return;
    try {
      const [logs, ledger, equiv] = await Promise.all([
        this.apiGet("/api/logs"),
        this.apiGet("/api/conv-ledger"),
        this.apiGet("/api/equiv-param"),
      ]);
      this.logs = logs as LogRow[];
      this.ledger = ledger as LedgerRow[];
      this.equiv = equiv as EquivParam;
      if (!this.armDraft) this.armDraft = String(this.equiv.arm_mm);
      this.error = "";
    } catch {
      if (!silent) this.error = "加载数据失败";
    }
  }

  private async login() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.loginUser,
          password: this.loginPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "登录失败";
        return;
      }
      this.session = {
        token: data.access_token,
        username: data.username,
        role: data.role,
      };
      localStorage.setItem("yaw_session", JSON.stringify(this.session));
      await this.refreshAll();
      this.startPolling();
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    this.stopPolling();
    this.session = null;
    this.logs = [];
    this.ledger = [];
    this.equiv = null;
    localStorage.removeItem("yaw_session");
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private switchTab(tab: Tab) {
    this.tab = tab;
    this.submitError = "";
    this.submitOk = "";
    this.previewError = "";
  }

  // ---------- 提交：位移 / 直填误差两路 ----------

  private async submitLog() {
    this.submitError = "";
    this.submitOk = "";
    this.loading = true;
    const payload: Record<string, unknown> = {
      turbine_code: this.turbineCode,
    };
    if (this.displacement.trim() !== "") {
      payload.displacement_mm = Number(this.displacement);
    }
    if (this.directErr.trim() !== "") {
      payload.yaw_err_deg = Number(this.directErr);
    }
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        this.submitError = data.detail || "提交失败";
        return;
      }
      const row = data as LogRow;
      this.submitOk =
        row.displacement_mm !== null && row.displacement_mm !== undefined
          ? `已入队：位移 ${fmt(row.displacement_mm)} mm 换算偏航角 ${fmt(
              row.yaw_err_deg
            )}°，等待 worker 判定`
          : `已入队：偏航误差 ${fmt(row.yaw_err_deg)}°，等待 worker 判定`;
      this.turbineCode = "";
      this.displacement = "";
      this.directErr = "";
      await this.refreshAll();
    } catch {
      this.submitError = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  // ---------- 当量参数维护 ----------

  private async saveArm() {
    this.paramError = "";
    this.paramOk = "";
    try {
      const res = await fetch("/api/equiv-param", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ arm_mm: Number(this.armDraft) }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.paramError = data.detail || "保存失败";
        return;
      }
      this.equiv = data as EquivParam;
      this.armDraft = String(this.equiv.arm_mm);
      this.paramOk = "当量臂长已更新";
    } catch {
      this.paramError = "保存时网络异常";
    }
  }

  // ---------- 专页试算 ----------

  private async previewConvert() {
    this.previewError = "";
    this.previewResult = null;
    const payload: Record<string, unknown> = {};
    if (this.previewDisp.trim() !== "") {
      payload.displacement_mm = Number(this.previewDisp);
    }
    if (this.previewErr.trim() !== "") {
      payload.yaw_err_deg = Number(this.previewErr);
    }
    try {
      const res = await fetch("/api/convert/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        this.previewError = data.detail || "试算失败";
        return;
      }
      this.previewResult = {
        yaw:
          data.yaw_err_deg === undefined ? undefined : Number(data.yaw_err_deg),
        direct:
          data.direct_err_deg === undefined
            ? undefined
            : Number(data.direct_err_deg),
        consistent: data.consistent as boolean | undefined,
      };
    } catch {
      this.previewError = "试算时网络异常";
    }
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending") return "pending";
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  private sourceLabel(row: LogRow) {
    if (row.input_source === "displacement") return "弦线位移";
    if (row.input_source === "both") return "位移+直填";
    return "直填误差";
  }

  // ---------- 渲染 ----------

  render() {
    if (!this.session) {
      return html`
        <h1>风机偏航对中台</h1>
        <p class="sub">现场技师提交弦线位移或偏航误差，后台换算并给出合格或偏航超差结论。</p>
        <section>
          <label>用户名</label>
          <input
            .value=${this.loginUser}
            @input=${(e: Event) =>
              (this.loginUser = (e.target as HTMLInputElement).value)}
          />
          <label>密码</label>
          <input
            type="password"
            .value=${this.loginPass}
            @input=${(e: Event) =>
              (this.loginPass = (e.target as HTMLInputElement).value)}
          />
          <button ?disabled=${this.loading} @click=${this.login}>登录</button>
          ${this.error ? html`<p class="err">${this.error}</p>` : null}
        </section>
      `;
    }

    return html`
      <div class="topbar">
        <h1>风机偏航对中台</h1>
        <nav>
          <button
            class="tab ${this.tab === "logs" ? "active" : ""}"
            @click=${() => this.switchTab("logs")}
          >
            偏航记录
          </button>
          <button
            class="tab ${this.tab === "convert" ? "active" : ""}"
            @click=${() => this.switchTab("convert")}
          >
            弦线位移换算偏航角
          </button>
        </nav>
      </div>
      <p class="sub">
        已登录：${this.session.username}（${this.isWriter ? "可提交" : "只读"}）
        <button class="secondary" style="margin-left:0.75rem;padding:0.2rem 0.6rem;" @click=${this.logout}>
          退出
        </button>
      </p>
      ${this.error ? html`<p class="err">${this.error}</p>` : null}
      ${this.tab === "logs" ? this.renderLogs() : this.renderConvert()}
    `;
  }

  private renderLogs() {
    return html`
      ${this.isWriter
        ? html`
            <section>
              <h2>提交偏航记录</h2>
              <p class="meta" style="margin-top:0;">
                弦线位移先按当前当量臂长（${this.equiv
                  ? fmt(this.equiv.arm_mm, 2)
                  : "…"} mm）换算为偏航角再判定；
                可同时直填误差核对，两路答案须一致。
              </p>
              <label>机组编号</label>
              <input
                placeholder="例如 W12"
                .value=${this.turbineCode}
                @input=${(e: Event) =>
                  (this.turbineCode = (e.target as HTMLInputElement).value)}
              />
              <div class="grid2">
                <div>
                  <label>弦线位移（mm，可正可负）</label>
                  <input
                    type="number"
                    step="0.1"
                    .value=${this.displacement}
                    @input=${(e: Event) =>
                      (this.displacement = (e.target as HTMLInputElement).value)}
                  />
                </div>
                <div>
                  <label>直填偏航误差（度，可选，用于核对）</label>
                  <input
                    type="number"
                    step="0.01"
                    .value=${this.directErr}
                    @input=${(e: Event) =>
                      (this.directErr = (e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
              <button ?disabled=${this.loading} @click=${this.submitLog}>
                提交（进入待认领队列）
              </button>
              ${this.submitError
                ? html`<p class="err">${this.submitError}</p>`
                : null}
              ${this.submitOk
                ? html`<p class="ok-text">${this.submitOk}</p>`
                : null}
            </section>
          `
        : null}

      <section>
        <div class="row-actions" style="justify-content:space-between;">
          <h2 style="margin:0;">对中记录</h2>
          <button class="secondary" ?disabled=${this.loading} @click=${() => this.refreshAll()}>
            刷新列表
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>机组</th>
              <th>来源</th>
              <th>位移 mm</th>
              <th>偏航角°</th>
              <th>状态</th>
              <th>结论</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            ${this.logs.map(
              (row) => html`
                <tr>
                  <td>${row.id}</td>
                  <td>${row.turbine_code}</td>
                  <td>${this.sourceLabel(row)}</td>
                  <td>${fmt(row.displacement_mm, 3)}</td>
                  <td>${fmt(row.yaw_err_deg)}</td>
                  <td>
                    <span class="tag ${row.status === "pending" ? "pending" : "ok"}">
                      ${row.status === "pending" ? "待处理" : "已完成"}
                    </span>
                  </td>
                  <td>
                    ${row.verdict
                      ? html`<span class="tag ${this.verdictClass(row)}">${row.verdict}</span>`
                      : "—"}
                  </td>
                  <td>${row.reason ?? "—"}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </section>
    `;
  }

  private renderConvert() {
    return html`
      <section>
        <h2>当量参数（弦线基准臂长）</h2>
        <p class="meta" style="margin-top:0;">
          换算公式：偏航角 = atan(位移 ÷ 臂长) × 180 ÷ π
          ${this.equiv
            ? html`；当前臂长 ${fmt(this.equiv.arm_mm, 2)} mm，由 ${this.equiv
                .updated_by} 维护`
            : ""}
        </p>
        ${this.isWriter
          ? html`
              <label>当量臂长（mm）</label>
              <input
                type="number"
                step="1"
                style="max-width:260px;"
                .value=${this.armDraft}
                @input=${(e: Event) =>
                  (this.armDraft = (e.target as HTMLInputElement).value)}
              />
              <button @click=${this.saveArm}>保存当量参数</button>
              ${this.paramError
                ? html`<p class="err">${this.paramError}</p>`
                : null}
              ${this.paramOk
                ? html`<p class="ok-text">${this.paramOk}</p>`
                : null}
            `
          : html`
              <p class="meta">
                当前当量臂长：<strong style="color:#e2e8f0;">${this.equiv
                  ? fmt(this.equiv.arm_mm, 2)
                  : "…"} mm</strong>
                （观察账号只能查看参数与流水，不可修改）
              </p>
            `}
      </section>

      <section>
        <h2>换算试算</h2>
        <p class="meta" style="margin-top:0;">
          可只填位移看换算偏航角，也可同时直填误差核对两路是否一致；试算不入队、不写流水。
        </p>
        <div class="grid2">
          <div>
            <label>弦线位移（mm）</label>
            <input
              type="number"
              step="0.1"
              .value=${this.previewDisp}
              @input=${(e: Event) =>
                (this.previewDisp = (e.target as HTMLInputElement).value)}
            />
          </div>
          <div>
            <label>直填偏航误差（度，可选）</label>
            <input
              type="number"
              step="0.01"
              .value=${this.previewErr}
              @input=${(e: Event) =>
                (this.previewErr = (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <button @click=${this.previewConvert}>换算</button>
        ${this.previewError
          ? html`<p class="err">${this.previewError}</p>`
          : null}
        ${this.previewResult
          ? html`
              <p class="ok-text">
                ${this.previewResult.yaw !== undefined
                  ? `位移换算偏航角：${fmt(this.previewResult.yaw)}°`
                  : ""}
                ${this.previewResult.direct !== undefined
                  ? `　直填偏航误差：${fmt(this.previewResult.direct)}°`
                  : ""}
                ${this.previewResult.consistent === true
                  ? "　✔ 两路答案一致"
                  : ""}
                ${this.previewResult.consistent === false
                  ? html`<span class="err">　✘ 两路答案不一致</span>`
                  : ""}
              </p>
            `
          : null}
      </section>

      <section>
        <h2>换算流水</h2>
        <p class="meta" style="margin-top:0;">
          仅展示技师提交入队时落库的位移换算记录，只读。
        </p>
        <table>
          <thead>
            <tr>
              <th>流水号</th>
              <th>入队编号</th>
              <th>机组</th>
              <th>位移 mm</th>
              <th>当量臂长 mm</th>
              <th>换算偏航角°</th>
              <th>提交人</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            ${this.ledger.length === 0
              ? html`<tr><td colspan="8" class="meta">暂无换算流水</td></tr>`
              : this.ledger.map(
                  (row) => html`
                    <tr>
                      <td>${row.id}</td>
                      <td>${row.log_id ?? "—"}</td>
                      <td>${row.turbine_code ?? "—"}</td>
                      <td>${fmt(row.displacement_mm, 3)}</td>
                      <td>${fmt(row.arm_mm, 2)}</td>
                      <td>${fmt(row.yaw_err_deg)}</td>
                      <td>${row.created_by}</td>
                      <td>${new Date(row.created_at).toLocaleString("zh-CN")}</td>
                    </tr>
                  `
                )}
          </tbody>
        </table>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
