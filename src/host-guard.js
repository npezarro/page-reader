/**
 * SSRF guard: classify hostnames/IPs as internal (must be blocked) or external.
 * Returns true for loopback, link-local, multicast, private RFC1918 ranges,
 * and common internal TLD suffixes. Returns false for public addresses.
 *
 * Note: this does NOT resolve DNS. A public hostname that resolves to a
 * private IP can still bypass this check (DNS rebinding). Callers needing
 * stronger guarantees should resolve and validate the IP after connect.
 */
export function isInternalHost(host) {
  if (!host || typeof host !== 'string') return true;

  let h = host.toLowerCase();
  // Strip IPv6 brackets
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);

  // Hostname suffixes commonly used for internal services
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.internal') || h.endsWith('.local') || h.endsWith('.lan')) return true;

  // IPv6
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (/^fe[89ab][0-9a-f]:/i.test(h)) return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true; // unique local fc00::/7
    // IPv4-mapped IPv6: ::ffff:a.b.c.d
    const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isInternalHost(mapped[1]);
    return false;
  }

  // IPv4
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = m.slice(1, 3).map(Number);
    if ([a, b, ...m.slice(3).map(Number)].some((n) => n > 255)) return false;
    if (a === 0) return true;                            // 0.0.0.0/8
    if (a === 10) return true;                           // 10.0.0.0/8
    if (a === 127) return true;                          // loopback
    if (a === 169 && b === 254) return true;             // link-local (AWS/GCP metadata 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16.0.0/12
    if (a === 192 && b === 168) return true;             // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT 100.64.0.0/10
    if (a >= 224) return true;                           // multicast + reserved
  }

  return false;
}
