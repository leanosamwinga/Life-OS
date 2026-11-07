-- FAKE breached-password fixture for local development and tests ONLY.
-- Each row is the SHA-1 (upper-case hex) of an obviously made-up test password, split into the
-- 5-character k-anonymity prefix and 35-character suffix. Production loads the real Pwned
-- Passwords dataset into public.auth_breached_hashes instead (docs/SPEC-QUESTIONS.md, Q-BREACH).
-- Test passwords (all rejected as breached):
--   'password'
--   '123456789012345'
--   'passwordpassword'
--   'correct horse battery staple'
--   'breached-password-for-tests'
--   'this password was in a breach'
--   'qwertyuiopasdfgh'
--   'letmeinletmeinletmein'
--   'aaaaaaaaaaaaaaa'
--   'iloveyou12345678'
--   'football-football'
--   'sunshine sunshine'
--   'monkey monkey monkey'
--   'welcome to life os'
--   'admin admin admin'
insert into public.auth_breached_hashes (prefix, suffix, breach_count) values
  ('5BAA6', '1E4C9B93F3F0682250B6CF8331B7EE68FD8', 1),
  ('65CC4', 'C0B6CF9C56E2A2D801DF1B99DC933DB9991', 2),
  ('476E2', '51CC54B60534F68D0F614FCC67950151353', 3),
  ('ABF7A', 'AD6438836DBE526AA231ABDE2D0EEF74D42', 4),
  ('BC3BB', '29668E385A2CF4E4D66ED5C843861A80C6E', 5),
  ('CC7EB', 'B1ABF61F1EE9E716ED1EAE1FC0F53466C03', 6),
  ('10FA3', 'F1D4839660B9C5D55FBCBB93B50D1F82A1A', 7),
  ('96D9B', '03E7AA95A83DBBC53F3211983997419C2C3', 8),
  ('7E13C', '003A8256CD421055563C5DA6571D50713C9', 9),
  ('1A777', '90E9767B92D8FAAD891BD8ADB78520CBFF3', 10),
  ('FFF13', 'ABF7C4FD3A3E3EB9C333E86DDBA3EA4F652', 11),
  ('6489B', 'EA4B1DD8F6A5D708EF85A2A79E4152F645C', 12),
  ('77F1A', 'A1040FD5A4FED768E2DDF128BA2AEE98165', 13),
  ('D502D', '0224D8B458E310D584A42017664F64AA9A4', 14),
  ('ACF2B', '59903824CC49AB1760CC83D99C9B449EA62', 15)
on conflict do nothing;
