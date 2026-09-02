#!/usr/bin/env node
/**
 * 生成邀请码的 DB 插入脚本（公考加油站）
 *
 * 邀请码机制：登录输入 inviteCode → 服务端 code_hash = HMAC-SHA256(
 *   inviteCode.toUpperCase(), INVITE_CODE_PEPPER) 并与 invite_codes 表比对（enabled=1）。
 * 本脚本用同样的 pepper 计算 hash，并输出可直接执行的 D1 插入命令。
 *
 * 用法：
 *   node scripts/add-invite.mjs <INVITE_CODE_PEPPER> <邀请码> [备注label]
 *   例：node scripts/add-invite.mjs "你的pepper" GK2026 "家人"
 *
 * 输出两条命令（二选一执行）：
 *   1) wrangler d1 execute（推荐，本地已装 wrangler + 已配置 token/account 环境变量）
 *   2) Cloudflare 控制台 D1 控制台手动粘贴 SQL
 */
import { createHmac } from "node:crypto";

const pepper = process.argv[2];
const code = process.argv[3];
const label = process.argv[4] ?? "";

if (!pepper || !code) {
  console.error(
    "用法: node scripts/add-invite.mjs <INVITE_CODE_PEPPER> <邀请码> [备注]",
  );
  process.exit(2);
}

const codeHash = createHmac("sha256", pepper)
  .update(code.trim().toUpperCase())
  .digest("hex");

const sql = label
  ? `INSERT INTO invite_codes(code_hash,label,enabled) VALUES ('${codeHash}','${label.replaceAll("'", "''")}',1);`
  : `INSERT INTO invite_codes(code_hash,enabled) VALUES ('${codeHash}',1);`;

console.log(`邀请码: ${code.trim().toUpperCase()} ｜ 备注: ${label || "(无)"}`);
console.log(`code_hash: ${codeHash}`);
console.log("\n方法 1 — wrangler d1 execute（本地执行）:");
console.log(
  `npx wrangler d1 execute civil-exam-drill-db --remote --command "${sql}"`,
);
console.log("\n方法 2 — 或到 Cloudflare D1 控制台直接执行:");
console.log(sql);
console.log(
  "\n⚠️ 前提：Pages 项目已配置 INVITE_CODE_PEPPER（与上面传入的 pepper 完全一致），否则登录校验 hash 不匹配。",
);
