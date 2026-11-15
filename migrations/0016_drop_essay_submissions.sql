-- 移除「整篇批改」功能后清理其数据表。
-- essay_submissions 由 0012_essay_submissions.sql 创建，功能下线后不再读写，
-- 且当前无业务数据，直接 DROP（索引 idx_essay_submissions_user_created 随表一并删除）。
-- 0012 作为已应用的迁移历史保留，不删除文件，避免 wrangler 迁移链断裂。

DROP TABLE IF EXISTS essay_submissions;