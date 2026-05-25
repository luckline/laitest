const API_BASE = (process.env.LAITEST_API_BASE || "http://127.0.0.1:8080").replace(/\/+$/, "");
const API_TOKEN = process.env.LAITEST_TOKEN || "";

async function requestTravelPlan(userInput) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }

  const response = await fetch(`${API_BASE}/api/ai/travel_plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user_input: userInput,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

async function main() {
  const userInput =
    "我想在8月带父母去日本关西玩5天，预算2万元人民币，尽量轻松一点，喜欢美食和历史街区，" +
    "希望避开太赶的换酒店安排。";

  const result = await requestTravelPlan(userInput);

  console.log("provider:", result.provider);
  console.log("model:", result.model);
  console.log("elapsed_ms:", result.elapsed_ms);
  console.log("\ntravel_plan:\n");
  console.log(result.travel_plan || "");
}

main().catch((error) => {
  console.error("travel plan request failed:", error.message);
  process.exitCode = 1;
});
