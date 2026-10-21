import { describe, expect, it } from "vitest";
import { TargetValidationError, isBlockedIp, validateUrlSyntax } from "./ssrf";

describe("SSRF target validation", () => {
  it("accepts HTTP and HTTPS hostnames", () => {
    expect(validateUrlSyntax("https://example.com/health").protocol).toBe(
      "https:"
    );
    expect(validateUrlSyntax("http://example.com").hostname).toBe(
      "example.com"
    );
  });

  it.each([
    "http://localhost",
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://192.168.1.1",
    "http://169.254.169.254",
    "http://[::1]",
    "http://[fc00::1]",
    "http://[::ffff:127.0.0.1]",
  ])("blocks %s", target => {
    expect(() => validateUrlSyntax(target)).toThrow(TargetValidationError);
  });

  it("rejects non HTTP protocols and explicit ports", () => {
    expect(() => validateUrlSyntax("ftp://example.com")).toThrowError(/HTTP/);
    expect(() => validateUrlSyntax("https://example.com:8443")).toThrowError(
      /ports/
    );
  });

  it("recognizes reserved addresses", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });

  it.each([
    "http://[2002:7f00:1::]",
    "http://[2001:0000:4136:e378:8000:63bf:3fff:fdd2]",
    "http://[::7f00:1]",
    "http://[100::1]",
  ])("blocks IPv6 tunneling/reserved target %s", target => {
    expect(() => validateUrlSyntax(target)).toThrow(TargetValidationError);
  });

  it.each([
    "2002:7f00:1::",
    "2001:0000:4136:e378:8000:63bf:3fff:fdd2",
    "::7f00:1",
    "100::1",
    "::ffff:192.168.0.1",
  ])("isBlockedIp rejects tunneled or reserved IPv6 %s", address => {
    expect(isBlockedIp(address)).toBe(true);
  });

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "2001:db8::1"])(
    "isBlockedIp allows public or unrelated IPv6 %s",
    address => {
      expect(isBlockedIp(address)).toBe(false);
    }
  );
});
