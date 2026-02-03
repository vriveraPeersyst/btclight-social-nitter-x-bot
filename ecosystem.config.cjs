module.exports = {
  apps: [
    {
      name: 'btclight-nitter-bot',
      script: 'dist/index.js',
      cwd: '/root/btclight-social-nitter-x-bot',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
      },
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      // Restart behavior
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      // Graceful shutdown
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 10000,
      // Signals
      shutdown_with_message: true,
    },
  ],
};
