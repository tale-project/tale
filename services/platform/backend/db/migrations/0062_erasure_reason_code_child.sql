-- 0.5 app migration 0062: normalize the GDPR erasure reason code for the
-- Art 17(1)(f) ground to 'child'.
--
-- The reason-code vocabulary lives in core/governance/erasure_constants.ts
-- ('child' — the code the file-request picker, the i18n catalogs, and the
-- docs all use), but the erasure service carried a divergent local copy
-- with 'child_consent': the documented code could never be filed, while
-- raw API callers could store the undocumented one. The service now
-- validates against the constants module; this backfill folds any stored
-- 'child_consent' rows into the one vocabulary so every receipt renders a
-- real label. Idempotent and rolling-safe: reads never validate stored
-- codes, so the previous image keeps serving these rows unchanged.

UPDATE app.gdpr_erasure_requests
SET reason_code = 'child'
WHERE reason_code = 'child_consent';
