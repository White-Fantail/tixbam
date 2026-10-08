"use strict";
// Account access stays in Electron's main process. The renderer never receives
// the bearer token, and ticket-provider cookies/cards are never uploaded.
const fs = require("node:fs");
const path = require("node:path");
const PRODUCTION_API = "https://tixbam-production.up.railway.app";

function allowedApi(url, isPackaged) {
  try {
    const u = new URL(url);
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/") return false;
    if (u.origin === PRODUCTION_API) return true;
    return !isPackaged && u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function allowedAccountEndpoint(method, endpoint) {
  if (method === "GET" && endpoint === "/v1/me") return true;
  return ["PUT", "DELETE"].includes(method) &&
    /^\/v1\/me\/(artists|events|watchlist)\/[0-9a-fA-F-]{36}$/.test(endpoint);
}

function registerAccount({ ipcMain, dashboardOnly, safeStorage, app }) {
  const file = path.join(app.getPath("userData"), "tixbam-account.enc");
  let session = null;
  function save() {
    if (!session) {
      try { fs.unlinkSync(file); } catch (e) { if (e.code !== "ENOENT") throw e; }
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Encrypted account storage is unavailable on this device.");
    const bytes = safeStorage.encryptString(JSON.stringify(session));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes, { mode: 0o600 });
  }
  function load() {
    if (session) return session;
    if (!fs.existsSync(file)) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Encrypted account storage is unavailable on this device.");
    try {
      const record = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      if (typeof record.token !== "string" || !allowedApi(record.apiUrl, app.isPackaged)) throw Error("Invalid account session");
      session = record;
      return session;
    } catch {
      // Invalid local ciphertext must not be reused as an account.
      session = null;
      throw new Error("Could not unlock this device's account session. Sign out to reset it.");
    }
  }
  async function request(apiUrl, endpoint, method = "GET", body, token) {
    if (!allowedApi(apiUrl, app.isPackaged)) throw new Error("Untrusted TIXBAM account API.");
    const response = await fetch(apiUrl.replace(/\/$/, "") + endpoint, {
      method, headers: { "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8500)
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(typeof data.detail === "string" ? data.detail : "Account API HTTP " + response.status);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  function publicOrigin(candidate) {
    // The renderer may select the bundled official URL or an explicit local
    // development API. Never forward a cloud bearer token to an arbitrary host.
    if (!allowedApi(candidate, app.isPackaged)) throw new Error("Untrusted account API origin");
    return candidate;
  }
  ipcMain.handle("tixbam:account-status", async event => {
    dashboardOnly(event);
    const active = load();
    if (!active) return null;
    try {
      return await request(active.apiUrl, "/v1/me", "GET", undefined, active.token);
    } catch (error) {
      if (error.status === 401) {
        session = null;
        save();
        return null;
      }
      throw error;
    }
  });
  ipcMain.handle("tixbam:account-demo-login", async (event, apiUrl, account) => {
    dashboardOnly(event);
    if (account !== "fan-one" && account !== "fan-two") throw Error("Unknown demo account");
    apiUrl = publicOrigin(apiUrl);
    const result = await request(apiUrl, "/v1/auth/dev", "POST", { account });
    if (!result.accessToken) throw Error("No account session returned");
    if (!safeStorage.isEncryptionAvailable()) throw Error("Encrypted account storage unavailable");
    const next = { apiUrl, token: result.accessToken };
    const previous = session;
    session = next;
    try { save(); } catch (error) { session = previous; throw error; }
    return request(apiUrl, "/v1/me", "GET", undefined, next.token);
  });
  // Once native authorization-code + PKCE UI is connected, it can pass the
  // *provider-issued ID token* here; the API verifies signature/aud/iss/exp.
  ipcMain.handle("tixbam:account-social-token", async (event, apiUrl, provider, idToken) => {
    dashboardOnly(event);
    if (!["google", "apple"].includes(provider) || typeof idToken !== "string") throw Error("Invalid provider token");
    apiUrl = publicOrigin(apiUrl);
    const result = await request(apiUrl, "/v1/auth/social", "POST", { provider, idToken });
    if (!result.accessToken || !safeStorage.isEncryptionAvailable()) throw Error("Cannot store sign-in securely");
    const previous = session;
    session = { apiUrl, token: result.accessToken };
    try { save(); } catch (error) { session = previous; throw error; }
    return request(apiUrl, "/v1/me", "GET", undefined, session.token);
  });
  ipcMain.handle("tixbam:account-sign-out", event => {
    dashboardOnly(event);
    session = null;
    save();
    return true;
  });
  ipcMain.handle("tixbam:account-request", async (event, method, endpoint, body) => {
    dashboardOnly(event);
    if (!allowedAccountEndpoint(method, endpoint)) throw Error("Unsupported account operation");
    const active = load();
    if (!active) throw Error("Please sign in first");
    try {
      return await request(active.apiUrl, endpoint, method, body, active.token);
    } catch (error) {
      if (error.status === 401) { session = null; save(); }
      throw error;
    }
  });
}

module.exports = { registerAccount, allowedApi, allowedAccountEndpoint, PRODUCTION_API };
