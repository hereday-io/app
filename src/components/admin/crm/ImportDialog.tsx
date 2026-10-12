import { useMemo, useState } from 'react';
import { AlertTriangle, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useCrmAction, useStaff } from '@/hooks/crm/useCrm';
import { parseCsv } from '@/lib/crm/csv';
import { duplicateSlugs, isExampleRow, mapLeadsCsvRow, mapSheetRow, resolveOwner } from '@/lib/crm/leadImport';
import type { ImportMode, ImportReport, ImportRow, ImportSource } from '@/lib/crm/types';
import { OUTCOME_LABELS, STAGE_LABELS } from '@/lib/crm/vocab';
import { cn } from '@/lib/utils';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NOBODY = '__nobody__';

const ACTION_TONE: Record<string, string> = {
  created: 'text-emerald-700',
  exists: 'text-muted-foreground',
  filled: 'text-sky-700',
  conflict: 'text-amber-700',
  error: 'text-destructive',
};

/**
 * One-time move from outreach/leads.csv and the reps' sheet. The file is
 * parsed here in the browser; only the mapped rows go to crm_import. A
 * dry run executes the real import and rolls it back, so its report is
 * exactly what Import will do.
 */
const ImportDialog = ({ open, onOpenChange }: ImportDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: staff = [] } = useStaff();
  const run = useCrmAction<ImportReport>('crm_import');

  const [source, setSource] = useState<ImportSource>('leads_csv');
  const [mode, setMode] = useState<ImportMode>('insert_only');
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<Array<Record<string, string>>>([]);
  const [ownerMap, setOwnerMap] = useState<Record<string, string>>({});
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});
  const [report, setReport] = useState<ImportReport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const reset = () => {
    setFileName(null);
    setRawRows([]);
    setOwnerMap({});
    setAccountNames({});
    setReport(null);
    setParseError(null);
  };

  const owners = useMemo(
    () =>
      source === 'sales_sheet'
        ? [...new Set(rawRows.map((r) => (r.owner ?? '').trim()).filter(Boolean))]
        : [],
    [rawRows, source],
  );

  const rows: ImportRow[] = useMemo(() => {
    if (!user) return [];
    const mapped =
      source === 'leads_csv'
        ? rawRows.map((r, i) => mapLeadsCsvRow(r, i, user.id))
        : rawRows.map((r) => {
            const name = (r.owner ?? '').trim();
            const chosen = ownerMap[name];
            const ownerId = chosen === undefined ? resolveOwner(name, staff) : chosen === NOBODY ? null : chosen;
            return mapSheetRow(r, ownerId);
          });
    return mapped.map((r) => {
      const typed = accountNames[r.slug];
      if (typed === undefined) return r;
      const name = typed.trim();
      return {
        ...r,
        account: name ? { name, org_type: r.account?.org_type ?? null, org_description: r.account?.org_description ?? null } : null,
      };
    });
  }, [rawRows, source, user, ownerMap, staff, accountNames]);

  const dupes = useMemo(() => duplicateSlugs(rows), [rows]);
  const resultBySlug = useMemo(() => new Map((report?.rows ?? []).map((r) => [r.slug, r])), [report]);

  const onFile = async (file: File | undefined) => {
    reset();
    if (!file) return;
    try {
      const { header, rows: parsed } = parseCsv(await file.text());
      const needed = source === 'leads_csv' ? ['slug', 'race', 'status'] : ['owner', 'slug', 'race', 'status'];
      const missing = needed.filter((h) => !header.includes(h));
      if (missing.length) {
        setParseError(`This doesn't look like ${source === 'leads_csv' ? 'leads.csv' : 'the lead tracker'}: missing ${missing.join(', ')}.`);
        return;
      }
      setFileName(file.name);
      setRawRows(source === 'sales_sheet' ? parsed.filter((r) => !isExampleRow(r)) : parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  };

  const call = (dryRun: boolean) => {
    const payload = rows.map(({ warnings: _w, owner_name: _o, ...r }) => r);
    run.mutate(
      { p_rows: payload, p_source: source, p_mode: mode, p_dry_run: dryRun },
      {
        onSuccess: (r) => {
          setReport(r);
          if (!dryRun) {
            const c = r.counts;
            toast({
              title: 'Imported',
              description: `${c.created ?? 0} created, ${c.filled ?? 0} filled, ${c.exists ?? 0} already there, ${c.conflict ?? 0} conflicts.`,
            });
            onOpenChange(false);
            reset();
          }
        },
        onError: (e) => toast({ title: dryRun ? 'Dry run failed' : 'Import failed', description: e.message, variant: 'destructive' }),
      },
    );
  };

  const counts = report?.counts ?? {};
  const canApply = !!report?.dry_run && !counts.error && !dupes.length && rows.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (run.isPending) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Import leads</DialogTitle>
          <DialogDescription>
            Bring in outreach/leads.csv or the reps' lead tracker (File → Download → CSV). Run a dry run first:
            it does the whole import and then undoes it, so you see exactly what will happen.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.4fr] gap-4">
          <div className="space-y-1.5">
            <Label>Source</Label>
            <RadioGroup
              value={source}
              onValueChange={(v) => {
                setSource(v as ImportSource);
                reset();
              }}
              className="gap-1.5"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="leads_csv" id="src-leads" />
                <Label htmlFor="src-leads" className="font-normal">outreach/leads.csv</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="sales_sheet" id="src-sheet" />
                <Label htmlFor="src-sheet" className="font-normal">Reps' lead tracker</Label>
              </div>
            </RadioGroup>
          </div>
          <div className="space-y-1.5">
            <Label>Existing slugs</Label>
            <RadioGroup value={mode} onValueChange={(v) => { setMode(v as ImportMode); setReport(null); }} className="gap-1.5">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="insert_only" id="mode-insert" />
                <Label htmlFor="mode-insert" className="font-normal">Skip them</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="fill_blanks" id="mode-fill" />
                <Label htmlFor="mode-fill" className="font-normal">Fill in blanks only</Label>
              </div>
            </RadioGroup>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-file">CSV file</Label>
            <Input id="import-file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
            {fileName && (
              <p className="text-[12px] text-muted-foreground">
                {fileName}: {rows.length} row{rows.length === 1 ? '' : 's'}
              </p>
            )}
            {parseError && <p className="text-[12px] text-destructive">{parseError}</p>}
          </div>
        </div>

        {owners.length > 0 && (
          <div className="space-y-2">
            <Label>Who owns what</Label>
            <p className="text-[12px] text-muted-foreground">
              Reps need to have signed in to Hereday with their hereday.io Google account once to appear here.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {owners.map((name) => {
                const value = ownerMap[name] ?? resolveOwner(name, staff) ?? NOBODY;
                return (
                  <div key={name} className="flex items-center gap-2 text-[13px]">
                    <span className="w-28 truncate">{name}</span>
                    <Select
                      value={value}
                      onValueChange={(v) => {
                        setOwnerMap((m) => ({ ...m, [name]: v }));
                        setReport(null);
                      }}
                    >
                      <SelectTrigger className="h-8 text-[12.5px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NOBODY}>Nobody (pool)</SelectItem>
                        {staff.map((s) => (
                          <SelectItem key={s.user_id} value={s.user_id}>
                            {s.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {dupes.length > 0 && (
          <p className="text-[13px] text-destructive flex gap-1.5">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            These slugs appear more than once in the file: {dupes.join(', ')}. Fix the file first.
          </p>
        )}

        {rows.length > 0 && (
          <>
            {report && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                <span className="font-medium">{report.dry_run ? 'Dry run:' : 'Imported:'}</span>
                {(['created', 'filled', 'exists', 'conflict', 'error'] as const).map((k) =>
                  counts[k] ? (
                    <span key={k} className={ACTION_TONE[k]}>
                      {counts[k]} {k === 'exists' ? 'already there' : k}
                    </span>
                  ) : null,
                )}
              </div>
            )}
            <div className="overflow-x-auto border border-border rounded-md">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border bg-muted/30">
                    <th className="py-1.5 px-2 font-medium">Race</th>
                    <th className="py-1.5 px-2 font-medium">Becomes</th>
                    <th className="py-1.5 px-2 font-medium">Organization</th>
                    <th className="py-1.5 px-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const res = resultBySlug.get(r.slug);
                    const warnings = [...r.warnings, ...(res?.warnings ?? [])];
                    return (
                      <tr key={r.slug} className="border-b border-border/50 last:border-0 align-top">
                        <td className="py-1.5 px-2 min-w-[180px]">
                          <span className="text-foreground">{r.race_name || '(no name)'}</span>
                          <span className="block font-mono text-[11px] text-muted-foreground">{r.slug}</span>
                        </td>
                        <td className="py-1.5 px-2 whitespace-nowrap">
                          {STAGE_LABELS[r.stage]}
                          {r.outcome ? ` · ${OUTCOME_LABELS[r.outcome]}` : ''}
                          <span className="block text-[11px] text-muted-foreground">
                            {r.owner_id ? staff.find((s) => s.user_id === r.owner_id)?.display_name ?? 'you' : 'pool'}
                            {r.contact?.email ? ' · email' : ''}
                            {r.contact?.phone ? ' · phone' : ''}
                            {r.hereday_link ? ' · map' : ''}
                            {r.tracker_claims.length ? ` · says ${r.tracker_claims.join('/')}` : ''}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 min-w-[200px]">
                          <Input
                            className="h-7 text-[12.5px]"
                            value={accountNames[r.slug] ?? r.account?.name ?? ''}
                            placeholder={r.account?.org_description ? 'Add a name' : '—'}
                            title={r.account?.org_description ?? ''}
                            onChange={(e) => {
                              setAccountNames((m) => ({ ...m, [r.slug]: e.target.value }));
                              setReport(null);
                            }}
                          />
                        </td>
                        <td className="py-1.5 px-2 min-w-[220px]">
                          {res ? (
                            <span className={cn('font-medium', ACTION_TONE[res.action])}>
                              {res.action === 'conflict'
                                ? `Conflict: same race as ${res.conflict_with} (${res.conflict_owner})`
                                : res.action === 'error'
                                  ? `Error: ${res.error}`
                                  : res.action === 'exists'
                                    ? 'Already imported'
                                    : res.action}
                              {res.event_link === 'linked' ? ' · map linked' : ''}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {warnings.map((w) => (
                            <span key={w} className="block text-[11.5px] text-amber-700">
                              {w}
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => call(true)} disabled={!rows.length || !!dupes.length || run.isPending}>
            {run.isPending && !report ? 'Running…' : report ? 'Dry run again' : 'Dry run'}
          </Button>
          <Button onClick={() => call(false)} disabled={!canApply || run.isPending} className="gap-1.5">
            <Upload className="h-4 w-4" />
            {run.isPending && report ? 'Importing…' : `Import ${(counts.created ?? 0) + (counts.filled ?? 0)} deal(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportDialog;
