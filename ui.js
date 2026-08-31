/* 审迹 · UI 层：样例选择 / 双引擎运行 / 人工复核闭环 / 审计轨迹 / 底稿导出 / 新手引导 */
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
      if (i < 0) { state.sampleId = "custom"; $("desc").textContent = "粘贴任意 SKILL.md / 合规知识文档 / 验证报告进行审计。规则审计零配置可用；语义审计需填 Key（免费获取教程见上方使用说明书）。"; }
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
    if (!state.text.trim()) return flash("请先点击上方任一样例，或在文本框粘贴待审文档", "err");
    const t0 = performance.now();
    const { findings } = E.analyzeText(state.text);
    state.findings = findings;
    const ms = Math.max(1, Math.round(performance.now() - t0));
    trail("规则引擎审计", `${state.text.split("\n").length} 行，${findings.length} 项发现，耗时 ${ms}ms`);
    renderStats(); renderFindings();
    flash(`规则引擎完成：${findings.length} 项发现（${ms}ms，本地运行）。请在发现卡片底部点「采信 / 驳回」完成人工复核。`, "ok");
  }

  /* ---------- 运行语义引擎 ---------- */
  async function runSemantic() {
    state.text = $("input").value;
    if (!state.text.trim()) return flash("请先点击上方任一样例，或在文本框粘贴待审文档", "err");
    const key = $("key").value.trim();
    if (key) localStorage.setItem("shenji_key", key);
    const model = $("model").value;
    localStorage.setItem("shenji_model", model);
    if (!key) {
      const c = CACHE[state.sampleId];
      if (c) {
        const norm = (c.findings || []).map(f => ({
          rule: "SEM",
          name: f.title || "语义发现",
          severity: ["红线", "高", "中", "低"].includes(f.severity) ? f.severity : "中",
          why: f.why || "", fix: f.suggestion || "",
          source: "语义引擎 · " + (c.model || "glm-5.3") + "（离线缓存 " + c.date + "）",
          evidence: [{ no: Math.max(1, f.evidence_line | 0), quote: (f.quote || "").slice(0, 80) }],
          status: "待人工复核",
        }));
        state.findings = merge(state.findings, norm);
        trail("语义引擎（离线缓存）", `${c.model} @ ${c.date}，${norm.length} 项发现`);
        renderStats(); renderFindings();
        return flash(`已载入离线语义审计缓存（${norm.length} 项发现）。内置样例零配置即可体验；自定义文本想实时 AI 审计？看「使用说明书·二」，三步免费获取 Key（默认已选免费档模型 ${model}）。`, "ok");
      }
      $("guide").open = true;
      $("guide").scrollIntoView({ behavior: "smooth", block: "start" });
      return flash("自定义文本的实时语义审计需要一把免费的智谱 Key：已为你展开「使用说明书·二」，三步即可获取（默认已选免费档模型）。不填 Key 时，规则审计与全部复核工作流不受影响。", "wait");
    }
    flash("语义引擎运行中（" + model + "）…", "wait");
    try {
      const t0 = performance.now();
      const sem = await E.semanticAudit(state.text, key, model);
      state.findings = merge(state.findings, sem);
      const ms = Math.round(performance.now() - t0);
      trail("语义引擎审计", `${model}，${sem.length} 项发现，耗时 ${ms}ms`);
      renderStats(); renderFindings();
      flash(`语义引擎完成（${model}）：${sem.length} 项发现（${ms}ms）。请在发现卡片底部点「采信 / 驳回」完成人工复核。`, "ok");
    } catch (err) {
      trail("语义引擎失败", String(err).slice(0, 120));
      flash("语义引擎失败：" + err.message + "（Key 无效或额度不足？可换免费档模型重试，或仅用规则引擎）", "err");
    }
  }

  function merge(base, sem) {
    const keyOf = f => (f.evidence || []).map(e => e.no).join(",");
    const baseKey = new Set(base.map(keyOf));
    const dedup = sem.filter(f => !baseKey.has(keyOf(f)));
    const order = { "红线": 0, "高": 1, "中": 2, "低": 3 };
    return [...base, ...dedup].sort((a, b) => order[a.severity] - order[b.severity]);
  }

  /* ---------- 双样例断言 ---------- */
  function runAssert() {
    const rs = E.runAssertions(SAMPLES);
    const allPass = rs.every(r => r.pass);
    trail("双样例断言", `${rs.length} 项断言，整体 ${allPass ? "PASS" : "FAIL"}（防自证式假验证）`);
    $("assert").innerHTML = `
      <h3 style="margin-top:6px">双样例断言结果 <span class="${allPass ? "pass" : "fail"}">整体 ${allPass ? "PASS" : "FAIL"}</span></h3>
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
    const done = state.findings.filter(x => x.status !== "待人工复核").length;
    flash(`人工复核完成（${verdict}）：${done}/${state.findings.length} 已闭环。全部复核后可点「导出审计底稿」留痕。`, "ok");
  }

  /* ---------- 渲染 ---------- */
  function renderStats() {
    const n = state.findings.length;
    const c = s => state.findings.filter(f => f.severity === s).length;
    const done = state.findings.filter(f => f.status !== "待人工复核").length;
    $("stats").innerHTML = n
      ? `<span>发现 <b>${n}</b></span><span class="sev-red">红线 ${c("红线")}</span><span class="sev-high">高 ${c("高")}</span><span class="sev-mid">中 ${c("中")}</span><span class="sev-low">低 ${c("低")}</span><span>复核闭环 ${done}/${n}</span>`
      : `<span>尚未运行审计 —— 按页面顶部 ①→⑤ 步骤条操作即可</span>`;
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
          ${f.status === "待人工复核"
            ? `<button data-v="采信" data-i="${i}">✓ 采信</button><button data-v="驳回" data-i="${i}">✕ 驳回</button><span class="hint">← 人工定性（合规工作流第 4 步，动作自动留痕）</span>`
            : ""}
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
- 引擎版本：规则引擎 v0.2（${E.RULES.length} 条规则）＋ 语义引擎 ${$("model") ? $("model").value : E.LLM_MODEL}
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
联系我们：2281216234@qq.com
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
    flashTimer = setTimeout(() => { el.textContent = ""; }, 9000);
  }

  /* ---------- 启动 ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    renderChips();
    $("key").value = localStorage.getItem("shenji_key") || "";
    if (localStorage.getItem("shenji_model")) $("model").value = localStorage.getItem("shenji_model");
    $("run-rule").onclick = runRule;
    $("run-llm").onclick = runSemantic;
    $("run-assert").onclick = runAssert;
    $("export").onclick = exportReport;
    trail("系统就绪", "审迹 MVP v0.2（规则引擎 " + E.RULES.length + " 规则 + 语义引擎，支持免费档模型）");
  });
})();
