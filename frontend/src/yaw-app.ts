import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

type LogRow = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  status: string;
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  processed_at: string | null;
  mode: string | null;
  displacement_mm: number | null;
  base_distance_mm: number | null;
  direct_yaw_err_deg: number | null;
};

type ConversionEntry = {
  id: number;
  log_id: number | null;
  turbine_code: string | null;
  mode: string;
  input_kind: string;
  displacement_mm: number | null;
  base_distance_mm: number | null;
  direct_yaw_err_deg: number | null;
  yaw_err_deg: number;
  verdict: string | null;
  reason: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
};

type Params = {
  base_distance_mm: number;
  updated_by?: string;
  updated_at?: string | null;
  configured: boolean;
};

type PreviewResult = {
  mode: string;
  input_kind: string;
  displacement_mm: number | null;
  base_distance_mm: number | null;
  direct_yaw_err_deg: number | null;
  yaw_err_deg: number;
  verdict: string;
  reason: string;
  note: string;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type Page = "logs" | "conversion";

const KIND_LABEL: Record<string, string> = {
  displacement: "位移换算",
  direct: "直填误差",
  both: "双路核对",
};

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
      max-width: 1080px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
      color: #38bdf8;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1rem;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 0.6rem 1rem;
      margin-bottom: 1rem;
    }
    .topbar .brand {
      font-weight: 700;
      color: #e2e8f0;
    }
    .topbar .spacer {
      flex: 1;
    }
    nav {
      display: flex;
      gap: 0.4rem;
    }
    nav button {
      background: transparent;
      border: 1px solid #475569;
      color: #cbd5e1;
    }
    nav button.active {
      background: #0284c7;
      border-color: #0284c7;
      color: #fff;
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
      font-size: 1.05rem;
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
    .grid2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }
    @media (max-width: 640px) {
      .grid2 {
        grid-template-columns: 1fr;
      }
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
      font-size: 0.85rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.45rem 0.4rem;
      border-bottom: 1px solid #334155;
      vertical-align: top;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
      white-space: nowrap;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
      white-space: nowrap;
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
    .kind {
      background: #1e3a5f;
      color: #93c5fd;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.8rem;
      margin: 0 0 0.75rem;
    }
    .result {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 0.75rem 1rem;
      margin-top: 0.5rem;
    }
    .result .line {
      margin: 0.2rem 0;
    }
    .readonly-box {
      background: #0f172a;
      border: 1px dashed #475569;
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
      color: #cbd5e1;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .muted {
      color: #94a3b8;
      font-size: 0.8rem;
    }
  `;

  @state() private session: Session | null = null;
  @state() private page: Page = "logs";
  @state() private logs: LogRow[] = [];
  @state() private entries: ConversionEntry[] = [];
  @state() private params: Params | null = null;
  @state() private preview: PreviewResult | null = null;
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private dispInput = "";
  @state() private yawInput = "";
  @state() private baseInput = "";
  @state() private previewDisp = "";
  @state() private previewYaw = "";
  @state() private error = "";
  @state() private formMsg = "";
  @state() private loading = false;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.loadPageData();
        this._pollTimer = window.setInterval(() => void this.pollTick(), 2000);
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
    }
  }

  private _pollTimer?: number;

  private authHeaders(json = false): HeadersInit {
    return {
      ...(this.session ? { Authorization: `Bearer ${this.session.token}` } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async apiGet(path: string) {
    const res = await fetch(path, { headers: this.authHeaders() });
    if (res.status === 401) {
      this.logout();
      return null;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `请求失败（${res.status}）`);
    }
    return res.json();
  }

  private async pollTick() {
    try {
      this.logs = (await this.apiGet("/api/logs")) ?? this.logs;
      this.entries = (await this.apiGet("/api/conversions")) ?? this.entries;
    } catch {
      /* ignore transient polling errors */
    }
  }

  private async loadPageData() {
    try {
      const [logs, entries, params] = await Promise.all([
        this.apiGet("/api/logs"),
        this.apiGet("/api/conversions"),
        this.apiGet("/api/params"),
      ]);
      if (!this.session) return;
      this.logs = logs ?? [];
      this.entries = entries ?? [];
      this.params = params ?? null;
      if (params && this.baseInput === "") {
        this.baseInput = String(params.base_distance_mm);
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : "加载失败";
    }
  }

  private switchPage(page: Page) {
    this.page = page;
    this.error = "";
    this.formMsg = "";
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
      await this.loadPageData();
      this._pollTimer = window.setInterval(() => void this.pollTick(), 2000);
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.session = null;
    this.logs = [];
    this.entries = [];
    this.params = null;
    localStorage.removeItem("yaw_session");
  }

  private async submitLog() {
    this.error = "";
    this.formMsg = "";
    if (!this.dispInput.trim() && !this.yawInput.trim()) {
      this.error = "弦线位移和偏航误差至少填写一项";
      return;
    }
    const payload: Record<string, unknown> = { turbine_code: this.turbineCode };
    if (this.dispInput.trim()) payload.displacement_mm = Number(this.dispInput);
    if (this.yawInput.trim()) payload.yaw_err_deg = Number(this.yawInput);
    this.loading = true;
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: this.authHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "提交失败";
        return;
      }
      this.formMsg = `已入队（记录 #${data.log.id}，流水 #${data.entry.id}）：${data.entry.note}`;
      this.turbineCode = "";
      this.dispInput = "";
      this.yawInput = "";
      await this.pollTick();
    } catch {
      this.error = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private async saveParams() {
    this.error = "";
    this.formMsg = "";
    this.loading = true;
    try {
      const res = await fetch("/api/params", {
        method: "PUT",
        headers: this.authHeaders(true),
        body: JSON.stringify({ base_distance_mm: Number(this.baseInput) }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "保存失败";
        return;
      }
      this.params = data;
      this.baseInput = String(data.base_distance_mm);
      this.formMsg = `基距当量已更新为 ${data.base_distance_mm} mm（维护人：${data.updated_by}）`;
    } catch {
      this.error = "保存时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private async runPreview() {
    this.error = "";
    this.preview = null;
    if (!this.previewDisp.trim() && !this.previewYaw.trim()) {
      this.error = "弦线位移和偏航误差至少填写一项";
      return;
    }
    const payload: Record<string, unknown> = {};
    if (this.previewDisp.trim()) payload.displacement_mm = Number(this.previewDisp);
    if (this.previewYaw.trim()) payload.yaw_err_deg = Number(this.previewYaw);
    this.loading = true;
    try {
      const res = await fetch("/api/conversions/preview", {
        method: "POST",
        headers: this.authHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "试算失败";
        return;
      }
      this.preview = data as PreviewResult;
    } catch {
      this.error = "试算时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private verdictClass(verdict: string | null, status?: string) {
    if (status === "pending") return "pending";
    if (verdict === "合格") return "ok";
    if (verdict === "偏航超差") return "bad";
    return "";
  }

  private fmtTime(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", { hour12: false });
  }

  private num(v: number | null, digits = 4) {
    return v === null || v === undefined ? "—" : Number(v).toFixed(digits);
  }

  render() {
    if (!this.session) {
      return html`
        <h1>风机偏航对中台</h1>
        <p class="sub">弦线位移先按基距当量换算偏航角，再判定合格或偏航超差。</p>
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
        <span class="brand">风机偏航对中台</span>
        <nav>
          <button
            class=${this.page === "logs" ? "active" : ""}
            @click=${() => this.switchPage("logs")}
          >
            对中记录
          </button>
          <button
            class=${this.page === "conversion" ? "active" : ""}
            @click=${() => this.switchPage("conversion")}
          >
            弦线位移换算
          </button>
        </nav>
        <span class="spacer"></span>
        <span class="muted">${this.session.username}（${this.isWriter ? "可提交" : "只读观察"}）</span>
        <button class="secondary" @click=${this.logout}>退出</button>
      </div>

      ${this.error ? html`<p class="err">${this.error}</p>` : null}
      ${this.formMsg ? html`<p class="hint" style="color:#86efac">${this.formMsg}</p>` : null}

      ${this.page === "logs" ? this.renderLogsPage() : this.renderConversionPage()}
    `;
  }

  private renderLogsPage() {
    return html`
      ${this.isWriter
        ? html`
            <section>
              <h2>提交偏航记录</h2>
              <p class="hint">
                可只送弦线位移（按当前基距当量后台换算），也可只直填偏航误差；
                两路同送时后台会核对，答案不一致将退回。
              </p>
              <div class="grid2">
                <div>
                  <label>机组编号</label>
                  <input
                    placeholder="例如 W12"
                    .value=${this.turbineCode}
                    @input=${(e: Event) =>
                      (this.turbineCode = (e.target as HTMLInputElement).value)}
                  />
                </div>
                <div>
                  <label>弦线位移（mm，可正可负）</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="例如 17.5"
                    .value=${this.dispInput}
                    @input=${(e: Event) =>
                      (this.dispInput = (e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
              <label>或直接填写偏航误差（度，可正可负）</label>
              <input
                type="number"
                step="0.01"
                placeholder="例如 0.8"
                .value=${this.yawInput}
                @input=${(e: Event) =>
                  (this.yawInput = (e.target as HTMLInputElement).value)}
              />
              <button ?disabled=${this.loading} @click=${this.submitLog}>
                提交（进入待认领队列）
              </button>
            </section>
          `
        : null}

      <section>
        <h2>对中记录</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>机组</th>
              <th>录入</th>
              <th>位移 mm</th>
              <th>基距 mm</th>
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
                  <td>
                    <span class="tag kind">
                      ${KIND_LABEL[row.mode ?? "direct"] ?? row.mode ?? "直填"}
                    </span>
                  </td>
                  <td>${this.num(row.displacement_mm, 2)}</td>
                  <td>${this.num(row.base_distance_mm, 0)}</td>
                  <td>${this.num(row.yaw_err_deg)}</td>
                  <td>
                    <span class="tag ${row.status === "pending" ? "pending" : "ok"}">
                      ${row.status === "pending" ? "待处理" : "已完成"}
                    </span>
                  </td>
                  <td>
                    ${row.verdict
                      ? html`<span class="tag ${this.verdictClass(row.verdict, row.status)}"
                          >${row.verdict}</span
                        >`
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

  private renderConversionPage() {
    return html`
      <section>
        <h2>弦线位移基距当量</h2>
        ${this.isWriter
          ? html`
              <p class="hint">
                基距为弦线测点到偏航回转中心的距离（mm，必须为正）。换算公式：
                偏航角 = atan2(弦线位移, 基距)。
              </p>
              <div class="grid2">
                <div>
                  <label>基距当量（mm）</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    .value=${this.baseInput}
                    @input=${(e: Event) =>
                      (this.baseInput = (e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
              <button ?disabled=${this.loading} @click=${this.saveParams}>保存当量参数</button>
            `
          : html`
              <div class="readonly-box">
                当前基距当量：<strong>${this.num(this.params?.base_distance_mm ?? null, 0)} mm</strong>
                ${this.params?.updated_by
                  ? html`（维护人：${this.params.updated_by}，
                      ${this.fmtTime(this.params.updated_at ?? null)}）`
                  : null}
                <div class="muted" style="margin-top:0.35rem">
                  观察账号仅可查看当量与换算流水，不可修改参数。
                </div>
              </div>
            `}
      </section>

      <section>
        <h2>换算试算（不进单、不入流水）</h2>
        <p class="hint">
          填位移即按当前基距换算偏航角；直填误差则原样给出判定；
          两路同填时核对一致性。
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
            <label>偏航误差（度）</label>
            <input
              type="number"
              step="0.01"
              .value=${this.previewYaw}
              @input=${(e: Event) =>
                (this.previewYaw = (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <button ?disabled=${this.loading} @click=${this.runPreview}>换算试算</button>
        ${this.preview
          ? html`
              <div class="result">
                <p class="line">
                  <span class="tag kind">${KIND_LABEL[this.preview.input_kind]}</span>
                </p>
                <p class="line">${this.preview.note}</p>
                <p class="line">
                  参与判定偏航角：<strong>${this.num(this.preview.yaw_err_deg)}°</strong>
                  →
                  <span class="tag ${this.verdictClass(this.preview.verdict)}"
                    >${this.preview.verdict}</span
                  >
                </p>
                <p class="line muted">${this.preview.reason}</p>
              </div>
            `
          : null}
      </section>

      <section>
        <h2>换算流水</h2>
        <table>
          <thead>
            <tr>
              <th>流水#</th>
              <th>记录#</th>
              <th>机组</th>
              <th>方式</th>
              <th>位移 mm</th>
              <th>基距 mm</th>
              <th>直填°</th>
              <th>换算°</th>
              <th>结论</th>
              <th>演算说明</th>
              <th>操作人</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            ${this.entries.map(
              (e) => html`
                <tr>
                  <td>${e.id}</td>
                  <td>${e.log_id ?? "—"}</td>
                  <td>${e.turbine_code ?? "—"}</td>
                  <td><span class="tag kind">${KIND_LABEL[e.input_kind] ?? e.input_kind}</span></td>
                  <td>${this.num(e.displacement_mm, 2)}</td>
                  <td>${this.num(e.base_distance_mm, 0)}</td>
                  <td>${this.num(e.direct_yaw_err_deg)}</td>
                  <td>${this.num(e.yaw_err_deg)}</td>
                  <td>
                    ${e.verdict
                      ? html`<span class="tag ${this.verdictClass(e.verdict)}">${e.verdict}</span>`
                      : html`<span class="tag pending">待判定</span>`}
                  </td>
                  <td>${e.note ?? "—"}</td>
                  <td>${e.created_by}</td>
                  <td>${this.fmtTime(e.created_at)}</td>
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
