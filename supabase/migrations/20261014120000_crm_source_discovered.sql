-- Weekly lead discovery. Requires 20261013121000_crm_cli_rpcs.sql.
--
-- The /lead-discover command finds races that fit the ICP, researches a
-- sourced contact for each, and imports them through crm_import with no
-- owner, so they land in the Unclaimed pool for reps. This adds the
-- 'discovered' source so those deals are told apart from leads.csv,
-- the reps' sheet, manual adds and inbound signups.
--
--   * crm_deals.source accepts 'discovered'.
--   * crm_import accepts p_source = 'discovered'. Otherwise identical to
--     20261012124000; import_row (20261013121000) is unchanged.

-- ─────────────────────────────────────────────────────────────────────
-- 1. crm_deals.source
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.crm_deals DROP CONSTRAINT crm_deals_source_check;
ALTER TABLE public.crm_deals ADD CONSTRAINT crm_deals_source_check
  CHECK (source IN ('leads_csv', 'sales_sheet', 'manual', 'inbound', 'renewal', 'discovered'));

-- ─────────────────────────────────────────────────────────────────────
-- 2. crm_import — 'discovered' added to the source allowlist.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_import(
  p_rows    JSONB,
  p_source  TEXT,
  p_mode    TEXT    DEFAULT 'insert_only',
  p_dry_run BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_report JSONB := '[]'::jsonb;
  v_row    JSONB;
  v_result JSONB;
  v_errors INT := 0;
BEGIN
  PERFORM crm_internal.require_admin();
  IF p_source NOT IN ('leads_csv', 'sales_sheet', 'discovered') THEN
    RAISE EXCEPTION 'Source must be leads_csv, sales_sheet or discovered.' USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('insert_only', 'fill_blanks') THEN
    RAISE EXCEPTION 'Mode must be insert_only or fill_blanks.' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 2000 THEN
    RAISE EXCEPTION 'Rows must be an array of at most 2000.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
      BEGIN
        v_result := crm_internal.import_row(v_row, p_source, p_mode);
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors + 1;
        v_result := jsonb_build_object('slug', v_row->>'slug', 'action', 'error',
                                       'error', SQLERRM, 'warnings', '[]'::jsonb);
      END;
      v_report := v_report || jsonb_build_array(v_result);
    END LOOP;

    -- Undo everything above while keeping the report (PL/pgSQL keeps
    -- variable values when a block's changes are rolled back).
    IF p_dry_run THEN
      RAISE EXCEPTION 'dry run' USING ERRCODE = 'CRDRY';
    END IF;
    IF v_errors > 0 THEN
      RAISE EXCEPTION 'errors' USING ERRCODE = 'CRERR';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'CRDRY' THEN
      NULL;
    WHEN SQLSTATE 'CRERR' THEN
      RAISE EXCEPTION '% row(s) failed, so nothing was imported. Run a dry run to see why.', v_errors
        USING ERRCODE = '22023';
  END;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'source',  p_source,
    'mode',    p_mode,
    'counts',  (SELECT coalesce(jsonb_object_agg(a.action, a.n), '{}'::jsonb)
                  FROM (SELECT x->>'action' AS action, count(*) AS n
                          FROM jsonb_array_elements(v_report) x GROUP BY 1) a),
    'rows',    v_report
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_import(JSONB, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_import(JSONB, TEXT, TEXT, BOOLEAN) TO authenticated;
