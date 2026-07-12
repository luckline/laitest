import assert from "node:assert/strict";
import executeCase from "../api/execute_case.js";

const { isExplicitInputAction, normalizeAssertions } = executeCase._test;

assert.equal(isExplicitInputAction("准备前置条件和输入数据"), false);
assert.equal(isExplicitInputAction("按场景要求准备输入数据"), false);
assert.equal(isExplicitInputAction("在搜索框中输入关键词"), true);
assert.equal(isExplicitInputAction("填写手机号和密码"), true);

assert.deepEqual(
  normalizeAssertions({
    title: "验证核心页面可正常加载并显示标题",
    steps: [{ action: "在浏览器地址栏输入目标地址", expected_result: "页面加载完成，无白屏或错误提示" }],
    expected_result: "页面加载完成，无白屏或错误提示",
  })[0],
  { type: "page_loaded", value: "页面主体可见" },
);

console.log("execute case intent tests: passed");
