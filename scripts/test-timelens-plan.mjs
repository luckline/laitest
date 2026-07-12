import assert from "node:assert/strict";

await import("../timelens-plan.js");

const sample = `好的，下面是路线建议。

### 行程概览
* **主题：** 运河文化家庭游
* **提醒：** 注意防暑

---

#### **Day 1 – 抵达济宁**
* **上午：** 抵达酒店
* **下午：** 参观博物馆

#### Day 2 – 曲阜
* 游览孔庙与孔府
<script>alert(1)</script>`;

const plan = globalThis.TimeLensPlan.parse(sample);
assert.equal(plan.version, 1);
assert.equal(plan.sections.length, 4);
assert.equal(plan.sections[2].title, "Day 1 – 抵达济宁");
assert.equal(plan.sections[2].items.length, 2);

const html = globalThis.TimeLensPlan.render(plan, { provider: "deepseek", elapsedMs: 24087 });
assert.match(html, /路线方案/);
assert.match(html, /travel-plan-section day/);
assert.match(html, /耗时 24\.1 秒/);
assert.doesNotMatch(html, /<script>/);
assert.match(html, /&lt;script&gt;/);

console.log("TimeLens plan parser: OK");
