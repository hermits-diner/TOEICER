# Copies a set in the app database as a "내 자료" (origin mine) set, for the tour video's editor scene: making one
# for real needs the AI (paste or PDF conversion), which the recording machine does not have.
# usage: seed-mine.py <db> <title> [part of the source set's title; default: the first set]
import json, sqlite3, sys

db, title = sys.argv[1], sys.argv[2]
like = f"%{sys.argv[3]}%" if len(sys.argv) > 3 else "%"
c = sqlite3.connect(db)
cols = lambda t: [r[1] for r in c.execute(f"pragma table_info({t})") if r[1] != "id"]


def copy(table, row_id, **override):
    cs = cols(table)
    vals = dict(zip(cs, c.execute(f"select {','.join(cs)} from {table} where id=?", (row_id,)).fetchone()))
    vals.update(override)
    return c.execute(f"insert into {table}({','.join(vals)}) values({','.join('?' * len(vals))})", list(vals.values())).lastrowid


mine = c.execute("select id from source where adapter='mine'").fetchone()[0]
src = c.execute("select id from test where title like ? order by id limit 1", (like,)).fetchone()[0]
extra = {"content_hash": None} if "content_hash" in cols("test") else {}
tid = copy("test", src, source_id=mine, title=title, **extra)
for (pid,) in c.execute("select id from passage where test_id=? order by ord", (src,)).fetchall():
    np = copy("passage", pid, test_id=tid)
    for (gid,) in c.execute("select id from question_group where passage_id=?", (pid,)).fetchall():
        ng = copy("question_group", gid, passage_id=np)
        for (qid,) in c.execute("select id from question where group_id=?", (gid,)).fetchall():
            copy("question", qid, group_id=ng)
row = c.execute("select json from test_source where test_id=?", (src,)).fetchone()
if row:
    j = json.loads(row[0])
    j["title"] = title
    c.execute("insert into test_source(test_id,json) values(?,?)", (tid, json.dumps(j, ensure_ascii=False)))
c.commit()
print("seeded test", tid)
