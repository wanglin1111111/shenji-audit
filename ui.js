/* 审迹 · UI 层：样例选择 / 双引擎运行 / 人工复核闭环 / 审计轨迹 / 底稿导出 / 新手引导 */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const E = window.Shenji, SAMPLES = window.SAMPLES, CACHE = window.LLM_CACHE || {};

  const state = {
    sampleId: SAMPLES[0].id, findings: [], trail: [], text: "",
    reviewer: "",      // FIX-06 复核人标识（写入底稿，仅存本地）
    assertRan: false,   // FIX-06 是否运行过双样例断言
    assertPass: false,  // FIX-06 双样例断言结果
  };

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
    // FIX-04 敏感信息检测：默认阻断，放行须人工确认并留痕
    const hits = E.scanSensitive(state.text);
    if (hits.length) {
      const summary = hits.map(h => `${h.label} × ${h.count}`).join("、");
      const ok = confirm(
        "检测到可能的敏感信息：\n" + summary +
        "\n\n继续将把这些内容提交至智谱 GLM（第三方模型服务）。\n\n" +
        "建议：① 删除敏感片段后重试；② 仅使用本地规则引擎；\n" +
        "③ 若已确认不含重要数据且已完成合法的对外提供/委托处理程序，点「确定」继续（本次确认将写入审计轨迹）。"
      );
      if (!ok) {
        trail("语义审计中止", "敏感信息检测命中：" + hits.map(h => h.id + "×" + h.count).join("、"));
        renderStats();
        return flash("已中止语义审计（敏感信息检测）。可仅使用本地规则引擎，全程不出浏览器。", "wait");
      }
      trail("语义审计放行（人工确认）",
            "敏感信息检测命中但用户确认发送：" + hits.map(h => h.id + "×" + h.count).join("、"));
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
    state.assertRan = true;
    state.assertPass = allPass;
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
          <span class="fsrc">${f.source}</span>${/离线缓存/.test(f.source) ? '<span class="cache-badge">离线缓存</span>' : ""}
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
  async function exportReport() {
    if (!state.findings.length && !state.trail.length) return flash("请先运行审计");

    // FIX-06 复核人标识：读取页面输入框（写入底稿，仅存本地，不上传）
    const rev = ($("reviewer") && $("reviewer").value || "").trim();
    if (!rev) return flash("请先在「复核人」框填写标识（写入底稿、仅存本地）——底稿可追溯要求（CSA 1131）", "err");
    if (state.reviewer !== rev) { state.reviewer = rev; trail("设置复核人", rev); }
    localStorage.setItem("shenji_reviewer", rev);

    // FIX-01 结论仅对「已采信」的发现定性；存在未复核项时不得给出结论
    const accepted = state.findings.filter(f => f.status === "采信");
    const pending  = state.findings.filter(f => f.status === "待人工复核");
    const rejected = state.findings.filter(f => f.status === "驳回");
    const exit = E.exitCode(accepted);
    const hiAccepted = accepted.filter(f => f.severity === "红线" || f.severity === "高").length;
    const conclusion = pending.length
      ? `**待人工复核** —— 尚有 ${pending.length}/${state.findings.length} 项发现未经人工定性；本报告不构成审计结论`
      : (exit === 1
          ? `**拦截** —— 经人工采信的红线/高风险发现 ${hiAccepted} 项`
          : `**放行** —— 已完成人工复核，采信的发现中无红线/高风险项`);

    // FIX-06 引擎自验证状态
    const assertNote = !state.assertRan
      ? "⚠ 本次未运行双样例断言，引擎未经自验证"
      : (state.assertPass
          ? "双样例断言：PASS（引擎已通过自验证）"
          : "⚠ 双样例断言：FAIL —— 引擎未通过自验证，本底稿结论不予采信");

    // FIX-05 数据来源构成
    const srcKind = f => /离线缓存/.test(f.source) ? "cache" : (/规则引擎/.test(f.source) ? "rule" : "live");
    const nRule  = state.findings.filter(f => srcKind(f) === "rule").length;
    const nLive  = state.findings.filter(f => srcKind(f) === "live").length;
    const nCache = state.findings.filter(f => srcKind(f) === "cache").length;
    const cacheSrc = [...new Set(state.findings.filter(f => srcKind(f) === "cache").map(f => f.source))];

    // FIX-02 完整性摘要（顺序要点：先算摘要，最后才写「导出底稿」轨迹）
    const auditId = "SJ-" + Date.now().toString(36).toUpperCase();
    const ts = E.now();
    const model = $("model") ? $("model").value : E.LLM_MODEL;
    const textHash = await E.sha256Hex(state.text || "");
    const digest = await E.sha256Hex(E.canonicalize({
      auditId, ts, sampleId: state.sampleId, model, textHash,
      findings: state.findings, trail: state.trail,
    }));

    const md = `# 审迹 · 审计底稿

- 审计编号：${auditId}
- 审计时间：${ts}
- 复核人：${state.reviewer}
- 样本编号：${state.sampleId}　文本指纹（SHA-256）：${textHash}
- 底稿摘要（SHA-256 · SJ-DIGEST-V1）：${digest}
- 引擎版本：审迹 ${E.ENGINE_VERSION}（规则引擎 ${E.RULES.length} 条规则）＋ 语义引擎 ${model}
- 引擎自验证：${assertNote}
- 复核进度：采信 ${accepted.length} ／ 驳回 ${rejected.length} ／ 待复核 ${pending.length}（共 ${state.findings.length} 项）
- 审计结论：${conclusion}

## 数据来源说明

- 规则引擎（本地确定性运行，数据不出浏览器）：${nRule} 项
- 语义引擎实时调用（模型：${model}）：${nLive} 项
- **离线缓存（预生成结果，非本次实时调用）**：${nCache} 项
${cacheSrc.map(s => "  - " + s).join("\n")}
${nCache ? "\n> 标注「离线缓存」的发现为预先生成的历史结果，不代表本次模型实时输出，引用时请注意其时效性。" : ""}

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

    // FIX-02 完整性段：摘要覆盖 输入文本 + 全部发现（含复核状态）+ 审计轨迹
    const integrity = `

## 底稿完整性

- 摘要算法：SJ-DIGEST-V1（SHA-256），规范见 digest-spec.md
- 摘要：
\`\`\`
${digest}
\`\`\`
- 覆盖范围：审计编号、审计时间、样本编号、引擎版本、模型、输入文本指纹、全部发现（含规则ID/严重度/复核状态/证据行号与引用）、审计轨迹
- 验证方式：按 digest-spec.md 的规范化规则对上述字段重新序列化后计算 SHA-256，与上式一致即表明底稿未被修改
- 注意：本摘要用于**防篡改验证**，不提供不可否认性（无数字签名）
`;

    const blob = new Blob([md + integrity], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `审迹底稿_${state.sampleId}_${Date.now().toString(36)}.md`;
    a.click();
    trail("导出底稿", `编号 ${auditId} ｜ exit ${exit}（仅计已采信）｜ ${state.findings.length} 项发现 ｜ 摘要 ${digest.slice(0, 16)}…`);
    flash(`审计底稿已导出 · 摘要 ${digest.slice(0, 16)}…（完整摘要见底稿「底稿完整性」段）`, "ok");
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

  /* ---------- 文档导入：拖拽 / 选择文件 / 粘贴自动识别 ---------- */
  function loadDocText(text, fileName) {
    $("input").value = text;
    state.text = text;
    state.sampleId = "custom";
    state.findings = [];
    renderFindings(); renderChips();
    $("desc").textContent = `已载入文档：${fileName}（${text.split("\n").length} 行 / ${text.length} 字符）。规则审计零配置可用；语义审计需填 Key。`;
    trail("导入文档", `${fileName}（${text.length} 字符）`);
    flash(`已载入「${fileName}」，点「▶ 运行规则审计」开始审计。`, "ok");
  }

  function readTextFile(file) {
    if (file.size > 2 * 1024 * 1024) return flash("文件超过 2MB，请拆分后导入", "err");
    const r = new FileReader();
    r.onload = () => loadDocText(String(r.result || ""), file.name);
    r.onerror = () => flash("文件读取失败，请重试或改用粘贴方式", "err");
    r.readAsText(file, "utf-8");
  }

  function setupImport() {
    const ta = $("input");

    // 窗口级兜底：防止把文件拖到页面其他位置时浏览器直接打开文件、丢掉审计状态
    ["dragover", "dragenter"].forEach(ev =>
      window.addEventListener(ev, e => { if (e.dataTransfer) e.preventDefault(); }));
    window.addEventListener("drop", e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;               // 页面内文本拖放走浏览器默认
      e.preventDefault();
      readTextFile(f);
    });

    // textarea：拖入高亮 + 文件落点
    ta.addEventListener("dragover", e => { e.preventDefault(); ta.classList.add("dropping"); });
    ta.addEventListener("dragleave", () => ta.classList.remove("dropping"));
    ta.addEventListener("drop", e => {
      e.preventDefault(); e.stopPropagation();
      ta.classList.remove("dropping");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readTextFile(f);       // 无文件时是页内文本拖放，走浏览器默认插入
    });

    // 粘贴后自动识别为自定义文档（无需再点「自定义」chip）
    ta.addEventListener("paste", () => setTimeout(() => {
      if (!ta.value.trim()) return;
      state.sampleId = "custom";
      state.text = ta.value;
      renderChips();
      $("desc").textContent = "检测到粘贴内容，直接点「▶ 运行规则审计」即可（发现将 100% 附证据坐标）。";
    }, 0));

    // 文件选择器
    const pick = document.createElement("input");
    pick.type = "file";
    pick.accept = ".md,.txt,.html,.json,.xml,.csv,.log,text/*";
    pick.style.display = "none";
    document.body.appendChild(pick);
    pick.addEventListener("change", () => {
      if (pick.files && pick.files[0]) readTextFile(pick.files[0]);
      pick.value = "";
    });
    const btn = $("pick-file");
    if (btn) btn.addEventListener("click", () => pick.click());
  }

  /* ---------- 启动 ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    renderChips();
    $("key").value = localStorage.getItem("shenji_key") || "";
    if ($("reviewer") && localStorage.getItem("shenji_reviewer")) $("reviewer").value = localStorage.getItem("shenji_reviewer");
    if (localStorage.getItem("shenji_model")) $("model").value = localStorage.getItem("shenji_model");
    $("run-rule").onclick = runRule;
    $("run-llm").onclick = runSemantic;
    $("run-assert").onclick = runAssert;
    $("export").onclick = exportReport;
    setupImport();
    trail("系统就绪", "审迹 MVP v0.3（规则引擎 " + E.RULES.length + " 规则 · 医药费用合规包 · 支持拖拽/选择/粘贴导入）");
  });
})();
