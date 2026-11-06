-- Read-only audit of CURRENT reusable text, not historical conversations.
-- Run in the Neon SQL editor for the intended application database.
-- Returns counts, stable IDs, flags and fingerprints only; never raw template text.
-- Missing settings use the current source defaults.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';

WITH expected_keys(key) AS (
  VALUES ('autoMessageText'), ('admin.quick_replies.v1')
), stored AS (
  SELECT e.key, s.value, s.updated_at,
    s.key IS NOT NULL AS stored_override,
    md5(s.value::text) AS value_fingerprint
  FROM expected_keys e
  LEFT JOIN app_settings s ON s.key = e.key
), current_templates AS (
  SELECT key, 'auto-message'::text AS template_id, 1::bigint AS position,
    ''::text AS title,
    CASE WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}' ELSE '' END AS body,
    ''::text AS rich_body
  FROM stored
  WHERE key = 'autoMessageText' AND stored_override
  UNION ALL
  SELECT s.key,
    CASE WHEN r.item->>'id' ~ '^[a-zA-Z0-9_-]{1,64}$'
      THEN r.item->>'id' ELSE '[invalid id]' END,
    r.position,
    coalesce(r.item->>'title', ''),
    coalesce(r.item->>'body', ''),
    coalesce(r.item->'bodyRich', 'null'::jsonb)::text
  FROM stored s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(s.value->'replies') = 'array'
      THEN s.value->'replies' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS r(item, position)
  WHERE s.key = 'admin.quick_replies.v1'
), flagged AS (
  SELECT key, template_id, position, length(body) AS body_characters,
    title ~* 'alley[[:space:]_-]*biz(com)?|nordlane' AS old_brand_in_title,
    body ~* 'alley[[:space:]_-]*biz(com)?|nordlane' AS old_brand_in_body,
    rich_body ~* 'alley[[:space:]_-]*biz(com)?|nordlane' AS old_brand_in_rich_body,
    concat_ws(' ', title, body, rich_body) ~*
      '7123509615|0001227235|544149844|Lublin|Dąbrowsk|Dabrowsk|Sikorskiego|59-300'
      AS old_company_reference
  FROM current_templates
)
SELECT s.key, s.stored_override, s.updated_at, s.value_fingerprint,
  CASE WHEN s.key = 'autoMessageText' THEN coalesce((
    SELECT value = 'true'::jsonb FROM app_settings WHERE key = 'autoMessageEnabled'
  ), true) END AS auto_message_enabled,
  count(f.template_id) AS stored_template_count,
  count(f.template_id) FILTER (WHERE
    f.old_brand_in_title OR f.old_brand_in_body OR f.old_brand_in_rich_body
  ) AS old_brand_template_count,
  count(f.template_id) FILTER (WHERE f.old_company_reference) AS old_company_template_count,
  coalesce(jsonb_agg(jsonb_build_object(
    'id', f.template_id,
    'position', f.position,
    'body_characters', f.body_characters,
    'old_brand_in_title', f.old_brand_in_title,
    'old_brand_in_body', f.old_brand_in_body,
    'old_brand_in_rich_body', f.old_brand_in_rich_body,
    'old_company_reference', f.old_company_reference
  ) ORDER BY f.position) FILTER (WHERE
    f.old_brand_in_title OR f.old_brand_in_body OR f.old_brand_in_rich_body OR f.old_company_reference
  ), '[]'::jsonb) AS matching_template_metadata
FROM stored s
LEFT JOIN flagged f ON f.key = s.key
GROUP BY s.key, s.stored_override, s.updated_at, s.value_fingerprint
ORDER BY s.key;

COMMIT;

-- Targeted remediation, if any flags are found:
-- 1. Privately review only the flagged CURRENT templates in the admin UI.
--    A keyword hit is not proof the content should be replaced automatically.
-- 2. Edit only reusable auto-message/quick-reply drafts. Do not change previously
--    sent messages, contracts, submissions, audit history or existing logins.
-- 3. Save quick replies through the existing UI/API revision check; keep plain
--    body and bodyRich in sync. Reload first if another admin changed the revision.
-- 4. For auto-message text, verify the value has not changed since this audit
--    (value_fingerprint or current UI content), then save through Settings.
-- 5. Run this audit again and preview the saved draft before sending any message.
-- No UPDATE, DELETE, migrations, credentials or sends are part of this script.
