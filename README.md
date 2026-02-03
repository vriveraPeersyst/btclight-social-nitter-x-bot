# BTCLight Social Nitter X Bot

A production-ready Node.js microservice that polls a self-hosted Nitter RSS feed and relays new tweets from **@BitcoinLightApp** to both Telegram and Discord channels.

## Architecture

```
X (Twitter) → Self-hosted Nitter → RSS → This Bot → PostgreSQL → Telegram + Discord
```

## Features

- ✅ Polls Nitter RSS feed on a configurable cron schedule
- ✅ Safely parses RSS XML using fast-xml-parser
- ✅ Detects new posts using PostgreSQL (Railway compatible)
- ✅ Posts to Telegram channel via Bot API (no polling)
- ✅ Posts to Discord channel via discord.js v14 (not webhooks)
- ✅ Handles failures gracefully - never crashes
- ✅ Connection pooling for PostgreSQL
- ✅ Structured JSON logging with pino
- ✅ Graceful shutdown (SIGINT/SIGTERM)
- ✅ PM2 ready with ecosystem config
- ✅ TypeScript with strict mode

## Prerequisites

- Node.js 20+
- PostgreSQL database (Railway recommended)
- Self-hosted Nitter instance
- Telegram Bot token and channel ID
- Discord Bot token and channel ID

## Quick Start

### 1. Clone and Install

```bash
cd btclight-social-nitter-x-bot
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your actual values
```

### 3. Set Up Database

Run the SQL migration on your Railway PostgreSQL:

```bash
# Via Railway CLI
railway run psql < sql/001_init.sql

# Or via psql directly
psql $DATABASE_URL < sql/001_init.sql
```

### 4. Set Up Nitter

```bash
# Start Nitter with Docker Compose
docker-compose up -d

# Verify it's running
curl http://localhost:8080/BitcoinLightApp/rss
```

### 5. Build and Run

```bash
# Development
npm run dev

# Production
npm run build
npm start

# With PM2
pm2 start ecosystem.config.js
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Environment mode |
| `NITTER_BASE_URL` | Yes | - | Nitter instance URL (e.g., `http://localhost:8080`) |
| `NITTER_USERNAME` | Yes | - | Twitter username to monitor |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `DB_POOL_MAX` | No | `10` | Max pool connections |
| `TELEGRAM_BOT_TOKEN` | Yes | - | Telegram bot token from @BotFather |
| `TELEGRAM_CHANNEL_ID` | Yes | - | Target channel ID (e.g., `-1001234567890`) |
| `DISCORD_BOT_TOKEN` | Yes | - | Discord bot token |
| `DISCORD_CHANNEL_ID` | Yes | - | Target channel ID |
| `POLL_CRON_EXPRESSION` | No | `*/10 9-20 * * 1-5` | Cron schedule |
| `LOG_LEVEL` | No | `info` | Log level (trace/debug/info/warn/error/fatal) |
| `LOG_PRETTY` | No | `false` | Pretty print logs (dev only) |
| `MAX_RETRIES` | No | `3` | Max retry attempts for failed requests |
| `RETRY_DELAY_MS` | No | `1000` | Base retry delay in milliseconds |

### Cron Expression

Default: `*/10 9-20 * * 1-5`
- Every 10 minutes
- Monday to Friday only
- Between 09:00 and 20:59 server time

Modify `POLL_CRON_EXPRESSION` for different schedules.

## Project Structure

```
src/
├── config/           # Configuration loading and validation
│   ├── index.ts
│   └── types.ts
├── clients/          # External service clients
│   ├── index.ts
│   ├── nitter-client.ts
│   ├── telegram-client.ts
│   └── discord-client.ts
├── db/               # Database layer
│   ├── index.ts
│   ├── database.ts
│   └── tweet-repository.ts
├── services/         # Business logic
│   ├── index.ts
│   └── social-relay.ts
├── utils/            # Utilities
│   ├── index.ts
│   ├── logger.ts
│   └── rss-parser.ts
└── index.ts          # Entry point
```

