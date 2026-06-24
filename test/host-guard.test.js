import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isInternalHost } from '../src/host-guard.js';

describe('isInternalHost', () => {
  describe('blocks loopback', () => {
    for (const h of ['127.0.0.1', '127.0.0.2', '127.255.255.255', '::1', '[::1]', 'localhost', 'LOCALHOST', 'foo.localhost']) {
      it(`blocks ${h}`, () => assert.equal(isInternalHost(h), true));
    }
  });

  describe('blocks RFC1918 private ranges', () => {
    const blocked = [
      '10.0.0.1', '10.255.255.255',
      '192.168.1.1', '192.168.0.0',
      '172.16.0.1', '172.20.5.10', '172.31.255.255',
    ];
    for (const h of blocked) {
      it(`blocks ${h}`, () => assert.equal(isInternalHost(h), true));
    }
  });

  describe('allows public 172.x.x.x outside 172.16/12', () => {
    // Real-world public IPs that the old startsWith('172.') guard wrongly blocked
    const allowed = [
      '172.15.0.1',      // just below the private range
      '172.32.0.1',      // just above the private range
      '172.217.16.46',   // Google
      '172.253.115.100', // Google
    ];
    for (const h of allowed) {
      it(`allows ${h}`, () => assert.equal(isInternalHost(h), false));
    }
  });

  describe('blocks link-local (cloud metadata 169.254.169.254)', () => {
    for (const h of ['169.254.169.254', '169.254.0.1', '169.254.255.255']) {
      it(`blocks ${h}`, () => assert.equal(isInternalHost(h), true));
    }
  });

  describe('blocks unspecified and CGNAT', () => {
    for (const h of ['0.0.0.0', '0.1.2.3', '100.64.0.1', '100.127.255.255']) {
      it(`blocks ${h}`, () => assert.equal(isInternalHost(h), true));
    }
  });

  describe('allows public neighbours of CGNAT', () => {
    for (const h of ['100.63.0.1', '100.128.0.1']) {
      it(`allows ${h}`, () => assert.equal(isInternalHost(h), false));
    }
  });

  describe('blocks multicast and reserved', () => {
    for (const h of ['224.0.0.1', '239.255.255.250', '255.255.255.255']) {
      it(`blocks ${h}`, () => assert.equal(isInternalHost(h), true));
    }
  });

  describe('blocks internal-style TLDs', () => {
    for (const h of ['svc.cluster.internal', 'foo.local', 'box.lan']) {
      it(`blocks ${h}`, () => assert.equal(isInternalHost(h), true));
    }
  });

  describe('blocks IPv6 private/link-local', () => {
    for (const h of ['fe80::1', 'FE80::abcd', 'fc00::1', 'fd12:3456:789a::1', '::', '[fe80::1]']) {
      it(`blocks ${h}`, () => assert.equal(isInternalHost(h), true));
    }
  });

  describe('blocks IPv4-mapped IPv6 to private addresses', () => {
    for (const h of ['::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254']) {
      it(`blocks ${h}`, () => assert.equal(isInternalHost(h), true));
    }
  });

  describe('allows public IPv6', () => {
    for (const h of ['2001:4860:4860::8888', '2606:4700:4700::1111']) {
      it(`allows ${h}`, () => assert.equal(isInternalHost(h), false));
    }
  });

  describe('allows ordinary public hosts', () => {
    for (const h of ['example.com', 'www.google.com', 'github.com', '8.8.8.8', '1.1.1.1']) {
      it(`allows ${h}`, () => assert.equal(isInternalHost(h), false));
    }
  });

  describe('blocks empty/invalid input', () => {
    for (const h of ['', null, undefined, 0, {}]) {
      it(`blocks ${JSON.stringify(h)}`, () => assert.equal(isInternalHost(h), true));
    }
  });
});
