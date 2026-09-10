# 审迹底稿摘要算法规范 · SJ-DIGEST-V1

本文件公开审迹 SHENJI 审计底稿的完整性摘要算法，供任何人独立验证底稿是否被修改。

- **算法**：SHA-256
- **规范版本**：`SJ-DIGEST-V1`
- **适用**：审迹 SHENJI v0.3.0 及以后导出的 Markdown 审计底稿
- **生效日期**：2026-09-10

---

## 1. 这个摘要能证明什么、不能证明什么

| 能力 | 支持情况 |
|---|---|
| 检测底稿内容被修改（增删改任一字符） | ✅ 支持 |
| 检测复核状态被篡改（驳回 → 采信） | ✅ 支持 |
| 检测审计轨迹被增删 | ✅ 支持 |
| 检测输入文本被替换 | ✅ 支持 |
| 证明底稿由「审迹」生成（不可否认性） | ❌ **不支持** —— 无数字签名，任何人都能算出合法摘要 |
| 防止整份底稿连同摘要一起伪造 | ❌ **不支持** —— 如需对第三方证明来源，须另行引入签名与时间源 |

> 本摘要的定位是**防篡改验证**，不是**来源认证**。需要向第三方（如监管部门、客户）证明底稿来源时，应另行引入数字签名或可信时间源。

---

## 2. 摘要覆盖范围

对下列字段按 §3 规范化后计算 SHA-256：

1. 规范标识 `SJ-DIGEST-V1`
2. 审计编号 `audit_id`
3. 审计时间 `timestamp`
4. 样本编号 `sample_id`
5. 引擎版本 `engine`
6. 语义模型 `model`
7. 输入文本指纹 `text_sha256`（对输入文本本身计算的 SHA-256）
8. **全部发现**（逐条）：规则 ID、发现名称、严重度、**复核状态**、证据（行号:引用，多条以 `~` 连接）
9. 分隔符 `--trail--`
10. **审计轨迹**（逐条）：时间戳、动作、详情

**不纳入摘要的**：导出动作本身（该条轨迹在摘要计算完成后才写入）。

---

## 3. 规范化规则（Canonicalization）

按下列顺序拼接，字段间以换行符 `\n` 分隔（LF，非 CRLF）：

```
SJ-DIGEST-V1
audit_id=<审计编号>
timestamp=<审计时间>
sample_id=<样本编号>
engine=shenji/<引擎版本>
model=<语义模型>
text_sha256=<输入文本SHA-256>
F0|<规则ID>|<名称>|<严重度>|<复核状态>|<行号:引用>~<行号:引用>
F1|...
F<n>|...
--trail--
T|<时间戳>|<动作>|<详情>
T|...
```

**细则**：

| 项 | 规则 |
|---|---|
| 换行符 | 统一 `\n`（LF） |
| 编码 | UTF-8 |
| 发现条目序号 | `F` + 从 0 开始的序号，按导出时的排序（严重度降序） |
| 缺失字段 | 以空字符串表示，占位符不可省略（如 `F3|RL-01|...|||` ） |
| 证据分隔 | 单条发现的多条证据以 `~` 连接；单条证据格式为 `行号:引用原文` |
| 字段分隔 | 统一使用半角竖线 `|` |
| 轨迹条目 | 按导出时的顺序（最新在前）逐条输出 |

---

## 4. 参考实现

```js
const ENGINE_VERSION = "0.3.0";

async function sha256Hex(s) {
  if (!(globalThis.crypto && globalThis.crypto.subtle)) {
    throw new Error("需 HTTPS 或 localhost 环境（Web Crypto）");
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
  o.findings.forEach((f, i) => {
    L.push("F" + i + "|" + [
      f.rule, f.name, f.severity, f.status,
      (f.evidence || []).map(e => e.no + ":" + e.quote).join("~"),
    ].join("|"));
  });
  L.push("--trail--");
  o.trail.forEach(t => L.push("T|" + [t.ts, t.action, t.detail].join("|")));
  return L.join("\n");
}
```

---

## 5. 验证步骤

1. 打开待验证的 Markdown 底稿，取出下列字段：审计编号、审计时间、样本编号、引擎版本、模型、文本指纹、全部发现（含复核状态与证据）、审计轨迹
2. 按 §3 拼接为规范化字符串
3. 对字符串计算 SHA-256（UTF-8）
4. 与底稿「底稿完整性」段的摘要逐字符比对
5. **一致** → 底稿内容与导出时一致；**不一致** → 底稿已被修改，不应作为审计证据采信

> **注意**：摘要绑定本次导出事件（含审计编号与时间戳）。重新导出同一状态会得到不同摘要，这是预期行为，不代表底稿被篡改。

---

## 6. 变更历史

| 版本 | 日期 | 说明 |
|---|---|---|
| SJ-DIGEST-V1 | 2026-09-10 | 首发。取代 FNV-1a 32 位 `hash32`（该算法不具备抗碰撞性，不再用于新底稿） |
