import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";

it("upgrades an existing database without losing messages and preserves their chronological order", async () => {
  const db = new PGlite();
  try {
    for (const file of ["0000_init.sql", "0001_visitor_contacts.sql", "0002_review.sql", "0003_testimonials.sql"])
      await db.exec(await readFile(path.join(__dirname, "../drizzle", file), "utf8"));
    const { rows: [session] } = await db.query<{ id: string }>("insert into visitor_sessions(token_hash) values ('migration-test') returning id");
    const { rows: [conv] } = await db.query<{ id: string }>("insert into conversations(session_id) values ($1) returning id", [session.id]);
    await db.query("insert into messages(conversation_id, sender, body, client_message_id, created_at) values ($1, 'visitor', 'newer', 'newer', '2026-10-15'), ($1, 'admin', 'older', 'older', '2026-10-14')", [conv.id]);
    await db.exec(await readFile(path.join(__dirname, "../drizzle/0004_message_sequence.sql"), "utf8"));
    const { rows } = await db.query<{ body: string }>("select body from messages order by sequence");
    expect(rows.map(r => r.body)).toEqual(["older", "newer"]);
    await db.query("insert into messages(conversation_id, sender, body, client_message_id) values ($1, 'visitor', 'latest', 'latest')", [conv.id]);
    const { rows: latest } = await db.query<{ body: string }>("select body from messages order by sequence desc limit 1");
    expect(latest[0].body).toBe("latest");
  } finally { await db.close(); }
});

it("keeps legacy visitor reviews while allowing multiple manually managed reviews", async () => {
  const db = new PGlite();
  try {
    for (const file of ["0000_init.sql", "0001_visitor_contacts.sql", "0002_review.sql", "0003_testimonials.sql", "0004_message_sequence.sql"])
      await db.exec(await readFile(path.join(__dirname, "../drizzle", file), "utf8"));
    const { rows: [session] } = await db.query<{ id: string }>("insert into visitor_sessions(token_hash) values ('legacy-review') returning id");
    const { rows: [legacy] } = await db.query<{ id: string }>("insert into testimonials(session_id, name, rating, body, status) values ($1, 'Anna', 5, 'Existing visitor review', 'published') returning id", [session.id]);
    await db.exec(await readFile(path.join(__dirname, "../drizzle/0005_admin_testimonials.sql"), "utf8"));
    const { rows: [preserved] } = await db.query<{ session_id: string; city: string | null; age: number | null; body: string; status: string }>("select * from testimonials where id=$1", [legacy.id]);
    expect(preserved).toMatchObject({ session_id: session.id, city: null, age: null, body: "Existing visitor review", status: "published" });
    await db.query("insert into testimonials(name, city, age, rating, body) values ('Maria', 'Lublin', 29, 5, 'First manual review'), ('Ewa', null, null, 4, 'Second manual review')");
    await expect(db.query("insert into testimonials(name, age, rating, body) values ('Invalid', 121, 5, 'Invalid age')")).rejects.toThrow();
    await db.query("delete from visitor_sessions where id=$1", [session.id]);
    const { rows } = await db.query<{ name: string }>("select name from testimonials order by name");
    expect(rows.map((row) => row.name)).toEqual(["Ewa", "Maria"]);
  } finally { await db.close(); }
});

it("preserves Aneta for existing leads and assigns a registered HR manager to new leads", async () => {
  const db = new PGlite();
  try {
    for (const file of ["0000_init.sql", "0001_visitor_contacts.sql", "0002_review.sql", "0003_testimonials.sql", "0004_message_sequence.sql", "0005_admin_testimonials.sql"])
      await db.exec(await readFile(path.join(__dirname, "../drizzle", file), "utf8"));
    const { rows: [session] } = await db.query<{ id: string }>("insert into visitor_sessions(token_hash) values ('existing-manager-lead') returning id");
    const { rows: [lead] } = await db.query<{ id: number }>("insert into leads(session_id) values ($1) returning id", [session.id]);
    await db.exec(await readFile(path.join(__dirname, "../drizzle/0006_lead_managers.sql"), "utf8"));
    const { rows: [preserved] } = await db.query<{ manager_id: string }>("select manager_id from leads where id=$1", [lead.id]);
    expect(preserved.manager_id).toBe("aneta");
    const { rows: [nextSession] } = await db.query<{ id: string }>("insert into visitor_sessions(token_hash) values ('new-manager-lead') returning id");
    const { rows: [assigned] } = await db.query<{ manager_id: string }>("insert into leads(session_id) values ($1) returning manager_id", [nextSession.id]);
    expect(["aneta", "maja", "hanna", "agnieszka"]).toContain(assigned.manager_id);
    await expect(db.query("update leads set manager_id=null where id=$1", [lead.id])).rejects.toThrow();
    await expect(db.query("update leads set manager_id='unknown' where id=$1", [lead.id])).rejects.toThrow();
  } finally { await db.close(); }
});

it("keeps existing rejected leads private when adding candidate result publication", async () => {
  const db = new PGlite();
  try {
    for (const file of ["0000_init.sql", "0001_visitor_contacts.sql", "0002_review.sql", "0003_testimonials.sql", "0004_message_sequence.sql", "0005_admin_testimonials.sql", "0006_lead_managers.sql"])
      await db.exec(await readFile(path.join(__dirname, "../drizzle", file), "utf8"));
    const { rows: [session] } = await db.query<{ id: string }>("insert into visitor_sessions(token_hash) values ('existing-rejected-candidate') returning id");
    const { rows: [lead] } = await db.query<{ id: number }>("insert into leads(session_id, status) values ($1, 'rejected') returning id", [session.id]);
    await db.exec(await readFile(path.join(__dirname, "../drizzle/0007_candidate_outcome.sql"), "utf8"));
    const { rows: [preserved] } = await db.query<{ status: string; candidate_result_body: string | null; candidate_result_published_at: string | null }>("select status, candidate_result_body, candidate_result_published_at from leads where id=$1", [lead.id]);
    expect(preserved).toEqual({ status: "rejected", candidate_result_body: null, candidate_result_published_at: null });
    await expect(db.query("update leads set candidate_result_published_at=now() where id=$1", [lead.id])).rejects.toThrow();
    await expect(db.query("update leads set candidate_result_body='Private draft' where id=$1", [lead.id])).rejects.toThrow();
    await db.query("update leads set candidate_result_body='Published result', candidate_result_published_at=now() where id=$1", [lead.id]);
    await expect(db.query("update leads set status='new' where id=$1", [lead.id])).rejects.toThrow();
    await db.query("update leads set status='new', candidate_result_body=null, candidate_result_published_at=null where id=$1", [lead.id]);
  } finally { await db.close(); }
});
