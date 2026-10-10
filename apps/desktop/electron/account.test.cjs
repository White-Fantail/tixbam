const test = require("node:test");
const assert = require("node:assert/strict");
const { allowedApi, allowedAccountEndpoint, PRODUCTION_API } = require("./account.cjs");

test("packaged desktop pins account tokens to the official API", () => {
  assert.equal(allowedApi(PRODUCTION_API, true), true);
  for (const url of ["https://evil.example", "http://localhost:8000",
    "https://tixbam-production.up.railway.app.evil.example",
    "https://user:pass@tixbam-production.up.railway.app",
    "https://tixbam-production.up.railway.app/trap"]) {
    assert.equal(allowedApi(url, true), false, url);
  }
  assert.equal(allowedApi("http://127.0.0.1:8000", false), true);
  assert.equal(allowedApi("http://example.com", false), false);
});

test("renderer may call only scoped self-service account routes", () => {
  const id = "a5313572-0871-4c2c-bbd3-f0faedca4662";
  assert.equal(allowedAccountEndpoint("GET", "/v1/me"), true);
  assert.equal(allowedAccountEndpoint("PUT", "/v1/me/watchlist/" + id), true);
  assert.equal(allowedAccountEndpoint("DELETE", "/v1/me/artists/" + id), true);
  assert.equal(allowedAccountEndpoint("PUT", "/v1/me/plans/" + id), true);
  assert.equal(allowedAccountEndpoint("DELETE", "/v1/me/saved/performance/" + id), true);
  assert.equal(allowedAccountEndpoint("PUT", "/v1/me/saved/sale/" + id), true);
  assert.equal(allowedAccountEndpoint("PUT", "/v1/me/saved/admin/" + id), false);
  for (const pair of [["POST", "/v1/admin/artists"], ["DELETE", "/v1/me"],
    ["PUT", "/v1/me/events/../admin"], ["PUT", "/v1/me/sessions/" + id],
    ["GET", "/v1/me/watchlist/" + id], ["POST", "/v1/auth/dev"]]) {
    assert.equal(allowedAccountEndpoint(...pair), false);
  }
});

test("OAuth account flow URLs cannot be used to bypass the self-service API allowlist", () => {
  for (const endpoint of ["/v1/auth/oauth/start", "/v1/auth/oauth/complete", "/v1/auth/dev", "/v1/auth/social"]) {
    assert.equal(allowedAccountEndpoint("POST", endpoint), false);
  }
});


test("account sign-out invalidates host observation tokens without touching provider data", () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const {registerAccount} = require("./account.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tixbam-observation-account-"));
  const handlers = new Map();
  let invalidated = 0;
  try {
    registerAccount({
      ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},
      dashboardOnly:event=>{if(!event.authorized)throw Error("Unauthorized");},
      safeStorage:{isEncryptionAvailable:()=>false},
      app:{getPath:()=>dir,isPackaged:true},
      shell:{openExternal:async()=>{}},
      onSessionChanged:()=>invalidated++,
    });
    const signout=handlers.get("tixbam:account-sign-out");
    assert.equal(typeof signout,"function");
    assert.equal(signout({authorized:true}),true);
    assert.equal(invalidated,1);
    assert.throws(()=>signout({authorized:false}),/Unauthorized/);
    assert.equal(invalidated,1);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
