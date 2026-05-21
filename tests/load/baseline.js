import http from "k6/http";
import { check, fail } from "k6";

function randomString(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const ACCOUNT_COUNT = Number(__ENV.ACCOUNT_COUNT || "5000");
const TARGET_RPS = Number(__ENV.TARGET_RPS || "250");
const DURATION = __ENV.DURATION || "60s";
const PRE_ALLOCATED_VUS = Number(__ENV.PRE_ALLOCATED_VUS || "80");
const MAX_VUS = Number(__ENV.MAX_VUS || "400");

export const options = {
  scenarios: {
    transfers: {
      executor: "constant-arrival-rate",
      rate: TARGET_RPS,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: PRE_ALLOCATED_VUS,
      maxVUs: MAX_VUS,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<300", "p(99)<800"],
    http_req_failed: ["rate<0.01"],
  },
};

export function setup() {
  if (ACCOUNT_COUNT < 2) {
    fail("ACCOUNT_COUNT must be >= 2");
  }

  const accounts = [];
  for (let i = 0; i < ACCOUNT_COUNT; i += 1) {
    const res = http.post(
      `${BASE_URL}/accounts`,
      JSON.stringify({ name: `Account ${i}`, initialBalance: 1_000_000 }),
      { headers: { "Content-Type": "application/json" } },
    );

    if (res.status !== 201) {
      fail(
        `failed to create account ${i}: status=${res.status} body=${res.body}`,
      );
    }

    const body = JSON.parse(res.body);
    accounts.push(body.id);
  }
  return { accounts };
}

export default function (data) {
  const { accounts } = data;

  const fromIdx = (__VU + __ITER) % accounts.length;
  const toIdx =
    (fromIdx + 1 + (__ITER % (accounts.length - 1))) % accounts.length;

  const payload = JSON.stringify({
    fromAccountId: accounts[fromIdx],
    toAccountId: accounts[toIdx],
    amount: Math.floor(Math.random() * 1000) + 1,
    idempotencyKey: `load-${randomString(24)}`,
  });

  const res = http.post(`${BASE_URL}/transfers`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  check(res, {
    "status is 201": (r) => r.status === 201,
    "has 2 entries": (r) => {
      try {
        return JSON.parse(r.body).entries.length === 2;
      } catch {
        return false;
      }
    },
  });
}
