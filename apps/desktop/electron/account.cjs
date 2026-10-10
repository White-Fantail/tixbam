"use strict";
// Account access stays in Electron's main process. The renderer never receives
// the bearer token, and ticket-provider cookies/cards are never uploaded.
const fs = require("node:fs");
const crypto = require("node:crypto");
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
  return ["PUT", "DELETE"].includes(method) && (
    /^\/v1\/me\/(artists|events|watchlist|plans)\/[0-9a-fA-F-]{36}$/.test(endpoint) ||
    /^\/v1\/me\/saved\/(performance|sale)\/[0-9a-fA-F-]{36}$/.test(endpoint)
  );
}

function registerAccount({ ipcMain, dashboardOnly, safeStorage, app, shell, onSessionChanged = () => {} }) {
  const file = path.join(app.getPath("userData"), "tixbam-account.enc");
  let session = null;
  let pending = null;
  let oauthGeneration = 0;
  function save() {
    if (!session) {
      try { fs.unlinkSync(file); } catch (e) { if (e.code !== "ENOENT") throw e; }
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Encrypted account storage is unavailable on this device.");
    const bytes = safeStorage.encryptString(JSON.stringify(session));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tempFile = file + ".tmp";
    try {
      fs.writeFileSync(tempFile, bytes, { mode: 0o600 });
      fs.renameSync(tempFile, file);
    } catch (error) {
      try { fs.unlinkSync(tempFile); } catch { /* Ignore missing temporary file. */ }
      throw error;
    }
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
  async function request(apiUrl, endpoint, method = "GET", body, token, timeoutMs = 8500) {
    if (!allowedApi(apiUrl, app.isPackaged)) throw new Error("Untrusted TIXBAM account API.");
    const response = await fetch(apiUrl.replace(/\/$/, "") + endpoint, {
      method, headers: { "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
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
      const snapshot = await request(active.apiUrl, "/v1/me", "GET", undefined, active.token);
      // Cache only account metadata and non-secret plan information in the
      // same OS-encrypted account file; usable read-only during API outages.
      active.snapshot = snapshot;
      save();
      return snapshot;
    } catch (error) {
      if (error.status === 401) {
        session = null;
        save();
        return null;
      }
      // Never bypass an explicit authentication/authorization error.
      if ((!error.status || error.status >= 500) &&
          active.snapshot?.user?.id && typeof active.expiresAt === "string" &&
          Date.now() < Date.parse(active.expiresAt)) {
        return { ...active.snapshot, offline: true };
      }
      throw error;
    }
  });
  ipcMain.handle("tixbam:account-oauth-start", async (event, apiUrl, provider) => {
    dashboardOnly(event);
    if (provider !== "google" && provider !== "apple") throw Error("Unsupported OAuth provider");
    apiUrl = publicOrigin(apiUrl);
    // Only the main process knows this verifier: the renderer never receives it.
    const generation = ++oauthGeneration;
    const verifier = crypto.randomBytes(48).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const info = await request(apiUrl, "/v1/auth/oauth/start", "POST", { provider, codeChallenge });
    if (generation !== oauthGeneration) throw Error("Sign-in was cancelled");
    if (!/^[0-9a-f-]{36}$/i.test(info.flowId) || !Number.isInteger(info.expiresIn)
        || info.expiresIn < 10 || info.expiresIn > 600) throw Error("Invalid OAuth flow from TIXBAM");
    const url = new URL(info.authorizationUrl);
    if (url.protocol !== "https:" ||
        url.origin !== (provider === "google" ? "https://accounts.google.com" : "https://appleid.apple.com") ||
        url.pathname !== (provider === "google" ? "/o/oauth2/v2/auth" : "/auth/authorize") ||
        url.username || url.password) throw Error("Unsafe OAuth provider URL");
    pending = { apiUrl, verifier, flowId: info.flowId, expiresAt: Date.now() + info.expiresIn * 1000 };
    try {
      await shell.openExternal(url.toString());
    } catch (error) {
      pending = null;
      throw error;
    }
    return { provider, expiresIn: info.expiresIn };
  });
  ipcMain.handle("tixbam:account-oauth-poll", async event => {
    dashboardOnly(event);
    if (!pending) throw Error("No active social sign-in");
    if (Date.now() >= pending.expiresAt) {
      pending = null;
      throw Error("Sign-in timed out. Please try again.");
    }
    const attempt = pending;
    const result = await request(attempt.apiUrl, "/v1/auth/oauth/complete", "POST",
      { flowId: attempt.flowId, verifier: attempt.verifier });
    if (result.status === "pending") return null;
    if (!result.accessToken || !safeStorage.isEncryptionAvailable()) {
      throw Error("Encrypted account storage is unavailable");
    }
    // Avoid races if the user cancelled this attempt while polling.
    if (pending !== attempt) return null;
    // Revoke every host-only observation token before changing identity.
    onSessionChanged();
    const previous = session;
    session = { apiUrl: attempt.apiUrl, token: result.accessToken, expiresAt: result.expiresAt };
    try { save(); } catch (error) { session = previous; throw error; }
    pending = null;
    const snapshot = await request(session.apiUrl, "/v1/me", "GET", undefined, session.token);
    session.snapshot = snapshot;
    save();
    return snapshot;
  });
  ipcMain.handle("tixbam:account-oauth-cancel", event => {
    dashboardOnly(event);
    ++oauthGeneration;
    pending = null;
    return true;
  });
  ipcMain.handle("tixbam:account-sign-out", event => {
    dashboardOnly(event);
    ++oauthGeneration;
    onSessionChanged();
    session = null;
    pending = null;
    save();
    return true;
  });
  ipcMain.handle("tixbam:account-request", async (event, method, endpoint, body) => {
    dashboardOnly(event);
    if (!allowedAccountEndpoint(method, endpoint)) throw Error("Unsupported account operation");
    const active = load();
    if (!active) throw Error("Please sign in first");
    try {
      const answer = await request(active.apiUrl, endpoint, method, body, active.token);
      // Keep plan cache current without a second network round-trip. Do not
      // cache card data, provider sessions or dynamic payment conditions.
      if (active.snapshot && endpoint.startsWith("/v1/me/plans/")) {
        const id = endpoint.slice("/v1/me/plans/".length);
        const rest = (active.snapshot.bookingPlans || []).filter(plan => plan.id !== id);
        active.snapshot.bookingPlans = method === "PUT" ? [...rest, answer] : rest;
        save();
      }
      return answer;
    } catch (error) {
      if (error.status === 401) { session = null; save(); }
      throw error;
    }
  });
  return {
    async bookingTarget(planId, providerId) {
      if(!/^[0-9a-f-]{36}$/i.test(planId||''))throw new Error('Registered Booking Plan required.');
      const active=load();
      if(!active)throw new Error('Sign in to coordinate a booking across devices.');
      // A fresh authenticated read is mandatory: stale offline snapshots cannot
      // authorize server-side ownership or payment.
      const result=await request(active.apiUrl,'/v1/me','GET',undefined,active.token,6500);
      const plan=result.bookingPlans?.find(x=>x.id===planId);
      if(!plan||plan.providerId!==providerId||!plan.saleId||!plan.performanceId)
        throw new Error('This plan lacks a verified sale and performance. Use manual booking.');
      if(!/^[0-9a-f-]{36}$/i.test(plan.saleId)||!/^[0-9a-f-]{36}$/i.test(plan.performanceId)||
         !/^[0-9a-f-]{36}$/i.test(result.user?.id||''))
        throw new Error('Invalid server target identifiers.');
      return {accountId:result.user.id,providerId,
        planId,saleId:plan.saleId,performanceId:plan.performanceId};
    },
    async bookingLease(operation, body) {
      if(!['acquire','renew','release','claim'].includes(operation))
        throw new Error('Unrecognized booking lease operation.');
      const active=load();
      if(!active)throw new Error('Sign in before coordinating booking sessions.');
      return request(active.apiUrl,'/v1/me/automation/leases/'+operation,
        'POST',body,active.token,6500);
    },
    async aiPlan(payload) {
      const active=load();
      if(!active)throw new Error('Sign in to request PlannerV1 advice.');
      const result=await request(active.apiUrl,'/v1/ai/plans','POST',
        payload,active.token,16000);
      // Sign-out or account switching while OpenRouter was responding must
      // never return a suggestion into the original rehearsal session.
      if(load()!==active)throw new Error('Planner session changed');
      return result;
    },
    async aiVision(payload) {
      const active=load();
      if(!active)throw new Error('Sign in to use Copilot Vision.');
      const result=await request(active.apiUrl,'/v1/ai/copilot/vision',
        'POST',payload,active.token,16500);
      if(load()!==active)throw new Error('Copilot Vision account changed.');
      return result;
    },
    async aiAdvice(payload) {
      const active = load();
      if (!active) throw new Error("Sign in to TIXBAM to use AI guidance.");
      // The API origin and bearer token always come from the encrypted main-process session.
      return request(active.apiUrl, "/v1/ai/advice", "POST", payload, active.token, 16000);
    }
  };
}

module.exports = { registerAccount, allowedApi, allowedAccountEndpoint, PRODUCTION_API };
