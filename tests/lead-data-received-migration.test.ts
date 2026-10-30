import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";

it("adds received-data support without changing legacy decisions and requires open results to have no closing date", async () => {
  const db = new PGlite();
  try {
    const journal = JSON.parse(await readFile(path.join(__dirname, "../drizzle/meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries.filter(entry => entry.idx < 14)) {
      await db.exec(await readFile(path.join(__dirname, `../drizzle/${entry.tag}.sql`), "utf8"));
    }
    const { rows: sessions } = await db.query<{ id: string }>("insert into visitor_sessions(token_hash) values ('legacy-open'), ('legacy-success') returning id");
    const { rows: leads } = await db.query<{ id: number }>("insert into leads(session_id) values ($1), ($2) returning id", sessions.map(session => session.id));
    await db.query("insert into lead_results(lead_id, qualification, closure, comment, closed_at) values ($1, 'unreviewed', 'open', 'Legacy open', null), ($2, 'suitable', 'signal_working', 'Legacy success', '2026-10-29T12:00:00Z')", leads.map(lead => lead.id));
    const before = await db.query("select * from lead_results order by lead_id");
    await db.exec(await readFile(path.join(__dirname, "../drizzle/0014_lead_data_received.sql"), "utf8"));
    expect((await db.query("select * from lead_results order by lead_id")).rows).toEqual(before.rows);
    await db.query("update lead_results set closure='data_received' where lead_id=$1", [leads[0].id]);
    await expect(db.query("update lead_results set closed_at=now() where lead_id=$1", [leads[0].id])).rejects.toThrow();
    await expect(db.query("update lead_results set closure='data_received' where lead_id=$1", [leads[1].id])).rejects.toThrow();
    await db.query("update lead_results set closure='data_received', closed_at=null where lead_id=$1", [leads[1].id]);
    await expect(db.query("update lead_results set closure='unknown' where lead_id=$1", [leads[0].id])).rejects.toThrow();
  } finally { await db.close(); }
});
