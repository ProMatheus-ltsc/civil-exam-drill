PRAGMA foreign_keys = ON;

-- 「加减与多项求和」拆成四个独立关卡：加法 / 减法 / 多项求和 / 多项求差。
-- 旧的 topic_id='arithmetic' 不再存在，但历史题目与答题记录要保住：按当时的模板名
-- 精确归位到对应的新关卡（模板后缀记录了这一题当时到底在考什么）：
--   arithmetic-subtract-v2  → 减法（当期是两位数的纯减法）
--   arithmetic-sum-many-v2  → 多项求和（当期是 4 项连加）
--   arithmetic-sum-2/3-v2   → 加法（两项或三项纯加法）
--   （其余兜底归到加法）
-- 这样用户的练习统计与「高难度局通关」状态不会凭空消失，乘法与小数速算的前置也不会被重新锁死。
UPDATE generated_questions
   SET topic_id = 'subtraction'
 WHERE topic_id = 'arithmetic' AND template_id LIKE 'arithmetic-subtract%';

UPDATE generated_questions
   SET topic_id = 'sum-many'
 WHERE topic_id = 'arithmetic' AND template_id = 'arithmetic-sum-many-v2';

UPDATE generated_questions
   SET topic_id = 'addition'
 WHERE topic_id = 'arithmetic';
