module.exports = {
  apps: [
    {
      name: "perfil-server",
      cwd: "/root/kaikybrofc",
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: 3015,
        README_PATH: "/root/kaikybrofc/README.md",
        README_AUTO_REFRESH: "true",
        README_REFRESH_INTERVAL_MIN: "60"
      }
    }
  ]
};
