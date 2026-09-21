-- 申论 21 天闯关：客观题作答留痕。
--
-- 只存「本次作答」（[{id,key}]，key 是选项在题库里的原始下标）。
-- 对错、正确答案与解析都不落库——它们由 src/essay/bank.ts 现算，
-- 这样题库改文案时不会出现「库里存着旧解析」的两处漂移；星级仍单独存在 stars 里（只增不减）。
-- 老数据（只有自评清单那批）此列为默认的 '[]'，读取时视为「客观题还没作答」，星级不受影响。
ALTER TABLE essay_training_progress ADD COLUMN quiz_json TEXT NOT NULL DEFAULT '[]';