## VPS Setup Instructions

### 1. Server Requirements

- Ubuntu 22.04 LTS (recommended)
- 1 CPU core, 1GB RAM minimum
- Docker and Docker Compose
- Node.js 20+ via nvm

### 2. Initial Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Install PM2
npm install -g pm2

# Install pnpm (optional, faster than npm)
npm install -g pnpm
```

### 3. Deploy the Bot

```bash
# Clone repository
cd ~
git clone <your-repo-url> btclight-social-nitter-x-bot
cd btclight-social-nitter-x-bot

# Install dependencies
npm install

# Set up environment
cp .env.example .env
nano .env  # Configure all variables

# Start Nitter
docker-compose up -d

# Build TypeScript
npm run build

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 4. Monitoring

```bash
# View logs
pm2 logs btclight-nitter-bot

# Monitor status
pm2 monit

# Check health
pm2 status
```

## Security Best Practices

### 1. Environment Variables

- Never commit `.env` files to git
- Use Railway's encrypted environment variables
- Rotate tokens regularly

### 2. Network Security

- Run Nitter on localhost only (not exposed to internet)
- Use firewall (ufw) to block unnecessary ports
- Keep the server updated

```bash
# Set up firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw enable
```

### 3. Bot Permissions

**Telegram:**
- Create bot via @BotFather
- Add bot to channel as admin with "Post Messages" permission
- Get channel ID using @userinfobot or API

**Discord:**
- Create application at discord.com/developers
- Bot needs "Send Messages" and "View Channel" permissions
- Use OAuth2 URL generator with `bot` scope

### 4. Database Security

- Use SSL connections to Railway PostgreSQL
- Limit database user permissions
- Enable connection pooling limits

### 5. Process Security

- Run as non-root user
- Use PM2's cluster mode for redundancy (optional)
- Set memory limits in ecosystem.config.js

## Troubleshooting

### Bot not posting to Telegram

1. Verify bot token: `curl https://api.telegram.org/bot<TOKEN>/getMe`
2. Ensure bot is admin in channel
3. Check channel ID format (should start with `-100`)

### Bot not posting to Discord

1. Verify bot is in the server
2. Check bot has "Send Messages" permission in channel
3. Ensure channel ID is correct (Developer Mode → Right-click → Copy ID)

### Nitter RSS empty

1. Check Nitter logs: `docker-compose logs nitter`
2. Verify account exists and is public
3. Try accessing feed directly in browser

### Database connection issues

1. Verify DATABASE_URL is correct
2. Check Railway dashboard for connection limits
3. Ensure SSL is configured for Railway

## v2 Improvement Suggestions

### Features

1. **Multi-account support** - Monitor multiple Twitter accounts
2. **Media attachments** - Include images/videos in posts
3. **Thread detection** - Combine tweet threads into single message
4. **Metrics endpoint** - Prometheus metrics for monitoring
5. **Web dashboard** - Simple status page with recent posts
6. **Retry queue** - Persist failed posts for retry
7. **Rate limit handling** - Smarter backoff for Discord/Telegram

### Technical

1. **Redis caching** - Cache recent tweets for faster checks
2. **Health check endpoint** - HTTP endpoint for load balancers
3. **Sentry integration** - Error tracking and alerting
4. **GitHub Actions** - CI/CD pipeline for deployment
5. **Tests** - Unit and integration tests with Vitest
6. **Multiple Nitter instances** - Failover between instances
7. **Webhook alternative** - Optional webhook mode for Discord

### Scaling

1. **Message queue** - Use Redis/BullMQ for processing
2. **Horizontal scaling** - Multiple bot instances with coordination
3. **Database sharding** - Partition by date for large datasets

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run typecheck` and `npm run lint`
5. Submit a pull request
