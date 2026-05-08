-- Seed data for current schema: users / items / votes

-- Ensure auth columns exist for legacy DBs
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;

-- Users
INSERT INTO users (username, email, full_name, role, password_hash) VALUES
('nguyenvana', 'nguyenvana@example.com', 'Nguyen Van A', 'user', '3a711fa7cc3ae86ab4f6797b14bd3309:7f7b597bb1f407c45eac68a379fcb930e3aed8e09dec9d2e4e30edd67f0ddf9417a2580733e8a06b9c8cfcbadebad76f4f9b82d1dab1265560a8019b9679486b'),
('lethib', 'lethib@example.com', 'Le Thi B', 'user', '3a711fa7cc3ae86ab4f6797b14bd3309:7f7b597bb1f407c45eac68a379fcb930e3aed8e09dec9d2e4e30edd67f0ddf9417a2580733e8a06b9c8cfcbadebad76f4f9b82d1dab1265560a8019b9679486b'),
('tranvanc', 'tranvanc@example.com', 'Tran Van C', 'user', '3a711fa7cc3ae86ab4f6797b14bd3309:7f7b597bb1f407c45eac68a379fcb930e3aed8e09dec9d2e4e30edd67f0ddf9417a2580733e8a06b9c8cfcbadebad76f4f9b82d1dab1265560a8019b9679486b')
ON CONFLICT (username) DO NOTHING;

-- Dedicated admin account
INSERT INTO users (username, email, full_name, role, password_hash) VALUES
('admin_master', 'admin_master@voting.local', 'System Administrator', 'admin', '319a99f8735de116d11470aa24bd7845:1bb34ce14e9de4418bf9aabed6f7bf92ab74b4ad171fe3e598a72c8a4cb8e58da1b0d00691d048b84b3660b8678fb36a820414c45cc652e3cf449e68fef23439')
ON CONFLICT (username) DO UPDATE
SET email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = 'admin',
    password_hash = EXCLUDED.password_hash,
    updated_at = CURRENT_TIMESTAMP;

-- Ensure existing non-admin users have role=user and default password.
UPDATE users
SET role = 'user',
    password_hash = COALESCE(password_hash, '3a711fa7cc3ae86ab4f6797b14bd3309:7f7b597bb1f407c45eac68a379fcb930e3aed8e09dec9d2e4e30edd67f0ddf9417a2580733e8a06b9c8cfcbadebad76f4f9b82d1dab1265560a8019b9679486b'),
    updated_at = CURRENT_TIMESTAMP
WHERE username <> 'admin_master';

-- Items (mapped from old "candidates")
INSERT INTO items (title, description) VALUES
('Ung vien 01', 'Kinh nghiem 10 nam trong nganh cong nghe'),
('Ung vien 02', 'Chuyen gia ve giai phap nang luong sach'),
('Ung vien 03', 'Dai dien khoi sinh vien xuat sac')
ON CONFLICT DO NOTHING;

-- Votes (mapped by username/title; upsert on unique user-item)
INSERT INTO votes (user_id, item_id, vote_value)
SELECT u.id, i.id, 1
FROM users u
JOIN items i ON i.title = 'Ung vien 01'
WHERE u.username IN ('nguyenvana', 'lethib')
ON CONFLICT (user_id, item_id) DO UPDATE
SET vote_value = EXCLUDED.vote_value, updated_at = CURRENT_TIMESTAMP;

INSERT INTO votes (user_id, item_id, vote_value)
SELECT u.id, i.id, 1
FROM users u
JOIN items i ON i.title = 'Ung vien 02'
WHERE u.username = 'tranvanc'
ON CONFLICT (user_id, item_id) DO UPDATE
SET vote_value = EXCLUDED.vote_value, updated_at = CURRENT_TIMESTAMP;

-- Recalculate item scores from votes
UPDATE items it
SET score = COALESCE(v.total_votes, 0)
FROM (
  SELECT item_id, SUM(vote_value)::int AS total_votes
  FROM votes
  GROUP BY item_id
) v
WHERE it.id = v.item_id;
