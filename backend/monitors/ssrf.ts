import dns from "node:dns/promises";
import net from "node:net";
import ipaddr from "ipaddr.js";

export class TargetValidationError extends Error {
  constructor(
    public readonly code: "INVALID_TARGET" | "BLOCKED_TARGET",
    message: string,
    /**
     * True when the URL is well-formed but its hostname no longer resolves.
     * A monitor created weeks ago can outlive its own DNS record: that is an
     * outage to report, not a typo to refuse.
     */
    public readonly resolutionFailed = false
  ) {
    super(message);
    this.name = "TargetValidationError";
  }
}

const blockedRanges: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["100::", 64],
  // Teredo/6to4 tunnel IPv4 payloads inside public-looking IPv6 addresses
  ["2001::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

function matchesBlockedRange(address: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  if (
    address.kind() === "ipv6" &&
    (address as ipaddr.IPv6).isIPv4MappedAddress()
  )
    return true;
  return blockedRanges.some(([rangeAddress, prefix]) => {
    const range = ipaddr.parse(rangeAddress);
    return range.kind() === address.kind() && address.match(range, prefix);
  });
}

export function isBlockedIp(address: string): boolean {
  if (!net.isIP(address)) return false;
  try {
    return matchesBlockedRange(ipaddr.parse(address));
  } catch {
    return true;
  }
}

export function validateUrlSyntax(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TargetValidationError("INVALID_TARGET", "URL is invalid");
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new TargetValidationError(
      "INVALID_TARGET",
      "Only HTTP and HTTPS targets are accepted"
    );
  }
  if (url.username || url.password || url.port) {
    throw new TargetValidationError(
      "INVALID_TARGET",
      "Credentials and explicit ports are not accepted"
    );
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new TargetValidationError(
      "BLOCKED_TARGET",
      "Local targets are blocked"
    );
  }
  if (hostname.length === 0 || hostname.length > 253) {
    throw new TargetValidationError(
      "INVALID_TARGET",
      "Target hostname is invalid"
    );
  }
  if (net.isIP(hostname) && isBlockedIp(hostname)) {
    throw new TargetValidationError(
      "BLOCKED_TARGET",
      "Private or reserved targets are blocked"
    );
  }
  return url;
}

export function validateResolvedAddresses(addresses: string[]): void {
  if (addresses.length === 0) {
    throw new TargetValidationError(
      "INVALID_TARGET",
      "Target did not resolve",
      true
    );
  }
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new TargetValidationError(
        "BLOCKED_TARGET",
        "Resolved target is private or reserved"
      );
    }
  }
}

export async function resolveAndValidateTarget(rawUrl: string): Promise<URL> {
  const url = validateUrlSyntax(rawUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) return url;

  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new TargetValidationError(
      "INVALID_TARGET",
      "Target DNS lookup failed",
      true
    );
  }
  validateResolvedAddresses(records.map(record => record.address));
  return url;
}
