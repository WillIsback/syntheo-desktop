import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ProviderCredentialError,
  verifyProviderCredentials,
  providerCredentialIdentity,
} from "./index.ts";

const credential = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "synthetic-key",
};

test("accepts an authenticated model response, without sending keys in URLs", async () => {
  const requests = [];
  await verifyProviderCredentials(credential, async (url, init) => {
    requests.push({ url, init });
    return Response.json({ data: [] });
  });
  assert.equal(requests[0].url, "https://api.openai.com/v1/models");
  assert.equal(requests[0].init.headers.Authorization, "Bearer synthetic-key");
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests.length, 1);
  assert.ok(
    !providerCredentialIdentity(credential).includes(credential.apiKey),
  );
  assert.notEqual(
    providerCredentialIdentity(credential),
    providerCredentialIdentity({ ...credential, apiKey: "other" }),
  );
});

for (const [status, message] of [
  [401, /rejected/],
  [403, /permissions/],
  [429, /rate limiting/],
  [500, /Couldn’t verify/],
  [404, /Couldn’t verify/],
]) {
  test(`does not save on HTTP ${status}, or expose response secrets`, async () => {
    await assert.rejects(
      verifyProviderCredentials(
        credential,
        async () => new Response("secret-key-echo", { status }),
      ),
      (error) => {
        assert.match(error.message, message);
        assert.ok(!error.message.includes("secret-key-echo"));
        assert.ok(error instanceof ProviderCredentialError);
        assert.equal(error.retryable, status !== 401 && status !== 403);
        return true;
      },
    );
  });
}

for (const body of [
  { error: "invalid key", data: [] },
  { valid: false },
  "<html>success</html>",
  null,
]) {
  test(`does not treat an arbitrary 200 response as verification: ${JSON.stringify(body)}`, async () => {
    await assert.rejects(
      verifyProviderCredentials(credential, async () => Response.json(body)),
    );
  });
}

test("on-prem STT validates configuration without probing a model catalog", async () => {
  const fetcher = async () => {
    assert.fail("On-prem STT must not send model-list or control-key requests");
  };
  for (const baseUrl of [
    "http://127.0.0.1:8000/v1",
    "http://192.168.1.87:8000/v1",
    "http://100.101.102.103:9000",
    "http://dgx.local:8000/v1",
    "https://stt.example/v1",
  ]) {
    await verifyProviderCredentials(
      { ...credential, type: "stt", provider: "openai", baseUrl, apiKey: "" },
      fetcher,
    );
  }
});

test("on-prem STT still rejects unsafe URLs and malformed keys before saving", async () => {
  for (const update of [
    { baseUrl: "not-a-url" },
    { baseUrl: "http://stt.example/v1" },
    { baseUrl: "https://user:password@stt.example/v1" },
    { baseUrl: "http://8.8.8.8/v1" },
    { baseUrl: "https://stt.example/v1?key=secret" },
    { apiKey: "bad\nkey" },
  ]) {
    await assert.rejects(
      verifyProviderCredentials(
        { ...credential, type: "stt", provider: "openai", ...update },
        async () => assert.fail("Invalid configuration must not send requests"),
      ),
      ProviderCredentialError,
    );
  }
});

test("cancellation does not validate a key", async () => {
  const controller = new AbortController();
  await assert.rejects(
    verifyProviderCredentials(
      credential,
      async () => {
        controller.abort();
        return Response.json({ data: [] });
      },
      controller.signal,
    ),
    /Couldn’t verify/,
  );
});

test("network failures are not mislabeled as invalid credentials", async () => {
  await assert.rejects(
    verifyProviderCredentials(credential, async () => {
      throw Error("secret-key");
    }),
    /Couldn’t verify this key. Check your connection/,
  );
});

test("rejects malformed credentials and unsafe endpoints before a request", async () => {
  for (const update of [
    { apiKey: "a\nb" },
    { baseUrl: "not-a-url" },
    { baseUrl: "http://remote.test" },
    { baseUrl: "https://u:p@remote.test" },
    { baseUrl: "https://remote.test/?token=test" },
  ]) {
    await assert.rejects(
      verifyProviderCredentials({ ...credential, ...update }, () =>
        assert.fail("Unexpected network request"),
      ),
      (error) => {
        assert.ok(error instanceof ProviderCredentialError);
        assert.equal(error.retryable, false);
        return true;
      },
    );
  }
});

test("reuses recent proof only for the same credential and endpoint", async () => {
  let requests = 0;
  const fetcher = async () => {
    requests++;
    return Response.json({ data: [] });
  };
  await verifyProviderCredentials(credential, fetcher);
  await verifyProviderCredentials(credential, fetcher);
  assert.equal(requests, 1);
  await verifyProviderCredentials(
    { ...credential, apiKey: "replacement" },
    fetcher,
  );
  assert.equal(requests, 2);
  await verifyProviderCredentials(
    { ...credential, baseUrl: credential.baseUrl + "/new" },
    fetcher,
  );
  assert.equal(requests, 3);
});

test("never caches a failed verification as accepted", async () => {
  let rejected = true;
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return rejected
      ? new Response(null, { status: 401 })
      : Response.json({ data: [] });
  };
  await assert.rejects(
    verifyProviderCredentials(credential, fetcher),
    /rejected/,
  );
  rejected = false;
  await verifyProviderCredentials(credential, fetcher);
  assert.equal(calls, 2);
});

test("native streaming providers validate input without requiring a model catalog", async () => {
  const fetcher = async () => {
    throw new Error("No documented credential probe");
  };
  for (const provider of ["openai", "nvidia"]) {
    await verifyProviderCredentials(
      { ...credential, type: "stt", provider },
      fetcher,
    );
  }
  await verifyProviderCredentials(
    {
      ...credential,
      type: "stt",
      provider: "nvidia",
      baseUrl: "http://localhost:9000",
      apiKey: "",
    },
    fetcher,
  );
});

test("custom_llm_without_key_lists_models", async () => {
  const requests = [];
  await verifyProviderCredentials(
    {
      type: "llm",
      provider: "custom",
      baseUrl: "http://192.168.1.87:30000/v1",
      apiKey: "",
    },
    async (url, init) => {
      requests.push({ url, init });
      return Response.json({ data: [{ id: "m" }] });
    },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://192.168.1.87:30000/v1/models");
  assert.equal(requests[0].init.headers.Authorization, undefined);
});

test("custom_llm_skips_control_key_probe", async () => {
  const requests = [];
  await verifyProviderCredentials(
    {
      type: "llm",
      provider: "custom",
      baseUrl: "https://spark-787d-1.tail6cba9f.ts.net/v1",
      apiKey: "vllm-key",
    },
    async (url, init) => {
      requests.push({ url, init });
      return Response.json({ data: [{ id: "m" }] });
    },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.headers.Authorization, "Bearer vllm-key");
});
