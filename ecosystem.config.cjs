module.exports = {
  apps: [
    {
      name: 'page-reader-proxy',
      script: 'src/server.js',
      cwd: __dirname,
      interpreter: 'node',
      node_args: '--experimental-vm-modules --env-file-if-exists=.env',
      env: {
        PORT: 3092,
        // DISCORD_BLOCK_WEBHOOK is read from a local .env file (gitignored).
        // When set, page-reader posts an alert to Discord when it detects
        // a bot-block / CAPTCHA page (rate-limited to one per domain per hour).
        // If unset, blocks are still logged to stderr but not posted.
      },
      max_memory_restart: '500M',
      restart_delay: 3000,
    },
  ],
};
