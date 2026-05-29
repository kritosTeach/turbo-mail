const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const db = require('./database');

passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const result = await db.query(
      'SELECT id, username, email, password_hash, role, two_factor_enabled, is_active FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return done(null, false, { message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return done(null, false, { message: 'Account disabled' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return done(null, false, { message: 'Invalid credentials' });
    }

    return done(null, {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      two_factor_enabled: user.two_factor_enabled
    });
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await db.query(
      'SELECT id, username, email, role, two_factor_enabled FROM users WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return done(null, false);
    }
    done(null, result.rows[0]);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;