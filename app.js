/* 审迹 SHENJI · 证据链式 AI 审计员 MVP —— 审计引擎（纯函数，Node/浏览器双端可用）
 * 引擎一：规则引擎（本地确定性：红线模式 + 结构缺陷 + 假验证识别，防护语境豁免）
 * 引擎二：语义引擎（GLM-5.3 浏览器直连智谱 Anthropic 协议；密钥仅存 localStorage，不落库）
 * 防假验证：双样例断言（合规样例必须放行 exit 0 / 违规样例必须拦截 exit 1）
 */
(function (root) {
  "use strict";

  const GUARD = /必须拦截|明令禁止|不得|禁止|属于.{0,6}违规|可处罚款/; // 防护语境豁免（结果导向匹配）
  const RULES = [
    {
      id: "RL-01",
      name: "监管红线 · 资金出境规避行为被包装为建议",
      severity: "红线",
      why: "《外汇管理条例》与外管局风控要求：分拆购汇、化整为零规避监管属明令禁止行为；企业 ODI 资金必须与备案金额、用途一致。",
      fix: "删除该\"建议\"；资金出境仅可经 ODI 等合规通道，与备案金额用途一致。",
      patterns: [
        /分批(购汇|出境|换汇)/,
        /拆分购汇|化整为零/,
        /避免触发(监管|外管|审查|关注)/,
        /(绕开|绕过)(监管|审查|备案|申报)/,
        /(借用|冒用).{0,8}(便利化额度|他人额度)/,
      ],
    },
    {
      id: "RL-02",
      name: "无触发路由（frontmatter 缺失）",
      severity: "中",
      why: "缺 YAML frontmatter（name/description 含触发条件与反例）时，Agent 无法正确路由，技能等于不可控的自由发挥。",
      fix: "补齐 frontmatter：name + description（含触发条件与反例）+ version。",
      type: "frontmatter",
    },
    {
      id: "RL-03",
      name: "自证式假验证（通过率 100% 却无断言）",
      severity: "高",
      why: "验证文档只有自证式勾选、没有任何断言与失败样例——做了动作 ≠ 结果成立，这种\"通过\"不予采信。",
      fix: "改为断言式验证：合规样例 exit 0 / 违规样例 exit 1 成对验证，缺一不可。",
      type: "fakeTest",
    },
    {
      id: "RL-04",
      name: "结构编号重复（误导 Agent 结构化输出）",
      severity: "低",
      why: "同级标题编号重复会导致 Agent 生成内容编号错乱、指代不清。",
      fix: "修正编号，保证同级唯一。",
      type: "dupHeading",
    },
    {
      id: "RL-05",
      name: "灰色操作表述",
      severity: "高",
      why: "私户收款、阴阳合同、代持资质等表述属于高危合规风险点，禁止作为建议输出。",
      fix: "删除或改写为合规通道说明，并引用对应法规。",
      patterns: [
        /(私户|个人账户|私下).{0,8}(收款|换汇|转账|收汇)/,
        /(阴阳|两套)(合同|账)/,
        /(代持|挂靠|借用)(资质|牌照|账户|额度)/,
      ],
    },
  ];

  const SEV_ORDER = { "红线": 0, "高": 1, "中": 2, "低": 3 };

  /* ---------------- 规则引擎 ---------------- */
  function analyzeText(text) {
    const lines = text.split("\n");
    const findings = [];
    const push = (rule, hits) => findings.push({
      rule: rule.id, name: rule.name, severity: rule.severity,
      why: rule.why, fix: rule.fix, source: "规则引擎",
      evidence: hits, status: "待人工复核",
    });

    for (const rule of RULES) {
      if (rule.patterns) {
        const hits = [];
        lines.forEach((ln, i) => {
          if (GUARD.test(ln)) return;
          if (rule.patterns.some(re => re.test(ln))) hits.push({ no: i + 1, quote: ln.trim() });
        });
        if (hits.length) push(rule, hits);

      } else if (rule.type === "frontmatter") {
        if (lines.length && lines[0].trim() !== "---") {
          push(rule, [{ no: 1, quote: lines[0].trim().slice(0, 60) }]);
        }

      } else if (rule.type === "fakeTest") {
        const checkCount = (text.match(/\u2705/g) || []).length;
        const selfPass = /全部用例通过|验证完成|100%通过/.test(text);
        const hasAssertion = /断言|失败样例|assert\b|exit\s*[01]|拦截/.test(text);
        if ((checkCount >= 2 || selfPass) && !hasAssertion) {
          const hits = [];
          lines.forEach((ln, i) => {
            if (ln.includes("\u2705") || (selfPass && /全部用例通过|验证完成/.test(ln))) {
              hits.push({ no: i + 1, quote: ln.trim().slice(0, 60) });
            }
          });
          push(rule, hits.slice(0, 4));
        }

      } else if (rule.type === "dupHeading") {
        const seen = new Map(); // key -> 首次出现
        const dups = [];
        lines.forEach((ln, i) => {
          const m = /^##\s*([^：:\d一二三四五六七八九十]*)[：:\s]*([\d一二三四五六七八九十]+)/.exec(ln.trim());
          if (!m) return;
          const key = m[1].trim() + "#" + m[2];
          if (seen.has(key)) dups.push({ no: i + 1, quote: ln.trim(), key });
          else seen.set(key, { no: i + 1, quote: ln.trim() });
        });
        if (dups.length) {
          const hits = [...dups];
          for (const d of dups) {
            const first = seen.get(d.key);
            if (first && !hits.some(h => h.no === first.no)) hits.push(first);
          }
          push(rule, hits.sort((a, b) => a.no - b.no));
        }
      }
    }
    findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
    return { findings, lines };
  }

  function exitCode(findings) {
    return findings.some(f => f.severity === "红线" || f.severity === "高") ? 1 : 0;
  }

  /* ---------------- 双样例断言 ---------------- */
  function runAssertions(samples) {
    return samples.map(s => {
      const { findings } = analyzeText(s.text);
      const exit = exitCode(findings);
      const pass = s.kind === "bad" ? exit === 1 : exit === 0;
      const caught = findings.filter(f => f.severity === "红线" || f.severity === "高").map(f => f.rule);
      return { id: s.id, title: s.title, kind: s.kind, expect: s.expect, exit, pass, caught };
    });
  }

  /* ---------------- 语义引擎（GLM-5.3） ---------------- */
  const LLM_URL = "https://open.bigmodel.cn/api/anthropic/v1/messages";
  const LLM_MODEL = "glm-5.3";
  const SYS_PROMPT =
    "你是企业合规审计员（证据优先，不轻信陈述）。对待审文档逐行审查，只找有真实依据的问题，" +
    "重点识别：1)把违规操作包装成建议；2)法规引用错误或缺失；3)误导性、越界承诺表述；4)自证式假验证。" +
    "每条发现必须给出证据行号与原文引用。不确定的不要编造。只输出 JSON："
    + '{"findings":[{"severity":"红线|高|中|低","title":"…","evidence_line":行号,"quote":"原文","why":"违规理由(引用法规,≤60字)","suggestion":"整改建议(≤40字)"}]}'
    + '。没有问题输出 {"findings":[]}。直接输出 JSON，不要输出其他文字，why/suggestion 保持简洁。';

  async function semanticAudit(text, apiKey) {
    const numbered = text.split("\n").map((l, i) => `${i + 1}| ${l}`).join("\n");
    const res = await fetch(LLM_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL, max_tokens: 3000, temperature: 0.2,
        system: SYS_PROMPT,
        messages: [{ role: "user", content: "待审文档（行号|内容）：\n\n" + numbered }],
      }),
    });
    if (!res.ok) throw new Error("LLM API " + res.status + ": " + (await res.text()).slice(0, 200));
    const data = await res.json();
    const textOut = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const m = /\{[\s\S]*\}/.exec(textOut);
    if (!m) throw new Error("语义引擎未返回 JSON：" + textOut.slice(0, 120));
    const parsed = JSON.parse(m[0]);
    const nLines = text.split("\n").length;
    return (parsed.findings || []).map(f => ({
      rule: "SEM",
      name: f.title || "语义发现",
      severity: ["红线", "高", "中", "低"].includes(f.severity) ? f.severity : "中",
      why: f.why || "", fix: f.suggestion || "",
      source: "语义引擎 · " + LLM_MODEL,
      evidence: [{ no: Math.min(Math.max(1, f.evidence_line | 0), nLines), quote: (f.quote || "").slice(0, 80) }],
      status: "待人工复核",
    }));
  }

  /* ---------------- 工具 ---------------- */
  function hash32(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  function now() {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  const engineAPI = { analyzeText, exitCode, runAssertions, semanticAudit, hash32, now, RULES, LLM_MODEL, LLM_URL, SYS_PROMPT };
  if (typeof module !== "undefined" && module.exports) module.exports = engineAPI;
  root.Shenji = engineAPI;
})(typeof window !== "undefined" ? window : globalThis);
