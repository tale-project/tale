-- Persist the first required sign-in. Legacy rows intentionally retain their
-- stored deadline because their original sign-in time is unknowable.
ALTER TABLE app.two_factor_grace
  ADD COLUMN first_required_sign_in_at_ms bigint;
