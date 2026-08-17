const path = require("path");
const cwd = __dirname;

module.exports = {
  apps: [
    {
      name: "perfil-server",
      cwd,
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      min_uptime: "30s",
      restart_delay: 5000,
      exp_backoff_restart_delay: 2000,
      max_restarts: 10,
      kill_timeout: 10000,
      listen_timeout: 10000,
      watch: false,
      max_memory_restart: "300M",
      merge_logs: true,
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS Z",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: 3015,
        README_PATH: path.join(cwd, "README.md"),
        README_AUTO_REFRESH: "true",
        README_REFRESH_INTERVAL_MIN: "60",
        README_ASSET_MODE: "local",
        BADGE_LOCAL_PREFIX: "./assets",
        LOCAL_ASSET_SYNC_ENABLED: "true",
        LOCAL_ASSET_SYNC_INTERVAL_HOURS: "1",
        LOCAL_ASSET_SYNC_SCRIPT: "scripts/publish-assets.js",
        LOCAL_RENDER_BASE_URL: "http://127.0.0.1:3015",
        AUTO_PUSH_ENABLED: "true",
        AUTO_PUSH_REMOTE: "origin"
      },
      env_production: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: 3015,
        README_PATH: path.join(cwd, "README.md"),
        README_AUTO_REFRESH: "true",
        README_REFRESH_INTERVAL_MIN: "60",
        README_ASSET_MODE: "local",
        BADGE_LOCAL_PREFIX: "./assets",
        LOCAL_ASSET_SYNC_ENABLED: "true",
        LOCAL_ASSET_SYNC_INTERVAL_HOURS: "1",
        LOCAL_ASSET_SYNC_SCRIPT: "scripts/publish-assets.js",
        LOCAL_RENDER_BASE_URL: "http://127.0.0.1:3015",
        AUTO_PUSH_ENABLED: "true",
        AUTO_PUSH_REMOTE: "origin"
      }
    }
  ]
};
