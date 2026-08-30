/* 审迹 · UI 层：样例选择 / 双引擎运行 / 人工复核闭环 / 审计轨迹 / 底稿导出 */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const E = window.Shenji, SAMPLES = window.SAMPLES, CACHE = window.LLM_CACHE || {};

  const state = { sampleId: SAMPLES[0].id, findings: [], trail: [], text: "" };

  function trail(action, detail) {
    state.trail.unshift({ ts: E.now(), action, detail });
    if (state.trail.length > 60) state.trail.pop();
    renderTrail();
  }

  /* ---------- 样例 ---------- */
  function renderChips() {
    $("samples").innerHTML = SAMPLES.map((s, i) =>
      `<button class="chip ${s.id === state.sampleId ? "on" : ""}" data-i="${i}">
        <b>${s.kind === "bad" ? "违规" : "合规"}</b>·${s.title}</button>`).join("") +
      `<button class="chip" data-i="-1"><b>自定义</b>·粘贴待审文档</button>`;
    $("samples").querySelectorAll(".chip").forEach(btn => btn.onclick = () => {
      const i = +btn.dataset.i;
      if (i < 0) { state.sampleId = "custom"; $("desc").textContent = "粘贴任意 SKILL.md / 合规知识文档 / 验证报告进行审计。"; }
      else {
        const s = SAMPLES[i]; state.sampleId = s.id;
        $("input").value = s.text; state.text = s.text;
        $("desc").textContent = s.desc + "　—— 预期：" + s.expect;
      }
      state.findings = []; renderFindings(); renderChips();
      trail("载入样例", state.sampleId);
    });
  }

  /* ---------- 运行规则引擎 ---------- */
  function runRule() {
    state.text = $("input").value;
    if (!state.text.trim()) return flash("请先载入或粘贴待审文档");
    const t0 = performance.now();
    const { findings } = E.analyzeText(state.text);
    state.findings = findings;
    const ms = Math.round(performance.now() - t0);
    trail("规则引擎审计", `${state.text.split("\n").length} 行，${findings.length} 项发现，耗时 ${ms}ms`);
    renderStats(); renderFindings();
    flash(`规则引擎完成：${findings.length} 项发现（${ms}ms，本地确定性运行）`, "ok");
  }

  /* ---------- 运行语义引擎 ---------- */
  async function runSemantic() {
    state.text = $("input").value;
    if (!state.text.trim()) return flash("请先载入或粘贴待审文档");
    const key = $("key").value.trim();
    if (key) localStorage.setItem("shenji_key", key);
    if (!key) {
      const c = CACHE[state.sampleId];
      if (c) {
        state.findings = merge(state.findings, c.findings);
        trail("语义引擎（离线缓存）", `${c.model} @ ${c.date}，${c.findings.length} 项发现`);
        renderStats(); renderFindings();
        return flash(`已载入离线语义审计缓存（${c.model}，${c.date}）。输入密钥可实时重审。`, "ok");
      }
      return flash("未检测到密钥：输入智谱 API Key 可启用实时语义审计（密钥仅存本地浏览器）");
    }
    flash("语义引擎运行中（GLM-5.3）…", "wait");
    try {
      const t0 = performance.now();
      const sem = await E.semanticAudit(state.text, key);
      state.findings = merge(state.findings, sem);
      const ms = Math.round(performance.now() - t0);
      trail("语义引擎审计", `GLM-5.3，${sem.length} 项发现，耗时 ${ms}ms`);
      renderStats(); renderFindings();
      flash(`语义引擎完成：${sem.length} 项发现（${ms}ms）`, "ok");
    } catch (err) {
      trail("语义引擎失败", String(err).slice(0, 120));
      flash("语义引擎失败：" + err.message, "err");
    }
  }

  function merge(base, sem) {
    const baseKey = new Set(base.map(f => f.evidence.map(e => e.no).join(",")));
    const dedup = sem.filter(f => {
      const k = f.evidence.map(e => e.no).join(",");
      return !baseKey.has(k);
    });
    return [...base, ...dedup].sort((a, b) =>
      ({ "红线": 0, "高": 1, "中": 2, "低": 3 })[a.severity] - ({ "红线": 0, "高": 1, "中": 2, "低": 3 })[b.severity]);
  }

  /* ---------- 双样例断言 ---------- */
  function runAssert() {
    const rs = E.runAssertions(SAMPLES);
    const allPass = rs.every(r => r.pass);
    trail("双样例断言", `${rs.length} 项断言，整体 ${allPass ? "PASS" : "FAIL"}（防自证式假验证）`);
    $("assert").innerHTML = `
      <h3>双样例断言 · 防"自证式假验证" <span class="${allPass ? "pass" : "fail"}">整体 ${allPass ? "PASS" : "FAIL"}</span></h3>
      <table><thead><tr><th>样例</th><th>预期</th><th>exit</th><th>拦截/放行依据</th><th>断言</th></tr></thead><tbody>
      ${rs.map(r => `<tr>
        <td>${r.title}</td><td>${r.expect}</td>
        <td><code>exit ${r.exit}</code></td>
        <td>${r.caught.length ? r.caught.join("、") : "—（零红线零高风险）"}</td>
        <td class="${r.pass ? "pass" : "fail"}">${r.pass ? "✓ 通过" : "✗ 未通过"}</td>
      </tr>`).join("")}</tbody></table>
      <p class="note">没有失败样例的通过不予采信：违规样例必须被拦截、合规样例必须被放行，两者同时成立，引擎才算可信。</p>`;
  }

  /* ---------- 人工复核 ---------- */
  function review(i, verdict) {
    const f = state.findings[i];
    if (!f || f.status !== "待人工复核") return;
    f.status = verdict;
    trail("人工复核", `${f.rule}「${f.name}」→ ${verdict}`);
    renderStats(); renderFindings();
  }

  /* ---------- 渲染 ---------- */
  function renderStats() {
    const n = state.findings.length;
    const c = s => state.findings.filter(f => f.severity === s).length;
    const done = state.findings.filter(f => f.status !== "待人工复核").length;
    $("stats").innerHTML = n
      ? `<span>发现 <b>${n}</b></span><span class="sev-red">红线 ${c("红线")}</span><span class="sev-high">高 ${c("高")}</span><span class="sev-mid">中 ${c("中")}</span><span class="sev-low">低 ${c("低")}</span><span>复核闭环 ${done}/${n}</span>`
      : `<span>尚未发现项 — 载入样例后运行审计</span>`;
  }

  function renderFindings() {
    if (!state.findings.length) { $("findings").innerHTML = ""; return; }
    $("findings").innerHTML = state.findings.map((f, i) => `
      <div class="finding sev-${{ "红线": "red", "高": "high", "中": "mid", "低": "low" }[f.severity]}">
        <div class="fhead">
          <span class="sevchip">${f.severity}</span>
          <span class="frule">${f.rule}</span>
          <span class="fname">${f.name}</span>
          <span class="fsrc">${f.source}</span>
        </div>
        ${f.evidence.map(e => `<div class="fevid">行 ${e.no} ｜ <code>${escapeHtml(e.quote)}</code></div>`).join("")}
        <div class="fwhy"><b>判定依据：</b>${escapeHtml(f.why)}</div>
        <div class="ffix"><b>整改建议：</b>${escapeHtml(f.fix)}</div>
        <div class="freview">
          <span class="fstatus ${f.status === "待人工复核" ? "pending" : f.status === "采信" ? "pass" : "fail"}">${f.status}</span>
          ${f.status === "待人工复核" ? `<button data-v="采信" data-i="${i}">采信</button><button data-v="驳回" data-i="${i}">驳回</button>` : ""}
        </div>
      </div>`).join("");
    $("findings").querySelectorAll("button").forEach(b =>
      b.onclick = () => review(+b.dataset.i, b.dataset.v));
  }

  function renderTrail() {
    $("trail").innerHTML = state.trail.map(t =>
      `<li><code>${t.ts}</code> ${t.action} ｜ ${escapeHtml(t.detail)}</li>`).join("");
  }

  /* ---------- 底稿导出 ---------- */
  function exportReport() {
    if (!state.findings.length && !state.trail.length) return flash("请先运行审计");
    const hash = E.hash32(state.text || "");
    const exit = E.exitCode(state.findings);
    const md = `# 审迹 · 审计底稿

- 审计编号：SJ-${Date.now().toString(36).toUpperCase()}
- 审计时间：${E.now()}
- 样本编号：${state.sampleId}　文本指纹：${hash}
- 引擎版本：规则引擎 v0.1（${E.RULES.length} 条规则）＋ 语义引擎 ${E.LLM_MODEL}
- 审计结论：${exit === 1 ? "**拦截**（存在红线/高风险发现）" : "**放行**（无红线/高风险发现）"}

## 审计发现（${state.findings.length} 项）

${state.findings.map((f, i) => `### ${i + 1}. [${f.severity}] ${f.rule} ${f.name}
- 来源：${f.source}　复核状态：${f.status}
- 证据：${f.evidence.map(e => `行 ${e.no}「${e.quote}」`).join("；")}
- 判定依据：${f.why}
- 整改建议：${f.fix}`).join("\n\n")}

## 审计轨迹

${state.trail.map(t => `- \`${t.ts}\` ${t.action} ｜ ${t.detail}`).join("\n")}

---
本底稿由审迹 SHENJI 自动生成；每条发现均附证据坐标，未经人工复核的发现状态为"待人工复核"。
`;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `审迹底稿_${state.sampleId}_${Date.now().toString(36)}.md`;
    a.click();
    trail("导出底稿", `SJ 底稿已导出（exit ${exit}，${state.findings.length} 项发现）`);
    flash("审计底稿已导出（Markdown）", "ok");
  }

  /* ---------- 杂项 ---------- */
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  let flashTimer;
  function flash(msg, kind) {
    const el = $("msg");
    el.textContent = msg;
    el.className = kind || "";
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.textContent = ""; }, 6000);
  }

  /* ---------- 启动 ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    renderChips();
    $("key").value = localStorage.getItem("shenji_key") || "";
    $("run-rule").onclick = runRule;
    $("run-llm").onclick = runSemantic;
    $("run-assert").onclick = runAssert;
    $("export").onclick = exportReport;
    trail("系统就绪", "审迹 MVP v0.1（规则引擎 " + E.RULES.length + " 规则 + 语义引擎 " + E.LLM_MODEL + "）");
  });
})();
