// tests/nameMatcher.test.ts

import { matchNames, normalizeName } from "./nameMatcher";

describe("normalizeName", () => {
  it("lowercases and strips honorifics", () => {
    expect(normalizeName("Dr. Ravi Kumar")).toBe("ravi kumar");
    expect(normalizeName("Mr. S Suresh")).toBe("s suresh");
    expect(normalizeName("Prof. Anita Sharma")).toBe("anita sharma");
  });

  it("collapses extra whitespace", () => {
    expect(normalizeName("  Ravi   Kumar  ")).toBe("ravi kumar");
  });

  it("strips punctuation", () => {
    expect(normalizeName("O'Brien, John")).toBe("obrien john");
  });
});

describe("matchNames", () => {
  it("returns exact match", () => {
    const result = matchNames("Ravi Kumar", "Ravi Kumar");
    expect(result.isMatch).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.method).toBe("exact");
  });

  it("handles reordered name parts (normalized)", () => {
    const result = matchNames("Kumar Ravi", "Ravi Kumar");
    expect(result.isMatch).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("handles minor typos with fuzzy match", () => {
    const result = matchNames("Priya Subramaniam", "Priya Subramanian");
    expect(result.isMatch).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.75);
  });

  it("returns no match for completely different names", () => {
    const result = matchNames("John Smith", "Ravi Kumar");
    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBeLessThan(0.75);
  });

  it("returns no match when extracted is null", () => {
    const result = matchNames(null, "Ravi Kumar");
    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.method).toBe("none");
  });

  it("strips honorifics before comparing", () => {
    const result = matchNames("Dr. Arun Prasad", "Arun Prasad");
    expect(result.isMatch).toBe(true);
  });
});
