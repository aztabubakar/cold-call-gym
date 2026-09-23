import { describe, it, expect } from "vitest";
import { AccessRequestSchema } from "./access-schema";

const valid = {
  name: "Jordan Blake",
  email: "Jordan.Blake@Company.com",
  phone: "+1 (555) 000-0000",
  consent: true,
};

describe("AccessRequestSchema", () => {
  it("accepts a valid submission and normalizes email + phone", () => {
    const result = AccessRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("jordan.blake@company.com");
      expect(result.data.phone).toBe("+15550000000");
      expect(result.data.name).toBe("Jordan Blake");
      expect(result.data.consent).toBe(true);
    }
  });

  it("accepts international phone numbers without assuming a US shape", () => {
    // UK mobile, no leading '+'
    expect(AccessRequestSchema.safeParse({ ...valid, phone: "44 7700 900000" }).success).toBe(true);
    // German number with '+'
    expect(AccessRequestSchema.safeParse({ ...valid, phone: "+49 30 12345678" }).success).toBe(true);
  });

  it("rejects a phone number that is too short to be real", () => {
    const result = AccessRequestSchema.safeParse({ ...valid, phone: "12345" });
    expect(result.success).toBe(false);
  });

  it("rejects a phone number with letters", () => {
    const result = AccessRequestSchema.safeParse({ ...valid, phone: "call-me-maybe" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = AccessRequestSchema.safeParse({ ...valid, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing name", () => {
    const result = AccessRequestSchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a name that is only whitespace", () => {
    const result = AccessRequestSchema.safeParse({ ...valid, name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a name with no letters (symbols/numbers only)", () => {
    const result = AccessRequestSchema.safeParse({ ...valid, name: "12345!!!" });
    expect(result.success).toBe(false);
  });

  it("rejects an oversized name", () => {
    const result = AccessRequestSchema.safeParse({ ...valid, name: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects a missing field entirely", () => {
    const { name: _name, ...withoutName } = valid;
    const result = AccessRequestSchema.safeParse(withoutName);
    expect(result.success).toBe(false);
  });

  it("rejects a malicious/oversized email", () => {
    const result = AccessRequestSchema.safeParse({ ...valid, email: `${"a".repeat(320)}@x.com` });
    expect(result.success).toBe(false);
  });

  it("requires consent to be explicitly true", () => {
    expect(AccessRequestSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
    const { consent: _consent, ...withoutConsent } = valid;
    expect(AccessRequestSchema.safeParse(withoutConsent).success).toBe(false);
  });

  it("parses successfully with a filled-in honeypot (the route, not the schema, drops it silently)", () => {
    const result = AccessRequestSchema.safeParse({ ...valid, website: "http://spam.example" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.website).toBe("http://spam.example");
  });
});
