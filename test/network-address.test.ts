import { describe, expect, it } from "vitest";
import { networkAddress } from "../worker/network-address";

describe("networkAddress", () => {
  it("preserves IPv4 addresses", () => {
    expect(networkAddress("203.0.113.42")).toBe("203.0.113.42");
  });

  it("groups full IPv6 addresses by their /64 prefix", () => {
    expect(networkAddress("2001:db8:1234:5678:abcd:ef01:2345:6789"))
      .toBe("2001:db8:1234:5678::/64");
  });

  it("canonicalizes compressed IPv6 addresses", () => {
    expect(networkAddress("2001:0DB8:1234:5678::1"))
      .toBe("2001:db8:1234:5678::/64");
  });

  it("uses the embedded IPv4 address for IPv4-mapped IPv6", () => {
    expect(networkAddress("::ffff:192.0.2.128")).toBe("192.0.2.128");
  });

  it("preserves missing or invalid address fallbacks", () => {
    expect(networkAddress("local")).toBe("local");
  });
});