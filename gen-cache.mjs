/* 生成内置样例的离线语义审计缓存（llm-cache.js）
 * 运行：node gen-cache.mjs   （需要环境变量 GLM_KEY 或 ~/.opencodereview/.api_key）
 * 输出与在线语义引擎同一提示词，保证缓存与实时结果同源。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("./app.js");
const SAMPLES = require("./samples.js");

const KEY = (process.env.GLM_KEY || readFileSync(process.env.HOME + "/.opencodereview/.api_key", "utf8")).replace(/\s+/g, "");

async function audit(sample) {
  const numbered = sample.text.split("\n").map((l, i) => `${i + 1}| ${l}`).join("\n");
  const res = await fetch(E.LLM_URL, {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: E.LLM_MODEL, max_tokens: 6000, temperature: 0.2,
      system: E.SYS_PROMPT,
      messages: [{ role: "user", content: "待审文档（行号|内容）：\n\n" + numbered }],
    }),
  });
  if (!res.ok) throw new Error(`${sample.id}: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error(`${sample.id}: no JSON in: ${text.slice(0, 200)}`);
  return JSON.parse(m[0]).findings || [];
}

const cache = {};
for (const s of SAMPLES) {
  try {
    const findings = await audit(s);
    cache[s.id] = { date: new Date().toISOString().slice(0, 10), model: E.LLM_MODEL, findings };
    console.log(`${s.id}: ${findings.length} findings`);
    for (const f of findings) console.log(`  [${f.severity}] L${f.evidence_line} ${f.title}`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}

const out = `/* 审迹 · 内置样例离线语义审计缓存（与在线语义引擎同提示词生成）
 * 生成：node gen-cache.mjs ｜ 模型：glm-5.3 ｜ 生成日期：${new Date().toISOString().slice(0, 10)}
 * 用途：评审环境无 API Key 时，语义引擎结果以此缓存呈现（与规则引擎实时结果合并展示）。
 */
window.LLM_CACHE = ${JSON.stringify(cache, null, 2)};
`;
writeFileSync(new URL("./llm-cache.js", import.meta.url), out, "utf8");
console.log("llm-cache.js written");
