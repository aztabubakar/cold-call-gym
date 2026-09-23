import { describe, it, expect } from "vitest";
import { ContactSalesInquirySchema } from "./contact-sales-schema";

const VALID = {
  name: "Jordan Blake",
  workEmail: "jordan@example.com",
  company: "Example Co",
  jobTitle: "VP of Sales",
  teamSize: "5-10",
  phone: "+1 555 000 0000",
  expectedUsage: "20 hours/month",
  message: "We'd like to expand access for our team.",
};

describe("ContactSalesInquirySchema", () => {
  it("accepts a fully filled-in, valid inquiry", () => {
    expect(ContactSalesInquirySchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts an inquiry with only the required fields", () => {
    const result = ContactSalesInquirySchema.safeParse({
      name: "Jordan Blake",
      workEmail: "jordan@example.com",
      company: "Example Co",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = ContactSalesInquirySchema.safeParse({ ...VALID, workEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing name", () => {
    const { name: _name, ...rest } = VALID;
    expect(ContactSalesInquirySchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a blank (whitespace-only) name", () => {
    const result = ContactSalesInquirySchema.safeParse({ ...VALID, name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a missing work email", () => {
    const { workEmail: _workEmail, ...rest } = VALID;
    expect(ContactSalesInquirySchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a missing company", () => {
    const { company: _company, ...rest } = VALID;
    expect(ContactSalesInquirySchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an oversized name field", () => {
    const result = ContactSalesInquirySchema.safeParse({ ...VALID, name: "a".repeat(500) });
    expect(result.success).toBe(false);
  });

  it("rejects an oversized message field", () => {
    const result = ContactSalesInquirySchema.safeParse({ ...VALID, message: "a".repeat(10_000) });
    expect(result.success).toBe(false);
  });

  it("accepts an empty honeypot field", () => {
    expect(ContactSalesInquirySchema.safeParse({ ...VALID, website: "" }).success).toBe(true);
  });

  it("still parses successfully when the honeypot is filled in — the route (not the schema) is what silently no-ops a bot submission, so a validation error here would give the trap away", () => {
    const result = ContactSalesInquirySchema.safeParse({ ...VALID, website: "http://spam.example" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.website).toBe("http://spam.example");
    }
  });
});
