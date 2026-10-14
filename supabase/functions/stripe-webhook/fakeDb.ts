// In-memory stand-in for the service-role Supabase client, for
// handlers.test.ts. It implements just the PostgREST builder calls the
// handlers make — from().select/insert/update, eq/is/not filters,
// select() after update for RETURNING, maybeSingle() — and evaluates
// them against plain arrays, so the tests exercise the real predicates
// (an UPDATE ... WHERE paid_at IS NULL that matches nothing returns no
// rows) rather than canned responses.
//
// Not a general PostgREST emulator: unsupported calls throw, so a
// handler that starts using one fails loudly here instead of passing
// against a fake that ignored it.

export type Row = Record<string, unknown>;
export type Op = "select" | "insert" | "update";

export interface DbError {
  message: string;
  code?: string;
}

export interface Result {
  data: Row | Row[] | null;
  error: DbError | null;
}

/** One executed query, for assertions about what a handler touched. */
export interface QueryRecord {
  table: string;
  op: Op;
  values?: Row;
  filters: string[];
}

interface Failure {
  table: string;
  op: Op;
  error: DbError;
  remaining: number;
}

export class FakeDb {
  readonly tables: Record<string, Row[]>;
  readonly queries: QueryRecord[] = [];
  private failures: Failure[] = [];

  /**
   * Runs after a query has read or written the tables but before its
   * result reaches the caller, so a test can slip a second delivery in
   * between a handler's read and its next write.
   */
  afterQuery?: (query: QueryRecord, result: Result) => void | Promise<void>;

  constructor(tables: Record<string, Row[]>) {
    this.tables = structuredClone(tables);
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  /** Make the next `times` queries of this kind return `error` (default: all). */
  fail(table: string, op: Op, error: DbError = { message: "connection reset" }, times = Infinity): void {
    this.failures.push({ table, op, error, remaining: times });
  }

  /** @internal */
  takeFailure(table: string, op: Op): DbError | null {
    const f = this.failures.find((x) => x.table === table && x.op === op && x.remaining > 0);
    if (!f) return null;
    f.remaining -= 1;
    return f.error;
  }
}

class FakeQuery implements PromiseLike<Result> {
  private op: Op = "select";
  private values?: Row;
  private columns?: string;
  private returning = false;
  private single = false;
  private readonly predicates: Array<(row: Row) => boolean> = [];
  private readonly filterDescs: string[] = [];

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select(columns = "*"): this {
    if (this.op !== "select") this.returning = true;
    this.columns = columns;
    return this;
  }

  insert(values: Row): this {
    if (Array.isArray(values)) throw new Error("fakeDb: bulk insert not supported");
    this.op = "insert";
    this.values = values;
    return this;
  }

  update(values: Row): this {
    this.op = "update";
    this.values = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.where(`${column}=eq.${String(value)}`, (row) => row[column] === value);
  }

  is(column: string, value: null): this {
    if (value !== null) throw new Error("fakeDb: is() supports only null");
    return this.where(`${column}=is.null`, (row) => row[column] == null);
  }

  not(column: string, operator: string, value: null): this {
    if (operator !== "is" || value !== null) throw new Error("fakeDb: not() supports only ('is', null)");
    return this.where(`${column}=not.is.null`, (row) => row[column] != null);
  }

  maybeSingle(): this {
    this.single = true;
    return this;
  }

  then<T1 = Result, T2 = never>(
    onFulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.run().then(onFulfilled, onRejected);
  }

  private where(desc: string, predicate: (row: Row) => boolean): this {
    this.filterDescs.push(desc);
    this.predicates.push(predicate);
    return this;
  }

  private async run(): Promise<Result> {
    const record: QueryRecord = {
      table: this.table,
      op: this.op,
      ...(this.values ? { values: structuredClone(this.values) } : {}),
      filters: [...this.filterDescs],
    };
    this.db.queries.push(record);
    const result = this.execute();
    await this.db.afterQuery?.(record, result);
    return result;
  }

  private execute(): Result {
    const error = this.db.takeFailure(this.table, this.op);
    if (error) return { data: null, error };

    const rows = this.db.rows(this.table);
    const matches = () => rows.filter((row) => this.predicates.every((p) => p(row)));

    if (this.op === "insert") {
      rows.push(structuredClone(this.values!));
      return { data: null, error: null };
    }

    if (this.op === "update") {
      const hit = matches();
      for (const row of hit) Object.assign(row, structuredClone(this.values!));
      return { data: this.returning ? hit.map((r) => this.project(r)) : null, error: null };
    }

    const hit = matches().map((r) => this.project(r));
    if (!this.single) return { data: hit, error: null };
    if (hit.length > 1) {
      return { data: null, error: { message: "multiple rows returned", code: "PGRST116" } };
    }
    return { data: hit[0] ?? null, error: null };
  }

  private project(row: Row): Row {
    if (!this.columns || this.columns === "*") return structuredClone(row);
    const out: Row = {};
    for (const col of this.columns.split(",").map((c) => c.trim())) {
      out[col] = structuredClone(row[col] ?? null);
    }
    return out;
  }
}
