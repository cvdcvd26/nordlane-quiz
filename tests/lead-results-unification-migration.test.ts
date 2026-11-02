import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const folder = path.resolve(__dirname, "../drizzle");
async function beforeUnification() {
  const db = new PGlite();
  const journal = JSON.parse(await readFile(path.join(folder, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  for (const entry of journal.entries.filter(entry => entry.idx < 20)) await db.exec(await readFile(path.join(folder, `${entry.tag}.sql`), "utf8"));
  return db;
}
const migration = () => readFile(path.join(folder, "0020_unified_lead_status.sql"), "utf8");

describe("canonical status reconciliation migration", () => {
  it("preserves terminal decisions, historic private snapshots and every reversible before-image atomically", async () => {
    const db = await beforeUnification();
    try {
      const fixtures = [
        { status: "new", next: "new" },
        { status: "in_progress", closure: "signal_working", qualification: "suitable", next: "signal_working" },
        { status: "data_received", closure: "signal_working", qualification: "suitable", next: "signal_working" },
        { status: "completed", closure: "signal_working", qualification: "suitable", next: "signal_working" },
        { status: "rejected", closure: "signal_working", qualification: "suitable", published: true, next: "rejected" },
        { status: "signal_working", closure: "not_suitable", qualification: "unsuitable", next: "signal_working" },
        { status: "data_received", closure: "open", qualification: "suitable", next: "data_received" },
        { status: "new", closure: "open", qualification: "suitable", next: "suitable" },
        { status: "new", closure: "data_received", qualification: "unreviewed", next: "data_received" },
        { status: "new", closure: "candidate_declined", qualification: "suitable", next: "candidate_declined" },
        { status: "new", closure: "no_contact", qualification: "unreviewed", next: "no_contact" },
        { status: "completed", closure: "open", qualification: "unreviewed", next: "completed" },
        { status: "awaiting_reply", closure: "not_suitable", qualification: "unsuitable", next: "rejected" },
      ];
      for (const [i, fixture] of fixtures.entries()) {
        const { rows: [session] } = await db.query<{ id: string }>("insert into visitor_sessions(token_hash) values ($1) returning id", [`migration-${i}`]);
        const { rows: [lead] } = await db.query<{ id: number }>("insert into leads(session_id,status,updated_at,candidate_result_body,candidate_result_published_at) values ($1,$2,'2040-01-01',$3,$4) returning id", [session.id, fixture.status, fixture.published ? "Published refusal" : null, fixture.published ? "2026-10-01" : null]);
        if (fixture.closure) {
          await db.query("insert into lead_results(lead_id,qualification,closure,comment,reason,version,updated_at,closed_at) values ($1,$2,$3,$4,'other',3,'2026-10-03',$5)", [lead.id, fixture.qualification, fixture.closure, `Private original ${i}`, ["open", "data_received"].includes(fixture.closure) ? null : "2026-10-01"]);
          await db.query("insert into lead_result_history(lead_id,previous,next,version) values ($1,'{\"version\":2}', $2,3)", [lead.id, JSON.stringify({ closure: fixture.closure, qualification: fixture.qualification, comment: `Private original ${i}`, version: 3 })]);
        }
      }
      const beforeResults = (await db.query("select * from lead_results order by lead_id")).rows;
      const beforeHistory = (await db.query("select * from lead_result_history order by lead_id")).rows;
      const beforeLeads = (await db.query<{ status: string; updated_at: Date }>("select * from leads order by id")).rows;
      // Explicit transaction exercises the production migrator's all-pending-files transaction behavior.
      await db.transaction(async tx => { await tx.exec(await migration()); });
      const leads = (await db.query<{ status: string; status_changed_at: Date | null; candidate_result_body: string | null; updated_at: Date }>("select * from leads order by id")).rows;
      expect(leads.map(lead => lead.status)).toEqual(fixtures.map(fixture => fixture.next));
      expect(leads.every(lead => lead.status_changed_at === null)).toBe(true);
      expect(leads.map(lead => lead.updated_at)).toEqual(beforeLeads.map(lead => lead.updated_at));
      expect(leads[4].candidate_result_body).toBe("Published refusal");
      expect((await db.query("select * from lead_results order by lead_id")).rows).toEqual(beforeResults);
      expect((await db.query("select * from lead_result_history order by lead_id")).rows).toEqual(beforeHistory);
      const archived = (await db.query<{ previous_status: string; next_status: string; previous_result: { comment: string } | null }>("select * from lead_status_migration_archive order by lead_id")).rows;
      expect(archived.map(row => row.previous_status)).toEqual(fixtures.map(fixture => fixture.status));
      expect(archived.map(row => row.next_status)).toEqual(fixtures.map(fixture => fixture.next));
      expect(archived[0].previous_result).toBeNull();
      expect(archived[1].previous_result?.comment).toBe("Private original 1");
      await expect(db.query("update leads set status='new' where candidate_result_body is not null")).rejects.toThrow();
      await expect(db.query("update leads set status='invalid'")).rejects.toThrow();
      await db.query("delete from leads where id=2");
      expect((await db.query("select * from lead_status_migration_archive where lead_id=2")).rows).toEqual([]);
    } finally { await db.close(); }
  });

  it("rolls back enum, reconciled data and archive together if deployment migration fails", async () => {
    const db = await beforeUnification();
    try {
      const { rows: [session] } = await db.query<{ id: string }>("insert into visitor_sessions(token_hash) values ('rollback') returning id");
      await db.query("insert into leads(session_id,status) values ($1,'new')", [session.id]);
      await expect(db.transaction(async tx => { await tx.exec(await migration()); throw new Error("rollback migration"); })).rejects.toThrow("rollback migration");
      expect((await db.query("select status from leads")).rows).toEqual([{ status: "new" }]);
      expect((await db.query("select to_regclass('lead_status_migration_archive') as archive")).rows).toEqual([{ archive: null }]);
      await expect(db.query("update leads set status='suitable'")).rejects.toThrow();
    } finally { await db.close(); }
  });
});
