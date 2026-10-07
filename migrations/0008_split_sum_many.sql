PRAGMA foreign_keys = ON;

-- 「多项求和」拆成两关：多项求和（固定 3 项）＋ 多项连加（4 项以上）。
--
-- 旧 sum-many 的中/高难度局本来出的就是 4~5 项连加，正好属于新关「多项连加」。
-- 但用户当时正是靠这些记录通过「高难度局」才解锁的乘法与平方：如果把记录直接改到新关，
-- 旧的多项求和局会变成未通关、多项连加也拿不到解锁依据（连加关要求先通关多项求和），
-- 乘法随即被重新锁死。所以这里**复制**一份到新关，原记录留在多项求和
-- （能连加 5 项的人当然能算 3 项，两关都算已通关是合理的）：
--   sum-many-four-v2 / sum-many-five-v2 → 多项连加（新增记录）
--   sum-many-three-v2 及后续新模板       → 多项求和（原样不动）
-- 通关判定是 quiz_attempts JOIN generated_questions 按 topic_id 聚合的，
-- 所以题目与作答必须一起复制（作答的 id 与幂等键都要换新，否则会撞唯一约束）。
-- 代价是这几局的题量在两关里各计一次（个人统计略偏高），换来的是进度零丢失。

INSERT INTO generated_questions (
  id, user_id, topic_id, difficulty, template_id, template_version, fingerprint, seed,
  stem, options_json, answer_index, explanation, params_json, created_at, expires_at,
  material_json, run_id
)
SELECT 'sumlong-' || id, user_id, 'sum-long', difficulty, template_id, template_version,
       fingerprint, seed, stem, options_json, answer_index, explanation, params_json,
       created_at, expires_at, material_json, run_id
  FROM generated_questions
 WHERE topic_id = 'sum-many'
   AND (template_id LIKE 'sum-many-four%' OR template_id LIKE 'sum-many-five%');

INSERT INTO quiz_attempts (
  id, user_id, question_id, selected_index, correct, duration_ms, mastered,
  idempotency_key, created_at, run_id
)
SELECT 'sumlong-' || a.id, a.user_id, 'sumlong-' || a.question_id, a.selected_index,
       a.correct, a.duration_ms, a.mastered, 'sumlong-' || a.idempotency_key,
       a.created_at, a.run_id
  FROM quiz_attempts a
  JOIN generated_questions q ON q.id = a.question_id
 WHERE q.topic_id = 'sum-many'
   AND (q.template_id LIKE 'sum-many-four%' OR q.template_id LIKE 'sum-many-five%');
