CREATE TABLE Users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Candidates (
    candidate_id SERIAL PRIMARY KEY,
    candidate_name VARCHAR(100) NOT NULL,
    biography TEXT,
    current_score INT DEFAULT 0
);

CREATE TABLE Votes (
    vote_id SERIAL PRIMARY KEY,
    user_id INT REFERENCES Users(user_id) ON DELETE CASCADE,
    candidate_id INT REFERENCES Candidates(candidate_id) ON DELETE CASCADE,
    num_of_votes INT DEFAULT 1,
    voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)