import { isIPv6 } from "node:net";

function expandIpv4Tail(address: string): string {
  const separator = address.lastIndexOf(":");
  const tail = address.slice(separator + 1);
  if (!tail.includes(".")) return address;

  const octets = tail.split(".").map(Number);
  const high = ((octets[0] << 8) | octets[1]).toString(16);
  const low = ((octets[2] << 8) | octets[3]).toString(16);
  return `${address.slice(0, separator)}:${high}:${low}`;
}

function expandIpv6(address: string): number[] {
  const [head = "", tail = ""] = expandIpv4Tail(address.toLowerCase()).split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  return [...headParts, ...Array.from({ length: missing }, () => "0"), ...tailParts]
    .map((part) => Number.parseInt(part, 16));
}

function mappedIpv4(parts: number[]): string | null {
  if (!parts.slice(0, 5).every((part) => part === 0) || parts[5] !== 0xffff) return null;

  return [parts[6] >> 8, parts[6] & 0xff, parts[7] >> 8, parts[7] & 0xff].join(".");
}

export function networkAddress(address: string): string {
  if (!isIPv6(address)) return address;

  const parts = expandIpv6(address);
  const embeddedIpv4 = mappedIpv4(parts);
  if (embeddedIpv4) return embeddedIpv4;

  return `${parts.slice(0, 4).map((part) => part.toString(16)).join(":")}::/64`;
}