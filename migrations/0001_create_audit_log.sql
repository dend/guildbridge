CREATE TABLE audit_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	ts INTEGER NOT NULL,
	tool TEXT NOT NULL,
	user_id TEXT NOT NULL,
	username TEXT NOT NULL,
	outcome TEXT NOT NULL,
	duration_ms INTEGER NOT NULL,
	guild_id TEXT,
	channel_id TEXT,
	message_id TEXT,
	error TEXT
);
CREATE INDEX idx_audit_ts ON audit_log(ts DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id, ts DESC);
CREATE INDEX idx_audit_tool ON audit_log(tool, ts DESC);
