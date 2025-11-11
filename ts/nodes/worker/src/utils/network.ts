import net from "node:net";

export interface ResolveHostnameOptions {
  logContext?: Record<string, any>;
}

export function isPrivateIP(ip: string) {
  if (!net.isIP(ip)) return false;

  // IPv4 private ranges
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  }

  // IPv6 private prefixes
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // Unique local
  if (ip === "::1") return true; // loopback
  if (ip.startsWith("fe80")) return true; // link-local

  return false;
}