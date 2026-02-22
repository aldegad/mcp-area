const DEFAULT_BASE_URL = "/api";

function resolveBaseUrl() {
  const env = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (env && env.trim()) {
    return env.replace(/\/$/, "");
  }

  return DEFAULT_BASE_URL;
}

export async function apiRequest(path, options = {}) {
  const url = `${resolveBaseUrl()}${path}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "API request failed");
    error.details = data.details;
    throw error;
  }

  return data;
}

export async function fetchRobots() {
  const data = await apiRequest("/robots", { method: "GET" });
  return data.robots || [];
}

export async function uploadRobot(payload) {
  const data = await apiRequest("/robots", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return data.robot;
}

export async function createBattle(payload) {
  const data = await apiRequest("/battles", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return data.battle;
}
