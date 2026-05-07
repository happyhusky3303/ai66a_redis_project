-- Seed data for current schema: users / items / votes

-- Users
INSERT INTO users (username, email) VALUES
('nguyenvana', 'nguyenvana@example.com'),
('lethib', 'lethib@example.com'),
('tranvanc', 'tranvanc@example.com')
ON CONFLICT (username) DO NOTHING;

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
