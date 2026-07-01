import {
  parseJsonBody,
  responseBodyAsText,
} from "../../../src/shared/runtime";

describe("shared runtime helpers", () => {
  it("parses json strings and preserves objects", () => {
    expect(parseJsonBody<{ ok: boolean }>("{\"ok\":true}")?.ok).toBe(true);
    expect(parseJsonBody<{ ok: boolean }>({ ok: true })?.ok).toBe(true);
  });

  it("normalizes response bodies to text", () => {
    expect(responseBodyAsText({ hello: "world" })).toContain("hello");
    expect(responseBodyAsText("plain text")).toBe("plain text");
  });
});
