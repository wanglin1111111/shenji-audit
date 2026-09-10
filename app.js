/* 审迹 SHENJI · 证据链式 AI 审计员 MVP —— 审计引擎（纯函数，Node/浏览器双端可用）
 * 引擎一：规则引擎（本地确定性：红线模式 + 结构缺陷 + 假验证识别，防护语境豁免）
 * 引擎二：语义引擎（GLM-5.3 浏览器直连智谱 Anthropic 协议；密钥仅存 localStorage，不落库）
 * 防假验证：双样例断言（合规样例必须放行 exit 0 / 违规样例必须拦截 exit 1）
 */
(function (root) {
  "use strict";

  const GUARD = /必须拦截|明令禁止|不得|禁止|严禁|违者|属.{0,6}违规|可处罚款/; // 防护语境豁免（结果导向匹配）
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
    /* ---- 医药行业费用合规红线组（2026-09 主题化：医药 × AI 合规风控） ---- */
    {
      id: "RL-06",
      name: "医药费用红线 · 讲课费拆分规避单场标准",
      severity: "红线",
      why: "讲课费单场标准是医药合规与税务口径的硬约束；将超标准讲课费拆分为多笔支付，属规避审批与个税代扣的违规安排（参照医药企业反商业贿赂合规要求）。",
      fix: "删除拆分条款；超标准讲课费走事前特批与合并申报，不得化整为零。",
      patterns: [
        /讲课费[^。\n]{0,20}(拆分|分两笔|分次支付|分多笔)/,
        /(拆分为?两笔|分两笔|分次支付)[^。\n]{0,16}(讲课费|规避|预算|标准|审批)/,
        /(单笔|单场)(超过|超出)[^。\n]{0,14}(可|就|便)(分|拆)/,
      ],
    },
    {
      id: "RL-07",
      name: "医药费用红线 · 签到表补录/影像复用",
      severity: "红线",
      why: "签到表是学术活动真实性的核心证据；补录、代签或跨会议复用影像等于伪造业务证据链。",
      fix: "删除该约定；签到表必须现场产生，影像哈希纳入审计底稿，不得跨会议通用。",
      patterns: [
        /签到表?[^。\n]{0,14}(补录|代签|自行填写|复用|通用|沿用)/,
        /影像(资料)?[^。\n]{0,10}(通用|复用|沿用)/,
        /(后补|事后补)[^。\n]{0,8}(签到|影像|照片)/,
      ],
    },
    {
      id: "RL-08",
      name: "医药费用红线 · CSO 准入从简/先款后证",
      severity: "红线",
      why: "新设 CSO 服务商先付款后补资质，是两票制下虚开与套取资金的高危通道；供应商准入必须前置。",
      fix: "改为「先准入审核、后付款」；准入必须核验资质、社保人数、经营场所与履约能力。",
      patterns: [
        /(先(行)?(打款|付款|支付)[^。\n]{0,10}(后|再)补(资质|证照|准入|资料))|((后|再)补[^。\n]{0,6}(资质|证照|准入))/,
        /(新设|新合作)[^。\n]{0,10}(供应|服务商)[^。\n]{0,16}(从简|先款|免(准入|审核))/,
        /准(入|证)[^。\n]{0,8}(从简|简化)[^。\n]{0,14}(新设|新合作|先行)/,
      ],
    },
    {
      id: "RL-09",
      name: "医药费用红线 · 费用科目腾挪",
      severity: "高",
      why: "把招待、礼品、超预算支出计入会议费/推广费/研发费列支，属于科目腾挪，掩盖业务实质并放大税前扣除风险。",
      fix: "删除腾挪条款；超预算走预算调整流程，按业务实质如实列支。",
      patterns: [
        /(招待|礼品|佣金|回扣|返利)[^。\n]{0,12}(计入|列支|转到?|串到?)[^。\n]{0,8}(会议|会务|推广|咨询|研发|培训)/,
        /(超预算|超标)[^。\n]{0,12}(计入|列入|转到?|列支)[^。\n]{0,8}(会议|会务|推广|咨询|培训)/,
      ],
    },
    {
      id: "RL-10",
      name: "研发归集口径激进表述",
      severity: "中",
      why: "生产/中试人员工时计入研发、设备折旧全额归集以最大化加计扣除，属归集口径激进，高新资质与加计扣除面临被调整风险。",
      fix: "按项目工时分摊表如实归集；非研发人员工时与非研发用途折旧不得计入。",
      patterns: [
        /(生产|中试|销售)[^。\n]{0,6}(人员|工时)[^。\n]{0,10}(计入|纳入|归集)[^。\n]{0,8}研发/,
        /(全额|尽量|最大化)[^。\n]{0,8}(计入|归集)[^。\n]{0,10}(研发|加计扣除)/,
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
    "重点识别：1)把违规操作包装成建议或制度条款；2)法规引用错误或缺失；3)误导性、越界承诺表述；4)自证式假验证；" +
    "5)医药费用合规红线（讲课费拆分、签到表补录复用、CSO 先款后证、招待费科目腾挪、研发归集口径激进）。" +
    "每条发现必须给出证据行号与原文引用。不确定的不要编造。只输出 JSON："
    + '{"findings":[{"severity":"红线|高|中|低","title":"…","evidence_line":行号,"quote":"原文","why":"违规理由(引用法规,≤60字)","suggestion":"整改建议(≤40字)"}]}'
    + '。没有问题输出 {"findings":[]}。直接输出 JSON，不要输出其他文字，why/suggestion 保持简洁。';

  async function semanticAudit(text, apiKey, model) {
    const useModel = model || LLM_MODEL;
    const numbered = text.split("\n").map((l, i) => `${i + 1}| ${l}`).join("\n");
    const res = await fetch(LLM_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: useModel, max_tokens: 3000, temperature: 0.2,
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
      source: "语义引擎 · " + useModel,
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

  /* ---------------- 底稿完整性摘要（SJ-DIGEST-V1） ----------------
   * 规范见 digest-spec.md。摘要覆盖：审计编号/时间/样本/引擎/模型/文本指纹/
   * 全部发现（含复核状态与证据）/审计轨迹。用于防篡改验证，不提供不可否认性。
   */
  const ENGINE_VERSION = "0.3.0";

  async function sha256Hex(s) {
    if (!(globalThis.crypto && globalThis.crypto.subtle)) {
      throw new Error("当前环境不支持 Web Crypto（需 HTTPS 或 localhost 访问），无法生成底稿摘要");
    }
    const buf = new TextEncoder().encode(s);
    const d = await globalThis.crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function canonicalize(o) {
    const L = [];
    L.push("SJ-DIGEST-V1");
    L.push("audit_id=" + o.auditId);
    L.push("timestamp=" + o.ts);
    L.push("sample_id=" + o.sampleId);
    L.push("engine=shenji/" + ENGINE_VERSION);
    L.push("model=" + o.model);
    L.push("text_sha256=" + o.textHash);
    (o.findings || []).forEach((f, i) => {
      L.push("F" + i + "|" + [
        f.rule, f.name, f.severity, f.status,
        (f.evidence || []).map(e => e.no + ":" + e.quote).join("~"),
      ].join("|"));
    });
    L.push("--trail--");
    (o.trail || []).forEach(t => L.push("T|" + [t.ts, t.action, t.detail].join("|")));
    return L.join("\n");
  }

  /* ---------------- 敏感信息检测（外发前置控制） ---------------- */
  const SENSITIVE = [
    { id: "ID-CARD", label: "疑似身份证号",
      re: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g },
    { id: "BANK-CARD", label: "疑似银行卡号", re: /\b\d{16,19}\b/g },
    { id: "MOBILE", label: "疑似手机号码", re: /\b1[3-9]\d{9}\b/g },
    { id: "EMAIL", label: "疑似邮箱地址", re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g },
    { id: "SECRET-MARK", label: "涉密/重要数据标识",
      re: /(?:机密|秘密|绝密|内部资料|不得外传|核心数据|重要数据|未经许可不得)/g },
  ];

  function scanSensitive(text) {
    return SENSITIVE
      .map(s => ({ id: s.id, label: s.label, count: (String(text || "").match(s.re) || []).length }))
      .filter(x => x.count > 0);
  }

  const engineAPI = { analyzeText, exitCode, runAssertions, semanticAudit,
    hash32, sha256Hex, canonicalize, scanSensitive, now,
    RULES, SENSITIVE, ENGINE_VERSION, LLM_MODEL, LLM_URL, SYS_PROMPT };
  if (typeof module !== "undefined" && module.exports) module.exports = engineAPI;
  root.Shenji = engineAPI;
})(typeof window !== "undefined" ? window : globalThis);
