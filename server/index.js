require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const session = require('express-session');
const { createServer } = require('http');
const { Server } = require('socket.io');
const passport = require('./config/passport');
const logger = require('./utils/logger');
const { runMigrations, initializeAdmin } = require('./config/database');

const app = express();
const httpServer = createServer(app);

// WebSocket for real-time logs
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Store io on app for route access
app.set('io', io);

// Middleware
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'turbomailer-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    user: req.user ? req.user.username : 'anonymous'
  });
  next();
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/smtp', require('./routes/smtp'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/recipients', require('./routes/recipients'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api', require('./routes/api'));
app.use('/track', require('./routes/tracking'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend for all other routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// WebSocket connections
io.on('connection', (socket) => {
  logger.info(`WebSocket client connected: ${socket.id}`);

  socket.on('subscribe:campaign', (campaignId) => {
    socket.join(`campaign:${campaignId}`);
  });

  socket.on('unsubscribe:campaign', (campaignId) => {
    socket.leave(`campaign:${campaignId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`WebSocket client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await runMigrations();
  } catch (err) {
    logger.error('Failed to run database migrations, aborting startup', { error: err.message });
    process.exit(1);
  }

  try {
    await initializeAdmin();
  } catch (err) {
    logger.error('Failed to initialize admin user, aborting startup', { error: err.message });
    process.exit(1);
  }

  httpServer.listen(PORT, () => {
    logger.info(`TurboMailer Pro running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

start();