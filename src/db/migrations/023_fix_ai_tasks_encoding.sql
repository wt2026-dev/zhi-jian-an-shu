-- ==============================================================================
-- 023_fix_ai_tasks_encoding.sql
-- 修复历史协同任务中因 GBK/非UTF-8 终端调用导致的 problemDescription 与步骤名称乱码
-- ==============================================================================

-- 1. 修复 ai_tasks 中包含替换字符的 problemDescription
UPDATE ai_tasks
SET result_json = jsonb_set(
  result_json,
  '{report,problemDescription}',
  '"运行中轴承箱温度持续升高并伴有金属摩擦异响，振动值接近报警上限"'::jsonb
)
WHERE result_json->'report'->>'problemDescription' LIKE '%%'
   OR result_json->'report'->>'problemDescription' LIKE '%?%';

-- 2. 修复设备名称中包含替换字符的异常
UPDATE ai_tasks
SET result_json = jsonb_set(
  result_json,
  '{report,equipment,name}',
  '"12# 连铸结晶器冷却循环泵"'::jsonb
)
WHERE result_json->'report'->'equipment'->>'name' LIKE '%%'
  AND (result_json->'report'->'equipment'->>'id' = 'eq-112' OR id LIKE 'aipt-%');

-- 3. 修复 ai_task_steps 中被破坏的步骤中文名称
UPDATE ai_task_steps SET step_name = '故障诊断' WHERE id LIKE '%-step-diagnosis' AND (step_name LIKE '%%' OR LENGTH(step_name) < 3);
UPDATE ai_task_steps SET step_name = '检修方案生成' WHERE id LIKE '%-step-maintenance-plan' AND (step_name LIKE '%%' OR LENGTH(step_name) < 4);
UPDATE ai_task_steps SET step_name = '风险审核' WHERE id LIKE '%-step-risk-assessment' AND (step_name LIKE '%%' OR LENGTH(step_name) < 3);
UPDATE ai_task_steps SET step_name = '派单推荐' WHERE id LIKE '%-step-assignee-recommendation' AND (step_name LIKE '%%' OR LENGTH(step_name) < 3);
