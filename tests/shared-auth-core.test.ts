/**
 * 统一认证核心测试
 *
 * 覆盖三件最要紧的事：
 * 1. 哈希格式互认——收口时老用户不能被锁在门外
 * 2. 会话令牌/摘要的行为正确
 * 3. Cookie 拼装符合安全基线（HttpOnly / SameSite / Secure）
 */
import { describe, expect, it } from 'vitest';
import {
  buildClearCookie,
  buildCookie,
  generateSessionId,
  generateSessionToken,
  hashPassword,
  isSecureRequest,
  readCookie,
  sha256Hex,
  toBase64,
  toHex,
  verifyPassword,
} from '@shared/core/server/authCore';

/** 生成 hex 盐 + 摘要，用于构造历史格式的哈希 */
async function legacyHexHash(password: string, saltHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: Uint8Array.from(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16))),
      iterations: 100_000,
    },
    key,
    256,
  );
  return toHex(bits);
}

describe('统一认证核心', () => {
  describe('密码哈希', () => {
    it('生成的哈希带统一前缀与迭代次数', async () => {
      const hash = await hashPassword('correct horse');
      expect(hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    });

    it('同一密码两次哈希不同（盐随机）', async () => {
      const a = await hashPassword('same');
      const b = await hashPassword('same');
      expect(a).not.toBe(b);
    });

    it('正确密码校验通过、错误密码不通过', async () => {
      const hash = await hashPassword('secret123');
      await expect(verifyPassword('secret123', hash)).resolves.toBe(true);
      await expect(verifyPassword('secret124', hash)).resolves.toBe(false);
    });

    it('空存储值一律不通过', async () => {
      await expect(verifyPassword('x', null)).resolves.toBe(false);
      await expect(verifyPassword('x', '')).resolves.toBe(false);
    });
  });

  describe('历史哈希格式兼容（迁移不能锁死老用户）', () => {
    it('认 ability/civil 的 pbkdf2-sha256$iter$b64salt$b64hash 格式', async () => {
      const hash = await hashPassword('legacy-a');
      await expect(verifyPassword('legacy-a', hash)).resolves.toBe(true);
    });

    it('认 money-growth 的裸 hex 摘要 + 独立 salt 列', async () => {
      const saltHex = '00112233445566778899aabbccddeeff';
      const digest = await legacyHexHash('legacy-b', saltHex);
      await expect(verifyPassword('legacy-b', digest, saltHex)).resolves.toBe(true);
      await expect(verifyPassword('wrong', digest, saltHex)).resolves.toBe(false);
    });

    it('认 personal_review_system 的 base64 盐:哈希 组合串', async () => {
      const encoder = new TextEncoder();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode('legacy-c'),
        'PBKDF2',
        false,
        ['deriveBits'],
      );
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
        key,
        256,
      );
      const combined = `${toBase64(salt)}:${toBase64(new Uint8Array(bits))}`;
      await expect(verifyPassword('legacy-c', combined)).resolves.toBe(true);
      await expect(verifyPassword('nope', combined)).resolves.toBe(false);
    });

    it('无法识别的格式一律拒绝', async () => {
      await expect(verifyPassword('x', 'garbage')).resolves.toBe(false);
      await expect(verifyPassword('x', 'pbkdf2-sha256$500$abc$def')).resolves.toBe(false);
    });
  });

  describe('会话令牌', () => {
    it('token 是 64 位 hex', () => {
      expect(generateSessionToken()).toMatch(/^[0-9a-f]{64}$/);
    });

    it('两次生成不同', () => {
      expect(generateSessionToken()).not.toBe(generateSessionToken());
    });

    it('会话 id 带 ses_ 前缀', () => {
      expect(generateSessionId()).toMatch(/^ses_[0-9a-f-]{36}$/);
    });

    it('sha256 输出 64 位 hex', async () => {
      await expect(sha256Hex('abc')).resolves.toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('Cookie', () => {
    it('默认带 HttpOnly 与 SameSite=Strict', () => {
      const cookie = buildCookie('app_session', 'abc');
      expect(cookie).toContain('app_session=abc');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/');
    });

    it('https 请求可加 Secure', () => {
      expect(buildCookie('app_session', 'abc', { secure: true })).toContain('Secure');
    });

    it('清除 Cookie 把 Max-Age 设为 0', () => {
      expect(buildClearCookie('app_session')).toContain('Max-Age=0');
    });

    it('从请求里读 Cookie', () => {
      const request = new Request('https://x.test/', {
        headers: { Cookie: 'a=1; app_session=token-value; b=2' },
      });
      expect(readCookie(request, 'app_session')).toBe('token-value');
      expect(readCookie(request, 'missing')).toBeUndefined();
    });

    it('无 Cookie 头时返回 undefined', () => {
      expect(readCookie(new Request('https://x.test/'), 'app_session')).toBeUndefined();
    });

    it('识别 https 与 X-Forwarded-Proto', () => {
      expect(isSecureRequest(new Request('https://x.test/'))).toBe(true);
      expect(isSecureRequest(new Request('http://x.test/'))).toBe(false);
      expect(
        isSecureRequest(
          new Request('http://x.test/', { headers: { 'X-Forwarded-Proto': 'https' } }),
        ),
      ).toBe(true);
    });
  });
});
