-- Default admin (password: admin123)
INSERT OR IGNORE INTO admins (username, password_hash, email) VALUES 
  ('admin', 'admin123', 'admin@example.com');

-- Default board
INSERT OR IGNORE INTO boards (id, name, slug, description, color) VALUES 
  (1, 'Product Feedback', 'product-feedback', 'Share your ideas and feature requests to help us improve our product.', '#6366f1');

-- Default statuses for board 1
INSERT OR IGNORE INTO statuses (id, board_id, name, color, sort_order, is_default) VALUES 
  (1, 1, 'Under Review', '#f59e0b', 0, 1),
  (2, 1, 'Planned', '#3b82f6', 1, 0),
  (3, 1, 'In Progress', '#8b5cf6', 2, 0),
  (4, 1, 'Complete', '#10b981', 3, 0),
  (5, 1, 'Closed', '#6b7280', 4, 0);

-- Default tags
INSERT OR IGNORE INTO tags (id, name, color, board_id) VALUES 
  (1, 'Bug', '#ef4444', 1),
  (2, 'Feature', '#6366f1', 1),
  (3, 'Improvement', '#f59e0b', 1),
  (4, 'Design', '#ec4899', 1),
  (5, 'Performance', '#10b981', 1);

-- Sample posts
INSERT OR IGNORE INTO posts (id, board_id, status_id, title, content, author_name, author_email, vote_count, comment_count, is_pinned) VALUES 
  (1, 1, 2, 'Dark mode support', 'It would be great to have a dark mode option. My eyes get tired at night when using the app.', 'Sarah Connor', 'sarah@example.com', 42, 5, 1),
  (2, 1, 3, 'Export data to CSV', 'Allow users to export their data to CSV format for offline analysis and reporting.', 'John Doe', 'john@example.com', 38, 3, 0),
  (3, 1, 1, 'Mobile app for iOS and Android', 'A native mobile app would make it much easier to access on the go. Currently the mobile web experience is not great.', 'Mike Johnson', 'mike@example.com', 56, 8, 0),
  (4, 1, 4, 'Two-factor authentication', 'Please add 2FA support for better account security.', 'Alice Smith', 'alice@example.com', 29, 2, 0),
  (5, 1, 1, 'Bulk actions for managing items', 'Allow selecting multiple items and performing bulk actions like delete, archive, or change status.', 'Bob Wilson', 'bob@example.com', 21, 4, 0),
  (6, 1, 2, 'API webhooks', 'Add webhook support so we can integrate with third-party services and automate workflows.', 'Carol Brown', 'carol@example.com', 34, 1, 0),
  (7, 1, 1, 'Better search functionality', 'The current search is very basic. Would love filters, sorting, and full-text search across all content.', 'David Lee', 'david@example.com', 18, 0, 0),
  (8, 1, 5, 'Custom email notifications', 'More granular control over which notifications we receive and how often.', 'Emma Davis', 'emma@example.com', 15, 2, 0);

-- Post tags
INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES 
  (1, 4), (1, 3),
  (2, 2), (2, 3),
  (3, 2),
  (4, 2),
  (5, 3),
  (6, 2),
  (7, 3), (7, 5),
  (8, 3);

-- Sample comments
INSERT OR IGNORE INTO comments (id, post_id, author_name, author_email, content, is_admin) VALUES 
  (1, 1, 'Admin', 'admin@example.com', 'Great suggestion! We are planning to add dark mode in Q2. Stay tuned!', 1),
  (2, 1, 'Tom Green', 'tom@example.com', 'This is my most wanted feature! Please prioritize this.', 0),
  (3, 1, 'Lisa White', 'lisa@example.com', 'Would love this too. Even a simple toggle would be great.', 0),
  (4, 3, 'Admin', 'admin@example.com', 'We are currently evaluating frameworks for our mobile app. This is high on our roadmap!', 1),
  (5, 3, 'Mike Johnson', 'mike@example.com', 'Thanks for the update! Looking forward to it.', 0),
  (6, 2, 'Admin', 'admin@example.com', 'This is now in progress! Expected release in the next sprint.', 1);

-- Votes
INSERT OR IGNORE INTO votes (post_id, voter_name, voter_email, voter_ip) VALUES 
  (1, 'User1', 'u1@ex.com', '1.1.1.1'),
  (1, 'User2', 'u2@ex.com', '1.1.1.2'),
  (1, 'User3', 'u3@ex.com', '1.1.1.3'),
  (3, 'User4', 'u4@ex.com', '1.1.1.4'),
  (3, 'User5', 'u5@ex.com', '1.1.1.5'),
  (2, 'User6', 'u6@ex.com', '1.1.1.6');

-- Sample changelog
INSERT OR IGNORE INTO changelog (id, title, content, tags, published, published_at) VALUES 
  (1, 'Two-Factor Authentication is here!', 'We''re excited to announce that 2FA is now available for all accounts. You can enable it in your security settings.\n\n## What''s included\n- TOTP authenticator app support\n- Backup codes\n- Recovery options\n\nThis was one of your most requested features and we''re happy to deliver it!', 'security,feature', 1, CURRENT_TIMESTAMP),
  (2, 'Performance improvements & bug fixes', 'This release includes significant performance improvements across the board:\n\n- 40% faster page load times\n- Reduced memory usage\n- Fixed search indexing issues\n- Various UI bug fixes\n\nThank you for all your feedback!', 'performance,bug-fix', 1, CURRENT_TIMESTAMP);
