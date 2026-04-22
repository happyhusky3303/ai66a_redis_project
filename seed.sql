-- Chèn Users mẫu
INSERT INTO Users (username, password_hash) VALUES 
('nguyenvana', '$2b$12$ExAmPlEhAsH1'),
('lethib', '$2b$12$ExAmPlEhAsH2'),
('tranvanc', '$2b$12$ExAmPlEhAsH3');

-- Chèn Candidates mẫu
INSERT INTO Candidates (candidate_name, biography) VALUES 
('Ứng viên 01', 'Kinh nghiệm 10 năm trong ngành công nghệ'),
('Ứng viên 02', 'Chuyên gia về giải pháp năng lượng sạch'),
('Ứng viên 03', 'Đại diện khối sinh viên xuất sắc');

-- Chèn Votes mẫu
INSERT INTO Votes (user_id, candidate_id, num_of_votes) VALUES 
(1, 1, 1),
(2, 1, 1),
(3, 2, 1);

-- Cập nhật score tương ứng sau khi vote
UPDATE Candidates SET current_score = 2 WHERE candidate_id = 1;
UPDATE Candidates SET current_score = 1 WHERE candidate_id = 2;