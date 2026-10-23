#!/usr/bin/env node
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PASSWORD_ITERATIONS = 100_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_ALPHABET =
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function generatePassword(length = 16) {
  let password = "";
  while (password.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= 252) continue;
      password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
      if (password.length === length) break;
    }
  }
  return password;
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256");
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

const mapPath = arg("map");
if (!mapPath) fail("缺少 --map 参数（账号映射 JSON）");

const outputPath = resolve(arg("out", ".wrangler/backups/bind-legacy-accounts.sql"));
const credentialsPath = resolve(
  arg("credentials", ".wrangler/backups/legacy-account-credentials.txt"),
);

let parsed;
try {
  parsed = JSON.parse(readFileSync(resolve(mapPath), "utf8"));
} catch (cause) {
  fail(`读取映射文件失败：${cause.message}`);
}

const accounts = Array.isArray(parsed) ? parsed : parsed.accounts;
if (!Array.isArray(accounts) || accounts.length === 0)
  fail("映射文件必须是非空数组，或包含 accounts 数组");

const seenIds = new Set();
const seenEmails = new Set();
const prepared = accounts.map((account, index) => {
  const userId = String(account.userId ?? "").trim();
  const nickname = String(account.nickname ?? "").trim();
  const email = String(account.email ?? "").trim();
  const normalizedEmail = normalizeEmail(email);

  if (!/^usr_[A-Za-z0-9-]+$/.test(userId))
    fail(`第 ${index + 1} 条 userId 格式不正确：${userId || "(空)"}`);
  if (!EMAIL_PATTERN.test(email))
    fail(`第 ${index + 1} 条邮箱格式不正确：${email || "(空)"}`);
  if (seenIds.has(userId)) fail(`userId 重复：${userId}`);
  if (seenEmails.has(normalizedEmail)) fail(`邮箱重复：${normalizedEmail}`);
  seenIds.add(userId);
  seenEmails.add(normalizedEmail);

  const password = account.password
    ? String(account.password)
    : generatePassword();
  if (password.length < 8)
    fail(`第 ${index + 1} 条密码少于 8 位：${userId}`);

  return {
    userId,
    nickname,
    email,
    normalizedEmail,
    password,
    passwordHash: hashPassword(password),
  };
});

const rehash = process.argv.includes("--rehash");
const generatedAt = new Date().toISOString();
const statements = prepared.map((account) =>
  rehash
    ? `-- ${account.nickname || account.userId} -> ${account.email}（仅重设密码）
UPDATE users
SET password_hash=${sqlString(account.passwordHash)}
WHERE id=${sqlString(account.userId)}
  AND email_normalized=${sqlString(account.normalizedEmail)};`
    : `-- ${account.nickname || account.userId} -> ${account.email}
UPDATE users
SET email=${sqlString(account.email)},
    email_normalized=${sqlString(account.normalizedEmail)},
    password_hash=${sqlString(account.passwordHash)},
    status='active'
WHERE id=${sqlString(account.userId)}
  AND email_normalized IS NULL;`,
);

const verification = `SELECT id, nickname, email, email_normalized, status,
       CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS has_password
FROM users
WHERE id IN (${prepared.map((account) => sqlString(account.userId)).join(", ")})
ORDER BY created_at;`;

const sql = `-- 旧邀请码账号${rehash ? "重设密码" : "绑定邮箱"}（生成于 ${generatedAt}）
-- 应用前请确认已执行 wrangler d1 export 备份。
${
  rehash
    ? "-- 仅当账号已绑定映射中的邮箱时才更新密码。"
    : "-- 每条 UPDATE 都要求 email_normalized IS NULL，避免覆盖已有邮箱。"
}
${statements.join("\n\n")}

${verification}
`;

const credentials = `# 旧账号${rehash ? "密码重设" : "邮箱绑定"}凭据（生成于 ${generatedAt}）
# 请立即保存到密码管理器，然后删除此文件。
# 格式：userId\tnickname\temail\ttemporary_password
${prepared
  .map(
    (account) =>
      `${account.userId}\t${account.nickname || "-"}\t${account.email}\t${account.password}`,
  )
  .join("\n")}
`;

writeFileSync(outputPath, sql, { mode: 0o600 });
chmodSync(outputPath, 0o600);
writeFileSync(credentialsPath, credentials, { mode: 0o600 });
chmodSync(credentialsPath, 0o600);

console.log(`✓ SQL: ${outputPath}`);
console.log(`✓ 凭据: ${credentialsPath}`);
console.log(`✓ 模式: ${rehash ? "重设密码" : "绑定邮箱"}`);
console.log(`✓ 账号数: ${prepared.length}`);
for (const account of prepared)
  console.log(`  - ${account.nickname || "(无昵称)"} ${account.userId} -> ${account.email}`);
