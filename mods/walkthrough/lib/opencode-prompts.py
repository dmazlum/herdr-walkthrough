import json, os, sqlite3, sys

# Prompts que se escribieron en sesiones de opencode de un repositorio desde un momento.
# Uso: python3 opencode-prompts.py <repo-top> <since-ms>

db = os.path.expanduser("~/.local/share/opencode/opencode.db")
top, since = sys.argv[1], int(sys.argv[2])
try:
    con = sqlite3.connect("file:" + db + "?mode=ro", uri=True)
    rows = con.execute(
        "select m.session_id, m.time_created, m.data from session_message m "
        "join session_v2 s on s.id = m.session_id "
        "where m.type = 'user' and (s.directory = ? or s.directory like ?) and m.time_created >= ? "
        "order by m.time_created",
        (top, top + "/%", since),
    ).fetchall()
except Exception:
    print("[]")
    sys.exit(0)
out = []
for sid, at, data in rows:
    try:
        text = (json.loads(data or "{}").get("text") or "").strip()
    except Exception:
        continue
    if text:
        out.append({"at": int(at or 0), "text": text, "session": sid})
print(json.dumps(out))
